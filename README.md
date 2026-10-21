# ECHO — Modular AI Persona Runtime

ECHO is a self-hostable runtime for a single persistent AI persona. A **central controller** coordinates persona state and cognition; **capability modules** (memory, speech, vision, integrations) connect over a documented WebSocket protocol and can run on other machines on your LAN.

**Current milestone: Phase 2 (in progress)** — LLM provider interface (OpenRouter + local GPU via OpenAI-compatible APIs), cognitive loop, dashboard chat.

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io) 9+

## Quick start

```bash
pnpm install
pnpm build
```

Terminal 1 — controller:

```bash
pnpm dev
```

Terminal 2 — LLM module (required for chat and model settings):

```bash
pnpm dev:llm
```

Terminal 3 — mock module (optional, for tool-calling demos):

```bash
pnpm dev:mock
```

Terminal 4 — dashboard:

```bash
pnpm dev:web
```

Open [http://127.0.0.1:5173](http://127.0.0.1:5173). You should see the mock module registered with capabilities `mock.echo` and `mock.status`.

Health check: [http://127.0.0.1:8787/health](http://127.0.0.1:8787/health)

## Configuration

Copy `config.example.yaml` to `config.yaml` at the repo root (a minimal `config.yaml` is included for local dev). Override with environment variables:

| Variable | Description |
|----------|-------------|
| `ECHO_CONFIG` | Path to YAML config |
| `ECHO_CONTROLLER_HOST` | Bind address |
| `ECHO_CONTROLLER_PORT` | HTTP/WS port (default 8787) |
| `ECHO_MODULE_AUTH_TOKEN` | Shared secret for module WebSocket |
| `ECHO_CONTROLLER_MODULE_WS` | Mock module target URL |
| `ECHO_MOCK_MODULE_ID` | Mock module id |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `ECHO_LLM_DEFAULT_PROVIDER` | Provider id (e.g. `openrouter`, `local-gpu`) |
| `ECHO_LOCAL_LLM_BASE_URL` | Local OpenAI-compatible API base (Ollama/vLLM) |
| `ECHO_LOCAL_LLM_MODEL` | Model id for local provider |

## Tests

```bash
pnpm test
```

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [WebSocket protocol v1](docs/protocol/WEBSOCKET_PROTOCOL.md)
- [LLM providers (OpenRouter + local GPU)](docs/LLM_PROVIDERS.md)

## Roadmap

1. **Phase 1** — Skeleton, registry, dashboard *(this release)*
2. **Phase 2** — Cognitive loop, OpenRouter + local LLM, dashboard chat
3. **Phase 3** — Persistent memory ([docs/PHASE3_MEMORY.md](docs/PHASE3_MEMORY.md))
4. **Phase 4** — Speech
5. **Phase 5** — Vision and Discord
6. **Phase 6** — Distributed deployment hardening
7. **Phase 7** — Autonomy and attention policies

## License

Private / unlicensed unless otherwise specified by the repository owner.
