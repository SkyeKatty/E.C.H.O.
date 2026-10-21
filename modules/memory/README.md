# ECHO Memory Module (Phase 3)

PostgreSQL-backed memory service. Connects to the controller over the standard module WebSocket.

## Setup

```bash
# From repo root
docker compose up -d postgres
cd modules/memory
pip install -e ".[dev]"
set ECHO_MEMORY_DATABASE_URL=postgresql+psycopg://echo:echo@127.0.0.1:5432/echo_memory
alembic upgrade head
python -m memory_module
```

If a previous `alembic upgrade` failed partway (e.g. `lifecyclestate already exists`), reset the dev database and migrate again:

```bash
# From repo root — wipes Postgres volume
docker compose down -v
docker compose up -d postgres
# wait for healthy, then alembic upgrade head again
```

Or connect to Postgres and run `DROP SCHEMA public CASCADE; CREATE SCHEMA public;` before re-running migrations.

Controller: `pnpm dev` (from repo root). Dashboard: `pnpm dev:web`.

## Tests

```bash
set ECHO_MEMORY_DATABASE_URL=postgresql+psycopg://echo:echo@127.0.0.1:5432/echo_memory
pytest
```
