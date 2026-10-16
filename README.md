# logtail-lambda-extension
[![Test logtail-lambda-extension](https://github.com/logtail/logtail-lambda-extension/actions/workflows/test.yml/badge.svg)](https://github.com/logtail/logtail-lambda-extension/actions/workflows/test.yml)
[![E2E](https://github.com/logtail/logtail-lambda-extension/actions/workflows/e2e.yml/badge.svg)](https://github.com/logtail/logtail-lambda-extension/actions/workflows/e2e.yml)

[AWS Lambda Extension](https://docs.aws.amazon.com/lambda/latest/dg/lambda-extensions.html) that uses the [Lambda Telemetry API](https://docs.aws.amazon.com/lambda/latest/dg/telemetry-api-reference.html) to forward logs to a [Better Stack HTTP source](https://betterstack.com/docs/logs/http-rest-api/).

# Usage

In order to use the extension you must first publish it as a Lambda layer in your AWS infrastructure. Download the latest release and publish it in the region of your Lambda function:

```shell
$ curl -fsSLO https://github.com/logtail/logtail-lambda-extension/releases/latest/download/logtail-lambda-extension.zip
$ aws lambda publish-layer-version \
      --layer-name "logtail-lambda-extension" \
      --zip-file "fileb://logtail-lambda-extension.zip" \
      --compatible-runtimes nodejs22.x nodejs24.x \
      --compatible-architectures x86_64 arm64
```

Every change to the extension on `main` is released automatically, see [Releases](https://github.com/logtail/logtail-lambda-extension/releases).

To build the layer from source instead, run `pnpm install` and `pnpm run build`, then publish `dist/logtail-lambda-extension.zip` with the same command.

Once deployed set the `SOURCE_TOKEN` and `INGESTING_HOST` environment variables on your Lambda to the token and ingesting host from your Better Stack source settings (the ingesting host looks like `s123456.lu-trq-1.betterstackdata.com`), and [add the layer](https://docs.aws.amazon.com/lambda/latest/dg/invocation-layers.html) to your Lambda function.
On next invocation your Lambda logs should start appearing in **Telemetry** -> [Live tail](https://telemetry.betterstack.com/team/0/tail).

## Environment Variables

| Variable                                 | Description                                             | Default                              |
| ---------------------------------------- | ------------------------------------------------------- | ------------------------------------ |
| SOURCE_TOKEN                             | Better Stack source token                               | **required**                         |
| INGESTING_HOST                           | Better Stack ingesting host                             | `in.logs.betterstack.com`            |
| EXTENSION_NAME                           | Name of the lambda extension                            | `logtail-lambda-extension`           |
| RECEIVER_ADDRESS                         | Address of the logs http receiver                       | `sandbox`                            |
| RECEIVER_PORT                            | Port of the logs http receiver                          | `4243`                               |
| MAX_ITEMS                                | Maximum number of events that can be buffered in memory | `10000`                              |
| MAX_BYTES                                | Maximum size in bytes of events that can be buffered    | `262144`                             |
| TIMEOUT_MS                               | Maximum time (in milliseconds) that a batch is buffered | `1000`                               |
| AWS_LAMBDA_RUNTIME_API                   | HTTP base URI to the lambda runtime API                 | _Provided by AWS Lambda environment_ |
| AWS_LAMBDA_RUNTIME_EXTENSION_API_VERSION | Lambda Extension API version date                       | `2020-01-01`                         |
| AWS_LAMBDA_RUNTIME_TELEMETRY_API_VERSION | Telemetry API version date                              | `2022-07-01`                         |

`SOURCE_TOKEN` and `INGESTING_HOST` fall back to the legacy `LOGTAIL_TOKEN` and `LOGTAIL_HTTP_API_URL` (a full URL) variables when they are not set.

### License

Unless explicitly stated otherwise all files in this repository are licensed under the MIT License. See [LICENSE](./LICENSE) for more information.
