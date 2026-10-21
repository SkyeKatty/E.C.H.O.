# Phase 3 — Persistent memory

## Architecture alignment (inspection notes)

| Topic | Current ECHO (pre–Phase 3) | Phase 3 decision | Action |
|--------|---------------------------|------------------|--------|
| Persistence | In-memory `SessionStore` only; JSON files for characters/LLM settings | PostgreSQL is source of truth | Memory module owns DB; controller never connects to Postgres |
| DB technology | Docs mentioned SQLite for “Phase 3+” | **PostgreSQL + Alembic** | Python memory module; update ARCHITECTURE |
| Module language | TypeScript (`@echo/module-sdk`) | Memory module deployable separately | Python WS client mirroring v1 protocol |
| Chat history | Last N messages in controller RAM | Durable conversations in DB | Append/list via `memory.conversation.*` |
| Context assembly | Full in-session history in prompt | Token-budgeted retrieval | `memory.context.retrieve` injects ranked snippets |
| Embeddings | None | Local only; no hosted fallback | Optional worker; FTS always available |
| Persona scope | Active **character card** id | **Persona isolation** per character id | `personaId` = active character UUID on all memory ops |
| Speaker identity | N/A in early dashboard | **Participant** per human (`key` + `displayName`) | Discord/Twitch use platform ids; dashboard uses `dashboard:{uuid}` |

No blocking incompatibility with the WebSocket protocol: memory uses the same `request` / `response` (and optional `stream.*`) patterns as the LLM module.

## Capability IDs (v1)

| Capability | Purpose |
|------------|---------|
| `memory.health.get` | DB + embedding worker status |
| `memory.conversation.append` | Durable message append (idempotent keys) |
| `memory.conversation.list` | Paginated history for a session |
| `memory.context.retrieve` | Hybrid retrieval + token budget + truncation report |
| `memory.episode.record` | Episodic summary linked to conversation |
| `memory.search` | Operator search (FTS + filters) |
| `memory.get` | Single memory with provenance |
| `memory.propose` | **Candidate** memory (not canonical until promoted) |
| `memory.update` | Optimistic concurrency (`expectedVersion`) |
| `memory.delete` | Soft delete + index propagation |
| `memory.job.list` | Background job diagnostics |

The controller **MemoryCurator** runs after each chat turn (when LLM + memory module are up), extracts durable facts via a structured LLM pass, and calls `memory.propose`. The memory module may **auto-promote** candidates to `active` when confidence/importance thresholds are met and no `contradicts` relation exists — otherwise they stay `candidate` until consolidation or operator review.

Operators **prune** memories in the dashboard (delete); there is no manual “save to memory” control.

### Participants (who is speaking)

Every user message should carry a **speaker** `{ key, displayName, kind }`:

- **Dashboard**: “Speaking as” name + stable `dashboard:{uuid}` in localStorage (shown in chat UI).
- **Discord / Twitch** (future): `discord:{guildId}:{userId}` or `twitch:{channel}:{login}` with live display names.

Messages store `participant_id`. Memories store **subject_participant_id** (who the fact is about). Retrieval prefers memories for the current speaker. **Auto-promotion** to `active` requires a subject when `ECHO_MEMORY_REQUIRE_SUBJECT=true` (default), so unnamed turns do not become shared canon and are not left in ambiguous limbo—they stay `candidate` until tied to a speaker or pruned.

## Environment

| Variable | Description |
|----------|-------------|
| `ECHO_MEMORY_DATABASE_URL` | PostgreSQL URL (module only) |
| `ECHO_CONTROLLER_MODULE_WS` | Controller module WebSocket URL |
| `ECHO_MODULE_AUTH_TOKEN` | Must match controller |
| `ECHO_MEMORY_EMBEDDING_MODEL` | Local model id (optional) |
| `ECHO_MEMORY_PERSONA_ID` | Default persona override (dev only) |

## Recovery

- Messages and memories commit in PostgreSQL before ACK.
- Embedding jobs are rows in `background_jobs`; retries after restart.
- If embeddings are unavailable, retrieval uses FTS + structured filters only (`semanticAvailable: false` in response).

## Deployment

```bash
docker compose up -d postgres
cd modules/memory && pip install -e ".[dev]" && alembic upgrade head
pnpm dev          # controller
pnpm dev:memory   # memory module
pnpm dev:llm && pnpm dev:web
```
