# TTS module

ECHO speaks assistant replies aloud when the conversation originates from **Twitch** or **STT** (speech-to-text) contexts. Discord voice STT uses the `stt:` participant key and routes playback to `discord_voice:guildId:channelId`.

## Architecture

1. **Cognitive engine** streams the LLM and splits deltas into **complete sentences** (`sentence-buffer.ts`).
2. Each sentence is enqueued on the TTS module via `tts.speech.enqueue` while generation continues.
3. The TTS module synthesizes audio (Fish or OpenRouter), maintains a **queue**, and **prefetches** the next utterance while the current one plays.
4. Audio is POSTed to the controller at `POST /api/v1/tts/playback`, which routes by **sink** (Twitch/STT event log stub, Discord `speakInVoice` with `audioBase64`).

## Run locally

```bash
pnpm dev          # controller
pnpm dev:tts      # TTS module
```

Run **`pnpm dev:server:fish`** (pip-installs Fish Speech + downloads weights; API `http://127.0.0.1:8092`, `/v1/tts`, msgpack) — see [VOICE_SERVERS.md](./VOICE_SERVERS.md).

## Environment

| Variable | Purpose |
|----------|---------|
| `ECHO_MODULE_AUTH_TOKEN` | Must match controller; required for playback POST from module |
| `ECHO_TTS_FISH_URL` | Fish Speech API base URL (module reads via config / defaults) |
| `OPENROUTER_API_KEY` | Set when using OpenRouter provider (via `PUT /api/v1/tts/settings` or module config apply) |
| `ECHO_CONTROLLER_MODULE_WS` | Module WebSocket (default `ws://127.0.0.1:8787/ws/modules`) |
| `ECHO_CONTROLLER_HTTP` | Controller HTTP for playback (derived from WS if omitted) |

## Settings API

- `GET /api/v1/tts/status` — module connection and runtime status
- `PUT /api/v1/tts/settings` — partial `ttsRuntimeConfig` (+ optional `openRouterApiKey`)

## Future modules

- **Twitch module**: use `twitchParticipant()` for speakers; subscribe to `tts.playback` events with sink `twitch`.
- **STT module**: use `sttParticipant()`; sink `stt` or pass `speechOutput.sink` for a custom route.
