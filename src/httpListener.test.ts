import fetchMock from 'jest-fetch-mock';
import { taskEither as TE, function as F } from 'fp-ts';
import { startTelemetryHttpListener, TelemetryHttpListener } from '~/httpListener';
import fetch from 'node-fetch';

const EXTENSION_NAME = 'test-extension';
const serverEndpoint = new URL('http://localhost:9324');

const startServer = () =>
  F.pipe(
    startTelemetryHttpListener(EXTENSION_NAME, serverEndpoint.hostname, Number(serverEndpoint.port)),
    TE.mapLeft((error) => {
      throw error;
    }),
    TE.toUnion,
  )();

describe('test http logs listener', () => {
  let listener: TelemetryHttpListener;

  beforeAll(async () => {
    listener = await startServer();
    fetchMock.disableMocks();
    fetchMock.dontMock();
  });

  afterAll((done) => {
    fetchMock.enableMocks();
    fetchMock.mockReset();
    listener.server.close(done);
  });

  afterEach(() => {
    listener.logsQueue.splice(0);
  });

  test('http server should receive logs', async () => {
    const response = await fetch('http://localhost:9324', {
      method: 'POST',
      body: JSON.stringify([
        {
          type: 'function',
          time: '2022-10-12T00:03:50.000Z',
          record: '[INFO] Hello world, I am a function!',
        },
      ]),
    });

    expect(response.status).toBe(200);
    expect(listener.logsQueue.length).toBe(1);
  });

  const postEvents = (events: unknown[]) =>
    fetch('http://localhost:9324', {
      method: 'POST',
      body: JSON.stringify(events),
    });

  test('http server should take platform events along with logs and queue only the logs', async () => {
    const response = await postEvents([
      {
        type: 'platform.start',
        time: '2022-10-12T00:03:49.900Z',
        record: { requestId: 'request-1', version: '$LATEST' },
      },
      {
        type: 'function',
        time: '2022-10-12T00:03:50.000Z',
        record: '[INFO] Hello world, I am a function!',
      },
      {
        type: 'platform.runtimeDone',
        time: '2022-10-12T00:03:50.100Z',
        record: { requestId: 'request-1', status: 'success' },
      },
    ]);

    expect(response.status).toBe(200);
    expect(listener.logsQueue.length).toBe(1);
  });

  test('runtimeDone should resolve once Lambda reports that the runtime finished the invocation', async () => {
    let done = false;
    const runtimeDone = listener.runtimeDone('request-2').then(() => {
      done = true;
    });

    await postEvents([
      {
        type: 'function',
        time: '2022-10-12T00:03:50.000Z',
        record: '[INFO] Hello world, I am a function!',
      },
    ]);
    expect(done).toBe(false);

    await postEvents([
      {
        type: 'platform.runtimeDone',
        time: '2022-10-12T00:03:50.100Z',
        record: { requestId: 'request-2', status: 'success' },
      },
    ]);
    await runtimeDone;
    expect(done).toBe(true);
  });

  test('runtimeDone should resolve at once when the report arrived before', async () => {
    await postEvents([
      {
        type: 'platform.runtimeDone',
        time: '2022-10-12T00:03:50.100Z',
        record: { requestId: 'request-3', status: 'success' },
      },
    ]);

    await expect(listener.runtimeDone('request-3')).resolves.toBeUndefined();
  });

  test('http server should return status 400 on malformed logs', async () => {
    const response = await fetch('http://localhost:9324', {
      method: 'POST',
      body: JSON.stringify([
        {
          type: 'function',
          time: '2022-664333',
          record: 1,
        },
      ]),
    });

    expect(response.status).toBe(400);
    expect(listener.logsQueue.length).toBe(0);
  });
});
