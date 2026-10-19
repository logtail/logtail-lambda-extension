import { function as F, taskEither as TE } from 'fp-ts';
import { EnvironmentVars } from '~/env';
import { pollForNextEvent, registerExtension } from '~/aws/api';
import { startTelemetryHttpListener, TelemetryHttpListener } from '~/httpListener';
import { subscribeTelemetry, SubscriptionBody } from '~/aws/subscribe';
import { betterStackLogForwarder, REQUEST_TIMEOUT_MS } from '~/forwarders/betterStack';
import { AbortHandler } from '~/abortHandler';
import { InvokeEvent } from '~/aws/events';

export const telemetrySubscription = ({
  AWS_LAMBDA_RUNTIME_TELEMETRY_API_VERSION,
  RECEIVER_ADDRESS,
  RECEIVER_PORT,
  TIMEOUT_MS,
  MAX_BYTES,
  MAX_ITEMS,
}: Pick<
  EnvironmentVars,
  | 'AWS_LAMBDA_RUNTIME_TELEMETRY_API_VERSION'
  | 'RECEIVER_ADDRESS'
  | 'RECEIVER_PORT'
  | 'TIMEOUT_MS'
  | 'MAX_BYTES'
  | 'MAX_ITEMS'
>): SubscriptionBody => ({
  schemaVersion: AWS_LAMBDA_RUNTIME_TELEMETRY_API_VERSION,
  destination: {
    protocol: 'HTTP',
    URI: `http://${RECEIVER_ADDRESS}:${RECEIVER_PORT}`,
  },
  // Platform events for platform.runtimeDone, see forwardInvocationLogs
  types: ['platform', 'function'],
  buffering: {
    timeoutMs: TIMEOUT_MS,
    maxBytes: MAX_BYTES,
    maxItems: MAX_ITEMS,
  },
});

// Lambda freezes the execution environment as soon as the runtime and every extension asked for the next event, and
// the Telemetry API hands over an invocation's logs only after its runtime finished. So the extension waits for
// platform.runtimeDone of the invocation before it forwards and asks for the next event; forwarding right away would
// send the logs one or two invocations later, or never for the last invocation before a shutdown.
export const forwardInvocationLogs = (
  listener: Pick<TelemetryHttpListener, 'runtimeDone'>,
  forwardLogs: () => Promise<void>,
  event: Pick<InvokeEvent, 'requestId' | 'deadlineMs'>,
): Promise<void> => {
  let timeout: NodeJS.Timeout | undefined;
  const beforeDeadline = new Promise<void>((resolve) => {
    // When the runtime has not reported that it finished, forward anyway early enough for the request to time out
    // before the invocation's deadline, so the extension never makes the invocation time out.
    timeout = setTimeout(resolve, Math.max(0, event.deadlineMs - Date.now() - REQUEST_TIMEOUT_MS));
  });

  return Promise.race([listener.runtimeDone(event.requestId), beforeDeadline])
    .finally(() => clearTimeout(timeout))
    .then(forwardLogs);
};

// noinspection HttpUrlsUsage
export const createExtension = (
  abortHandler: AbortHandler,
  env: EnvironmentVars,
): TE.TaskEither<Error, TE.TaskEither<Error, void>> =>
  F.pipe(
    {
      ...env,
      extensionBaseUrl: `http://${env.AWS_LAMBDA_RUNTIME_API}/${env.AWS_LAMBDA_RUNTIME_EXTENSION_API_VERSION}`,
      telemetryBaseUrl: `http://${env.AWS_LAMBDA_RUNTIME_API}/${env.AWS_LAMBDA_RUNTIME_TELEMETRY_API_VERSION}`,
    },
    TE.of,
    TE.bind('extensionId', ({ extensionBaseUrl, EXTENSION_NAME }) =>
      registerExtension(extensionBaseUrl, EXTENSION_NAME),
    ),
    TE.bind('listener', ({ EXTENSION_NAME, RECEIVER_ADDRESS, RECEIVER_PORT }) =>
      startTelemetryHttpListener(EXTENSION_NAME, RECEIVER_ADDRESS, RECEIVER_PORT),
    ),
    TE.chainFirst((env) => subscribeTelemetry(env.telemetryBaseUrl, env.extensionId, telemetrySubscription(env))),
    TE.bind('forwardLogs', ({ sourceToken, ingestionUrl, listener }) =>
      TE.of(betterStackLogForwarder(sourceToken, ingestionUrl, listener)),
    ),
    TE.map(({ EXTENSION_NAME, extensionId, extensionBaseUrl, forwardLogs, listener }) =>
      F.pipe(
        pollForNextEvent(extensionId, extensionBaseUrl, abortHandler.signal), //
        TE.chainW((event) =>
          TE.tryCatch(
            () => {
              switch (event.eventType) {
                // Received when the Lambda invokes the function
                case 'INVOKE':
                  console.log(`[${EXTENSION_NAME}] Received INVOKE event`);

                  // Forward the invocation's logs once its runtime finished, before Lambda freezes the environment
                  return forwardInvocationLogs(listener, forwardLogs, event);
                // Received when the runtime asks us to shut down (i.e. no lambdas running in a set time-frame)
                case 'SHUTDOWN':
                default:
                  console.log(`[${EXTENSION_NAME}] Shutting down due to event ${event.eventType}`);

                  // Close the HTTP server, no more events are coming
                  listener.server.close();

                  // Raise the abort signal to tell the main loop to stop
                  abortHandler.abort();

                  // Forward any pending logs
                  return forwardLogs();
              }
            },
            () => new Error(),
          ),
        ),
      ),
    ),
  );
