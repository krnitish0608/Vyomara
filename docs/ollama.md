# Local Ollama provider

Vyomara talks only to a local [Ollama](https://ollama.com) service, by default
at `http://127.0.0.1:11434`. The URL must use HTTP on `localhost`,
`127.0.0.1`, or `::1`. There is no cloud fallback. Vyomara never follows
redirects and needs no API key.

## Choosing a model

The agent needs a model with **tool calling**. Bigger models follow multi-step
instructions far better.

| Model | Size | Notes |
|---|---|---|
| `qwen3:14b` (default) | ~9.3 GB | Best balance on 24 GB Macs. Reliable tool calls. |
| `qwen2.5-coder:14b` | ~9 GB | Strong at code; slightly weaker at long tool sequences. |
| `qwen3:8b`, `qwen2.5-coder:7b` | ~5 GB | Faster, noticeably less reliable on multi-step tasks. |
| `qwen3:30b-a3b` | ~19 GB | Better quality; needs 32 GB+ RAM. |
| `llama3.2` (3B) | ~2 GB | Answers simple questions; not recommended for coding. |

Install a model in either of these ways:
- In the desktop app, open **Models**, enter a name, and choose **Download with
  Ollama**.
- From a terminal:

  ```sh
  ollama pull qwen3:14b
  ```

To switch models:
- **Desktop:** select the model in **Models**. The choice is saved locally.
- **CLI:** pass `--model <name>`. Without it, the CLI uses `VYOM_OLLAMA_MODEL`,
  then the saved choice, then `qwen3:14b`.

## Context window and thinking

Ollama's built-in context window is only a few thousand tokens. That is far
too small for reading code, and longer prompts are silently cut. Vyomara
therefore always sends `options.num_ctx`:

- `VYOM_OLLAMA_NUM_CTX` (default `32768`, range 2,048–262,144). The KV cache
  grows with this value. For `qwen3:14b`, 32K adds roughly 5 GB on top of the
  model. Lower it to `16384` if memory is tight.
- Before each model call, the agent fits the conversation into this budget:
  1. It shortens tool output from earlier turns.
  2. It drops the oldest turns.
  3. As a last resort, it shortens older results within the current request.

For models that report the `thinking` capability (such as qwen3), Vyomara
sends `think: false` unless `VYOM_OLLAMA_THINK=true`. Any `<think>` blocks a
model prints are removed from replies.

## How well it works

Real runs on an Apple M4 Pro (24 GB) with `qwen3:14b`, 32K context, through
the CLI with approvals answered "yes":

- **"Where is `num_ctx` set in my vyomara project?"** No path was given. The
  agent found the project from the project-folder list, ran `search_text`, and
  answered with the correct file and line in about 40 s.
- **"A test is failing in this project — find the bug, fix it, and verify":**
  - **Thinking off, before nudges:** 2 of 3 runs succeeded. The failed run
    announced a next step and stopped, or pasted a fix instead of applying it.
  - **Thinking off, with nudges:** the agent now nudges the model to continue
    or to apply the change (at most twice per request). 4 of 4 runs
    succeeded, in 63–192 s and 8–13 steps:
    1. Ran the tests.
    2. Read the test and the source.
    3. Edited `price * quantity`, and only that file.
    4. Re-ran the tests to confirm they pass.
  - **Thinking on:** 0 of 2 succeeded and took 3–4 minutes each, so it stays
    off by default.

Local models are not deterministic. If a task stalls, ask Vyom to continue or
rephrase with more detail (a file name, the error message). A larger model
gives the biggest improvement.

## Request flow

1. The agent builds a system prompt containing:
   - Today's date and the OS.
   - Your home folder.
   - Project folders (for example `~/Projects`) and the projects in them.
   - The project this conversation last worked in.
   - Working rules for the tools that are available.
2. It calls `/api/chat` with every registered tool. In the desktop the response
   streams, so text appears live.
3. Each tool call goes through:
   - argument validation, after `null` options are dropped and numeric
     strings are coerced;
   - policy;
   - approval, if needed;
   - execution.

   The result, or the error, goes back to the model.
4. The loop ends when the model answers without tool calls, or when a step
   limit is reached. The reply ends with **Verified actions**, built from tool
   results.

Streaming responses may spread tool calls over several chunks; all of them are
kept.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Ollama is unavailable" | Start Ollama (`ollama serve` or the app). Check `VYOM_OLLAMA_BASE_URL`. |
| "model is not installed" | `ollama pull <model>` or download it in **Models**. |
| Very slow first reply | The model is loading into memory. Vyomara keeps it loaded for 30 minutes. |
| Replies ignore files or forget earlier steps | Raise `VYOM_OLLAMA_NUM_CTX` (memory permitting) or use a stronger model. |
| "took too long to respond" | Raise `VYOM_REQUEST_TIMEOUT_MS` (default 300,000 ms per model call). |
| Agent stops early | Ask it to continue. Raise `VYOM_MAX_AGENT_ITERATIONS` or `VYOM_MAX_TOOL_CALLS` for very large tasks. |

Set `VYOM_PROVIDER=placeholder` to run the app without any model (it returns a
fixed reply).
