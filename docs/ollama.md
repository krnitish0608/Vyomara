# Local Ollama provider

Vyomara defaults to a local Ollama provider at
`http://127.0.0.1:11434` using model `llama3.2`. The provider uses Ollama's
non-streaming `/api/chat` endpoint. Requests stay on loopback; the configured
URL must use HTTP on `localhost`, `127.0.0.1`, or `::1`. No cloud fallback,
redirect following, Ollama package, API credential, or model download is
performed by Vyomara.

## Configure and run

Install Ollama separately and make sure the desired model is already available.
`.env.example` documents the supported local settings; Vyomara does not
automatically load `.env` files. Export variables in the shell before starting:

Before a request is sent, the CLI identifies the selected provider and whether
the request will go to the configured local Ollama service or use the
no-model placeholder.

```sh
export VYOM_PROVIDER=ollama
export VYOM_OLLAMA_BASE_URL=http://127.0.0.1:11434
export VYOM_OLLAMA_MODEL=llama3.2
export VYOM_REQUEST_TIMEOUT_MS=120000
pnpm dev -- "Hello, Vyom"
```

Set `VYOM_PROVIDER=placeholder` to use the deterministic no-model provider.
`VYOM_REQUEST_TIMEOUT_MS` accepts values from 1000 to 300000 milliseconds.
The application caps response body size and assistant text; other safe
resource bounds are configurable through the `VYOM_MAX_*` variables validated
at startup.

## Read-only tool calling

The Ollama `/api/chat` request advertises only tools in the existing registry
whose effect is `read`. Each has an explicit function name, description, and
closed JSON argument schema. The agent accepts only calls matching an
advertised registered tool, processes a returned batch in order, and sends
assistant `tool_calls` plus corresponding `tool` result messages on the next
request. Calls go through the existing executor and policy gateway; no
model-generated code is evaluated.

The agent enforces the configured iteration and total tool-call limits.
Arguments and results are bounded, tool input/output schemas are validated,
and failures stop the request without a success-shaped response. Filesystem
tools require explicit `VYOM_ALLOWED_ROOTS`; the default `[]` grants no
filesystem access. A file read result is sent to the configured local Ollama
service as conversation context, so allow only roots whose contents you are
willing to provide to that local model.

## Troubleshooting

- **Ollama unavailable:** start the local Ollama service and verify its local
  endpoint is reachable. Vyomara reports a bounded error and does not fall
  back to a remote provider.
- **Model not found:** install/pull the configured model using the Ollama
  application before retrying. Vyomara itself does not download models.
- **HTTP or malformed response:** check the local Ollama service/version and
  endpoint configuration. Raw server bodies are not printed or logged.
- **Timeout:** increase `VYOM_REQUEST_TIMEOUT_MS` within its allowed range.

Automated tests use an injected mock `fetch`; they verify request shape,
response handling, errors, timeout, and cancellation without a running Ollama
server or internet access. Tool-call request/response messages are verified
with mock responses; their compatibility has not been checked against a
recorded live Ollama version. A live CLI request using the defaults succeeded
against the local Ollama instance in this environment, but that did not verify
tool calling. Compatibility with other Ollama versions remains unverified.
