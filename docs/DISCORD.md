# Discord integration

ECHO connects to Discord through a **Discord module** (`modules/discord`) and a **controller orchestrator** that batches messages, applies a persona relevance gate, runs the same cognitive + memory pipeline as dashboard chat, and sends replies back.

## Components

| Piece | Role |
|--------|------|
| **Web → Discord tab** | Bot token, guild id, per-channel text/voice flags, batching and voice policies |
| **`data/discord/settings.json`** | Persisted settings (token stored on disk — protect the `data/` directory) |
| **`DiscordOrchestrator`** | Debounce/batch inbound messages, LLM gate, `CognitiveEngine.chat`, outbound send |
| **Discord module** | discord.js client, inbound HTTP to controller, capability handlers for send/voice |

## Text chat flow

```mermaid
sequenceDiagram
  participant D as Discord
  participant M as Discord module
  participant C as Controller
  participant L as LLM

  D->>M: messageCreate
  M->>C: POST /api/v1/discord/inbound
  C->>C: batch window / max size
  C->>L: relevance gate (optional)
  C->>L: chat turn + memory
  C->>M: discord.message.send
  M->>D: channel.send
```

- **Session id** for memory: stable UUID derived from `guildId + channelId` (see `discordTextSessionId`).
- **Speaker key**: `discord:{guildId}:{userId}` for Phase 3 memory participants.
- **Always respond** when the bot is @mentioned or the user replies to the bot’s message.
- **Relevance gate** (default on): small structured LLM pass using the active character card — skips side chatter the persona would ignore.
- **Per-message gate**: each inbound message gets a relevance check (unless @mention / reply-to-bot).
- **Skipped backlog**: messages the persona ignores are kept (default cap **12**) and included in the **next** reply when they choose to speak.

## Voice (v1 scaffold)

| Feature | Status |
|---------|--------|
| Auto-join voice-enabled channels | Implemented |
| Barge-in (stop bot when humans speak) | Implemented (simulated speech duration until TTS audio is wired) |
| Interrupt annoyance reaction | Implemented after N interrupts (config threshold) |
| STT per speaker | **Planned** — `@echo/voice-contract` defines `stt.transcribe.stream`; module will POST `/api/v1/discord/voice/transcript` |
| TTS playback | **Planned** — controller will call `tts.synthesize` then `discord.voice.speak` with `audioBase64` |

The Discord module **never talks over humans**: when someone speaks while output is active, playback is cancelled and the controller is notified via `/api/v1/discord/voice/interrupt`.

## Setup

1. Create a [Discord application](https://discord.com/developers/applications) and bot.
2. **Required for full text chat:** Developer Portal → **Bot** → **Privileged Gateway Intents** → enable **Message Content Intent** → **Save Changes**. Without this, Discord closes the connection with `Used disallowed intents` unless ECHO **mentions only mode** is enabled (Dashboard → Discord).
3. Invite the bot to your guild with permissions: View Channels, Send Messages, Connect, Speak.
4. Run stack: `pnpm dev`, `pnpm dev:discord`, plus LLM and memory as usual.
5. Open **Discord** in the dashboard: paste token, guild id, channel ids, save.
6. Set `ECHO_MODULE_AUTH_TOKEN` in `.env` (controller + modules) so inbound HTTP is authenticated.

### Rate limit (429) on token check or login

Discord applies a **global** rate limit across REST and gateway. During development, the earlier **reconnect loop** (config re-applied on every heartbeat) could fire dozens of logins in a minute. ECHO also called `GET /users/@me` on **every** reconnect, which made 429s more likely.

ECHO now **caches** successful token checks for 30 minutes and **backs off** using Discord’s `Retry-After` when you hit 429. Stop `dev:discord`, wait for the time shown in the log (often 60–600s), then start once — avoid saving Discord settings repeatedly while limited.

### Gateway login timed out but REST works

If the module log shows `Token OK for @…` then `Gateway connect failed: … gateway did not become ready`, HTTPS to Discord works but the **gateway WebSocket** is blocked or rate-limited. Allow outbound **WSS** (often `gateway.discord.gg`), disable VPN/proxy tests, or wait 1–2 minutes after many reconnects.

Optional env:

| Variable | Default |
|----------|---------|
| `ECHO_CONTROLLER_HTTP` | derived from `ECHO_CONTROLLER_MODULE_WS` |
| `ECHO_DISCORD_MODULE_ID` | `discord-module-1` |

## Security

- Bot token lives in `data/discord/settings.json`; do not commit `data/`.
- Inbound routes require `Authorization: Bearer <ECHO_MODULE_AUTH_TOKEN>` when the token is set on the controller.

## Next steps

- Implement **STT** and **TTS** modules against `@echo/voice-contract`.
- Wire opus/pcm decode in `discord.voice.speak` for real audio playback.
- Multi-guild support and slash-command controls.
