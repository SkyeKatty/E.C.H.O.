# Timekeeping module

Optional clock + timer module for ECHO. Exposes LLM tools via `@echo/time-contract` and fires timers back into the cognitive engine.

## Run

```bash
pnpm dev          # controller
pnpm dev:time     # timekeeping module (separate terminal)
```

Set `ECHO_MODULE_AUTH_TOKEN` on both when using auth.

## LLM tools

| Tool | Capability | Purpose |
|------|------------|---------|
| `time_now_get` | `time.now.get` | Current time + timezone |
| `time_date_get` | `time.date.get` | Today's date |
| `time_timer_create` | `time.timer.create` | Schedule a timer with a **description** |
| `time_timer_list` | `time.timer.list` | Active timers |
| `time_timer_cancel` | `time.timer.cancel` | Cancel by id |

When creating a timer from chat, the controller injects `sessionId` and `personaId` so the firing turn uses the same session.

## When a timer fires

1. Module POSTs to `POST /api/v1/time/timer-fired`.
2. Controller runs a **non-streaming** chat turn with a `[Timer finished]` prompt that includes the description.
3. Reply is stored in memory like a normal turn (same `sessionId`).
4. Discord text channels: the controller links the chat session to the channel automatically when messages arrive, injects `notifyDiscord` on timer create, and posts the timer reply to that channel when it fires.

Timers are in-memory in the module process (max delay 24h per `delaySeconds` / 24h via minutes). Restart clears pending timers.

## Env

| Variable | Default |
|----------|---------|
| `ECHO_TIME_MODULE_ID` | `timekeeping-module-1` |
| `ECHO_TIME_TIMEZONE` | IANA zone with DST (e.g. `America/Halifax`) — not fixed offsets like `UTC-3` |
| `ECHO_CONTROLLER_HTTP` | Derived from module WS URL |
