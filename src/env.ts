import { either as E, function as F, record as R } from 'fp-ts';
import { z } from 'zod';

const envNumber = z
  .string()
  .transform((val) => Number(val))
  .refine((val) => !isNaN(val));

// Better Stack's general-purpose ingesting host; a source's own host looks like s123456.lu-trq-1.betterstackdata.com.
const DEFAULT_INGESTING_HOST = 'in.logs.betterstack.com';

const baseSchema = z.object({
  NODE_ENV: z.union([z.literal('production'), z.literal('development'), z.literal('test')]).default('production'),
  AWS_LAMBDA_RUNTIME_API: z.string(), // Provided by the Lambda Env, usually http://127.0.0.1:9001/
  AWS_LAMBDA_RUNTIME_EXTENSION_API_VERSION: z.string().default('2020-01-01'), // Extension API version
  AWS_LAMBDA_RUNTIME_TELEMETRY_API_VERSION: z.string().default('2022-07-01'), // Telemetry API version
  EXTENSION_NAME: z.string().default('logtail-lambda-extension'),
  RECEIVER_ADDRESS: z.string().default('sandbox'), // `sandbox` seems to be the default accepted address
  MAX_ITEMS: envNumber.default('10000'), // Maximum number of events that are buffered in memory.
  MAX_BYTES: envNumber.default('262144'), // Maximum size in bytes that the logs are buffered in memory.
  TIMEOUT_MS: envNumber.default('1000'), // Maximum time (in milliseconds) that a batch is buffered.
  RECEIVER_PORT: envNumber.default('4243'), // HTTP server receiving port
  // Better Stack source token; SOURCE_TOKEN is preferred, LOGTAIL_TOKEN is kept as a fallback.
  SOURCE_TOKEN: z.string().optional(),
  LOGTAIL_TOKEN: z.string().optional(),
  // Better Stack ingesting host; INGESTING_HOST is preferred, LOGTAIL_HTTP_API_URL (a full URL) is kept as a fallback.
  INGESTING_HOST: z.string().optional(),
  LOGTAIL_HTTP_API_URL: z.string().url().optional(),
});

const envSchema = baseSchema.transform(
  ({ SOURCE_TOKEN, LOGTAIL_TOKEN, INGESTING_HOST, LOGTAIL_HTTP_API_URL, ...rest }, ctx) => {
    const sourceToken = SOURCE_TOKEN || LOGTAIL_TOKEN;
    if (!sourceToken) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Missing source token: set SOURCE_TOKEN (or the legacy LOGTAIL_TOKEN).',
      });
      return z.NEVER;
    }

    const ingestionUrl = INGESTING_HOST
      ? `https://${INGESTING_HOST}/`
      : LOGTAIL_HTTP_API_URL || `https://${DEFAULT_INGESTING_HOST}/`;

    return { ...rest, sourceToken, ingestionUrl };
  },
);

export type EnvironmentVars = z.infer<typeof envSchema>;

export const parseEnvironmentVariables = (
  env: Record<string, string | undefined> = process.env,
): E.Either<Error, EnvironmentVars> =>
  F.pipe(
    baseSchema.shape,
    R.mapWithIndex((key) => env[key]),
    (vars) => envSchema.safeParse(vars),
    (parsed) => (parsed.success ? E.right(parsed.data) : E.left(parsed.error)),
  );
