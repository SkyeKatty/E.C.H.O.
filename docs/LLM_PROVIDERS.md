# LLM providers

ECHO runs inference through a **provider interface** in `@echo/llm`. The controller does not embed GPU runtimes; it calls remote HTTP APIs. That keeps the same code path for hosted models and for **local GPU servers** on your machine or LAN.

## Default: OpenRouter

OpenRouter is the default provider (`cognition.defaultProvider: openrouter`). Configure:

```yaml
providers:
  - id: openrouter
    type: openrouter
    model: openai/gpt-4o-mini
```

Set your API key via environment variable (recommended):

```bash
OPENROUTER_API_KEY=sk-or-...
```

Optional attribution headers: `OPENROUTER_SITE_URL`, `OPENROUTER_SITE_NAME`.

OpenRouter exposes many models with **streaming** and **tool calling** when the chosen model supports them.

## Local GPU (OpenAI-compatible)

Use any server that implements the **OpenAI Chat Completions** API (`POST /v1/chat/completions`), including:

| Runtime | Typical base URL | Notes |
|---------|------------------|--------|
| [Ollama](https://ollama.com) | `http://127.0.0.1:11434/v1` | Easy local setup; GPU via Ollama |
| [vLLM](https://github.com/vllm-project/vllm) | `http://<gpu-host>:8000/v1` | High-throughput LAN serving |
| LM Studio | `http://127.0.0.1:1234/v1` | Desktop GUI + local API |
| llama.cpp server | `http://127.0.0.1:8080/v1` | Lightweight |

Example:

```yaml
cognition:
  defaultProvider: local-gpu

providers:
  - id: local-gpu
    type: openai_compatible
    label: Ollama (GPU)
    baseUrl: http://127.0.0.1:11434/v1
    model: llama3.2
    capabilities:
      toolCalling: false   # enable only if your model/server supports tools
      streaming: true
```

Environment overrides:

- `ECHO_LLM_DEFAULT_PROVIDER=local-gpu`
- `ECHO_LOCAL_LLM_BASE_URL=http://192.168.1.50:11434/v1` (GPU box on LAN)
- `ECHO_LOCAL_LLM_MODEL=llama3.2`

## LLM module vs embedded adapter

Default: **LLM module** (separate process):

```bash
pnpm dev:llm
```

Alternative for single-process dev: set in `config.yaml`:

```yaml
cognition:
  llmAdapter: embedded
```

Embedded mode runs the same `@echo/llm` runtime inside the controller (loads `.env` and `data/llm-settings.json`). You do not need `pnpm dev:llm`, but tool isolation matches production less closely.

When the LLM backend is available, the dashboard **LLM configuration** panel calls:

- `GET /api/v1/llm/settings`
- `PATCH /api/v1/llm/settings`

Settings persist to `data/llm-settings.json` (override with `ECHO_LLM_SETTINGS_PATH` or `ECHO_DATA_DIR`).

Provider categories in the UI:

- **OpenRouter** — hosted models
- **Local GPU** — OpenAI-compatible URL on localhost (e.g. Ollama)
- **Remote API** — OpenAI-compatible server on your LAN/WAN

## Switching providers (legacy API)

- `POST /api/v1/providers/:id/activate` still works when the LLM module is connected (proxies to module settings).

## Tool calling

When the active provider reports `toolCalling: true`, the cognitive loop exposes **registered module capabilities** as tools and executes them through the module WebSocket protocol. Local models often need `toolCalling: false` unless you use a tool-capable setup.

## Implementation package

Shared types, SSE streaming parser, OpenRouter and OpenAI-compatible adapters, and `ProviderRegistry` live in `packages/llm`. The controller cognitive engine is in `apps/controller/src/cognition/`.
