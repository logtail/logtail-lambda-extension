import { forwardInvocationLogs, telemetrySubscription } from '~/extension';

describe('forwardInvocationLogs', () => {
  test('forwards the logs only after the runtime finished the invocation', async () => {
    let finishRuntime = () => undefined as void;
    const runtimeDone = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          finishRuntime = resolve;
        }),
    );
    const forwardLogs = jest.fn(() => Promise.resolve());

    const forwarded = forwardInvocationLogs({ runtimeDone }, forwardLogs, {
      requestId: 'request-1',
      deadlineMs: Date.now() + 60_000,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(runtimeDone).toHaveBeenCalledWith('request-1');
    expect(forwardLogs).not.toHaveBeenCalled();

    finishRuntime();
    await forwarded;
    expect(forwardLogs).toHaveBeenCalledTimes(1);
  });

  test('forwards the logs anyway, well before the deadline, when the runtime never reports', async () => {
    const forwardLogs = jest.fn(() => Promise.resolve());
    const start = Date.now();

    await forwardInvocationLogs({ runtimeDone: () => new Promise<void>(() => undefined) }, forwardLogs, {
      requestId: 'request-1',
      deadlineMs: start + 1_200,
    });

    expect(forwardLogs).toHaveBeenCalledTimes(1);
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});

describe('telemetrySubscription', () => {
  test('subscribes to platform events, for platform.runtimeDone, along with the function logs', () => {
    const subscription = telemetrySubscription({
      AWS_LAMBDA_RUNTIME_TELEMETRY_API_VERSION: '2022-07-01',
      RECEIVER_ADDRESS: 'sandbox',
      RECEIVER_PORT: 4243,
      TIMEOUT_MS: 25,
      MAX_BYTES: 262144,
      MAX_ITEMS: 10000,
    });

    expect(subscription).toStrictEqual({
      schemaVersion: '2022-07-01',
      destination: { protocol: 'HTTP', URI: 'http://sandbox:4243' },
      types: ['platform', 'function'],
      buffering: { timeoutMs: 25, maxBytes: 262144, maxItems: 10000 },
    });
  });
});
