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
| `memory.episode.record` | Record a rolling episode summary (sequence range + compaction cursor) |
| `memory.conversation.compaction-state` | `maxSequence` / `compactedThroughSequence` for backlog planning |
| `memory.search` | Operator search (FTS + filters) |
| `memory.get` | Single memory with provenance |
| `memory.propose` | **Candidate** memory (not canonical until promoted) |
| `memory.update` | Optimistic concurrency (`expectedVersion`) |
| `memory.delete` | Soft delete + index propagation |
| `memory.job.list` | Background job diagnostics |
| `memory.transfer.export.chunk` | Paginated DB export for migration |
| `memory.transfer.import.chunk` | Idempotent merge import on target module |

The controller **MemoryCurator** runs after each chat turn (when LLM + memory module are up), extracts durable facts via a structured LLM pass, and calls `memory.propose`. The memory module may **auto-promote** candidates to `active` when confidence/importance thresholds are met and no `contradicts` relation to an **active** memory exists. Otherwise a **`consolidate_memory`** background job runs: near-duplicate merge, contradiction resolution (supersede weaker active memory when confidence delta ≥ policy), then promotion retry. Operators can also **promote** or **correct** in the dashboard.

Operators **prune** memories in the dashboard (delete); there is no manual “save to memory” control.

### Participants (who is speaking)

Every user message should carry a **speaker** `{ key, displayName, kind }`:

- **Dashboard**: “Speaking as” name + stable `dashboard:{uuid}` in localStorage (shown in chat UI).
- **Discord / Twitch** (future): `discord:{guildId}:{userId}` or `twitch:{channel}:{login}` with live display names.

Messages store `participant_id`. Memories store **subject_participant_id** (primary person when relevant). Retrieval prefers memories for the current speaker plus `general` and relevant `social` events. **Auto-promotion** to `active` requires a subject for **`participant`** scope when `ECHO_MEMORY_REQUIRE_SUBJECT=true` (default); `general` and `social` memories can promote without a single subject.

### Memory scope (who it is about)

| Scope | Meaning | Examples |
|--------|---------|----------|
| `participant` | One person | Preferences, biography, **how the persona feels about them** (can evolve) |
| `social` | Several people | “Alex and Jordan argued about…”, group events |
| `general` | No specific person | World state, persona plans, ambient context |

- **`occurred_at`**: when something happened (retrieval surfaces this alongside text).
- **`memory_involvements`**: extra participants on `social` memories.
- **`participants.last_interaction_at`**: updated on each user message; retrieval injects **recent people talked to**.
- **Evolving opinions**: extractor marks `evolvesPrior`; curator links `supersedesMemoryId` so the old active memory becomes `superseded` when the new one promotes.

Run migrations through **`005`** after pull: `alembic upgrade head`.

### Episodes vs sessions (Discord / Twitch)

These are **not** the same thing:

| Concept | What it is | Lifetime |
|---------|------------|----------|
| **Session** | Durable conversation key `(personaId, sessionId)` — usually one **channel** or dashboard tab | Discord: effectively forever; Twitch: per channel or per broadcast (your integration chooses) |
| **Hot window** | Last N messages passed verbatim into the LLM prompt | Fixed by `memory.episodeCompaction.hotWindowMessages` (default 24) |
| **Episode** | A **compacted narrative chunk** of older messages (sequence `from`→`to`, timestamps, summary text) | Many per session; created **while chat is ongoing** |

**Problem:** Waiting for “session end” to summarize loses everything that fell out of the hot window hours ago.

**Policy:** After each persisted turn, **EpisodeCompactor** checks backlog:

```
backlog = maxSequence - compactedThroughSequence
if backlog > hotWindow + minMessagesPerEpisode:
    summarize messages (compacted+1 … maxSequence-hotWindow)
    store episode + advance compactedThroughSequence
```

Raw messages remain in PostgreSQL; episodes plus atomic **memories** (curator) plus retrieval repopulate the prompt. Tune batch sizes for Twitch cadence vs Discord slow burn.

**Session id guidance for integrations:**

- **Discord:** stable id per channel (e.g. UUID v5 from `discord:{guildId}:{channelId}`) — one infinite log, rolling episodes.
- **Twitch:** either one id per channel (always-on chat) or per broadcast id if you want stream-scoped logs; compaction still runs on message count, not stream length.
- **Dashboard:** ephemeral tab UUID is fine.

## Environment

| Variable | Description |
|----------|-------------|
| `ECHO_MEMORY_DATABASE_URL` | PostgreSQL URL (module only) |
| `ECHO_CONTROLLER_MODULE_WS` | Controller module WebSocket URL |
| `ECHO_MODULE_AUTH_TOKEN` | Must match controller |
| `ECHO_MEMORY_EMBEDDING_MODEL` | HuggingFace / sentence-transformers model id (e.g. `sentence-transformers/all-MiniLM-L6-v2`, 384-dim) |
| `ECHO_MEMORY_EMBEDDING_ENABLED` | `true` / `false` (defaults to **true** when model is set) |
| `ECHO_MEMORY_EMBEDDING_DEVICE` | `cpu` or `cuda` |
| `ECHO_MEMORY_EMBEDDING_DIMENSION` | Must match model output if not 384 (pgvector column is `vector(384)` in migration 005) |
| `ECHO_MEMORY_EMBEDDING_POLL_SEC` | Worker poll interval (default 2) |
| `ECHO_MEMORY_PERSONA_ID` | Default persona override (dev only) |

Install embedding deps: `pip install -e ".[embeddings]"` in `modules/memory`, or `pnpm dev:memory:embed` from repo root.

### Hybrid retrieval

1. Active memories enqueue **`embed_memory`** jobs on auto-promotion.
2. The in-process **embedding worker** encodes text, stores `vector_json` + pgvector `embedding` when dimension matches.
3. `memory.context.retrieve` runs **FTS** and **cosine** (pgvector) candidate lists, merged with **reciprocal rank fusion**.
4. `memory.health.get` reports `semanticAvailable` when the model is loaded, plus `pendingEmbedJobs`.

## Recovery

- Messages and memories commit in PostgreSQL before ACK.
- Embedding jobs are rows in `background_jobs`; retries after restart.
- If embeddings are unavailable, retrieval uses FTS + structured filters only (`ranking.vector: false` in response).

## Migrating memory to another machine (dual module transfer)

Connect **two** memory modules to the same controller (different `ECHO_MEMORY_MODULE_ID` each). Point chat at the target via `memory.primaryModuleId` in `config.yaml`.

1. **Source** (old DB): e.g. `ECHO_MEMORY_MODULE_ID=memory-source` + tunnel to old Postgres URL.
2. **Target** (new DB): e.g. `ECHO_MEMORY_MODULE_ID=memory-target` + local Postgres.
3. List modules: `GET /api/v1/memory/modules`
4. **Dry run:** `POST /api/v1/memory/transfer` with `{ "sourceModuleId", "targetModuleId", "dryRun": true }`
5. **Merge:** same body without `dryRun`; optional `personaIds`, `includeConversations`, `mode`: `merge` | `skip_existing`

UUIDs are preserved so character card ids stay aligned with persona rows.

## Configuration (`config.yaml`)

Repo-root **`config.yaml`** is the shared local config. The **controller** reads `memory.*` (curator, episode compaction, `primaryModuleId`, transfer timeouts, **`memory.retrieval.tokenBudget` / `maxItems`** for chat recall). The **Python memory module** reads **`memoryModule.*`** on startup (via `memory_module/yaml_config.py`) and maps keys to `ECHO_*` env vars **only when those env vars are not already set** — so `.env`, launch scripts, and CI still override YAML.

For a second module instance (migration), run with `ECHO_MEMORY_MODULE_ID=memory-target` and a different `databaseUrl` in env; keep `memory.primaryModuleId` on the controller pointed at the module you want chat to use.

## Deployment

```bash
docker compose up -d postgres
cd modules/memory && pip install -e ".[dev]" && alembic upgrade head
pnpm dev          # controller
pnpm dev:memory   # memory module
pnpm dev:llm && pnpm dev:web
```
