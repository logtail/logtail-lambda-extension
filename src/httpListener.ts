import http from 'http';
import { FunctionLogEvent, functionLogEventSchema, platformRuntimeDoneEventSchema } from '~/aws/events';
import { either as E, taskEither as TE } from 'fp-ts';
import { z } from 'zod';

const telemetryEventsSchema = z.array(z.object({ type: z.string() }).passthrough());

export interface TelemetryHttpListener {
  logsQueue: FunctionLogEvent[];
  server: http.Server;
  // Resolves once Lambda reported (platform.runtimeDone) that the runtime finished the invocation with this request ID
  runtimeDone: (requestId: string) => Promise<void>;
}

// Takes the function's logs and the request IDs of platform.runtimeDone out of a batch of Telemetry API events; other
// platform events are not needed. A malformed function log fails the whole batch.
const parseTelemetryEvents = (data: unknown): E.Either<Error, { logs: FunctionLogEvent[]; runtimeDone: string[] }> => {
  const events = telemetryEventsSchema.safeParse(data);
  if (!events.success) {
    return E.left(events.error);
  }

  const logs: FunctionLogEvent[] = [];
  const runtimeDone: string[] = [];
  for (const event of events.data) {
    if (event.type === 'function') {
      const log = functionLogEventSchema.safeParse(event);
      if (!log.success) {
        return E.left(log.error);
      }
      logs.push(log.data);
    } else if (event.type === 'platform.runtimeDone') {
      const done = platformRuntimeDoneEventSchema.safeParse(event);
      if (!done.success) {
        return E.left(done.error);
      }
      runtimeDone.push(done.data.record.requestId);
    }
  }

  return E.right({ logs, runtimeDone });
};

// HTTP server for the logs subscription
// AWS Lambda Telemetry API will POST the logs to this server
export const startTelemetryHttpListener = (
  EXTENSION_NAME: string,
  address: string,
  port: number,
): TE.TaskEither<Error, TelemetryHttpListener> =>
  TE.tryCatch(
    () =>
      new Promise((resolve, reject) => {
        const logsQueue: FunctionLogEvent[] = [];
        // Request IDs whose platform.runtimeDone arrived before anyone waited for it, and the waiters still waiting
        const runtimeDoneReported = new Set<string>();
        const runtimeDoneWaiters = new Map<string, () => void>();

        const reportRuntimeDone = (requestId: string) => {
          const waiter = runtimeDoneWaiters.get(requestId);
          if (waiter) {
            runtimeDoneWaiters.delete(requestId);
            waiter();
          } else {
            runtimeDoneReported.add(requestId);
          }
        };

        const runtimeDone = (requestId: string) =>
          new Promise<void>((done) => {
            if (runtimeDoneReported.delete(requestId)) {
              done();
            } else {
              runtimeDoneWaiters.set(requestId, done);
            }
          });

        const server = http.createServer((request, response) => {
          switch (request.method) {
            // Received some telemetry, let's queue the logs and note which invocations the runtime finished
            case 'POST': {
              let body = '';
              request.on('data', (data) => (body += data));
              request.on('end', () => {
                const parsed = parseTelemetryEvents(JSON.parse(body));
                if (E.isLeft(parsed)) {
                  response.writeHead(400);
                  console.error(`[${EXTENSION_NAME}] Error parsing logs: ${parsed.left}`);
                } else {
                  response.writeHead(200);
                  if (parsed.right.logs.length > 0) {
                    logsQueue.push(...parsed.right.logs);
                    console.log(
                      `[${EXTENSION_NAME}] Pushed ${parsed.right.logs.length} logs onto queue, now ${logsQueue.length}`,
                    );
                  }
                  parsed.right.runtimeDone.forEach(reportRuntimeDone);
                }
                response.end();
              });
              break;
            }
            case 'GET': {
              response.writeHead(200);
              response.end();
              break;
            }
          }
        });

        server.on('error', reject);
        server.listen(port, address, undefined, () => resolve({ logsQueue, server, runtimeDone }));
      }),
    (error) => new Error(`Failed to start http logging listener: ${error instanceof Error ? error.message : error}`),
  );
