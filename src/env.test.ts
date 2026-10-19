import { either as E } from 'fp-ts';
import { parseEnvironmentVariables } from '~/env';
import { ZodError } from 'zod';

describe('parseEnvironmentVariables', () => {
  test('resolves new names and populates defaults', () => {
    const env = {
      AWS_LAMBDA_RUNTIME_API: 'http://127.0.0.1:9001/',
      SOURCE_TOKEN: 'source_token',
      INGESTING_HOST: 's123456.lu-trq-1.betterstackdata.com',
    };

    const result = parseEnvironmentVariables(env);

    expect(result).toStrictEqual({
      _tag: 'Right',
      right: {
        NODE_ENV: 'production',
        AWS_LAMBDA_RUNTIME_API: 'http://127.0.0.1:9001/',
        AWS_LAMBDA_RUNTIME_EXTENSION_API_VERSION: '2020-01-01',
        AWS_LAMBDA_RUNTIME_TELEMETRY_API_VERSION: '2022-07-01',
        EXTENSION_NAME: 'logtail-lambda-extension',
        RECEIVER_ADDRESS: 'sandbox',
        MAX_ITEMS: 10000,
        MAX_BYTES: 262144,
        TIMEOUT_MS: 25,
        RECEIVER_PORT: 4243,
        sourceToken: 'source_token',
        ingestionUrl: 'https://s123456.lu-trq-1.betterstackdata.com/',
      },
    });
  });

  test('falls back to legacy token and full URL used as-is', () => {
    const result = parseEnvironmentVariables({
      AWS_LAMBDA_RUNTIME_API: 'http://127.0.0.1:9001/',
      LOGTAIL_TOKEN: 'legacy_token',
      LOGTAIL_HTTP_API_URL: 'https://in.logtail.com/',
    });

    if (!E.isRight(result)) throw new Error('expected Right');
    expect(result.right.sourceToken).toBe('legacy_token');
    expect(result.right.ingestionUrl).toBe('https://in.logtail.com/');
  });

  test('defaults the ingestion host when no host or legacy URL is set', () => {
    const result = parseEnvironmentVariables({
      AWS_LAMBDA_RUNTIME_API: 'http://127.0.0.1:9001/',
      SOURCE_TOKEN: 'source_token',
    });

    if (!E.isRight(result)) throw new Error('expected Right');
    expect(result.right.ingestionUrl).toBe('https://in.logs.betterstack.com/');
  });

  test('SOURCE_TOKEN wins over LOGTAIL_TOKEN', () => {
    const result = parseEnvironmentVariables({
      AWS_LAMBDA_RUNTIME_API: 'http://127.0.0.1:9001/',
      SOURCE_TOKEN: 'preferred',
      LOGTAIL_TOKEN: 'legacy',
    });

    if (!E.isRight(result)) throw new Error('expected Right');
    expect(result.right.sourceToken).toBe('preferred');
  });

  test('INGESTING_HOST wins over LOGTAIL_HTTP_API_URL', () => {
    const result = parseEnvironmentVariables({
      AWS_LAMBDA_RUNTIME_API: 'http://127.0.0.1:9001/',
      SOURCE_TOKEN: 'source_token',
      INGESTING_HOST: 's123456.lu-trq-1.betterstackdata.com',
      LOGTAIL_HTTP_API_URL: 'https://in.logtail.com/',
    });

    if (!E.isRight(result)) throw new Error('expected Right');
    expect(result.right.ingestionUrl).toBe('https://s123456.lu-trq-1.betterstackdata.com/');
  });

  test('fails with ZodError when a runtime API is set but no token', () => {
    const result = parseEnvironmentVariables({ AWS_LAMBDA_RUNTIME_API: 'http://127.0.0.1:9001/' });

    expect(E.isLeft(result) && result.left instanceof ZodError).toBe(true);
  });

  test('fails with ZodError on completely empty env', () => {
    const result = parseEnvironmentVariables({});

    expect(E.isLeft(result) && result.left instanceof ZodError).toBe(true);
  });
});
