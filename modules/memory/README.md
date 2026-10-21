# ECHO Memory Module (Phase 3)

PostgreSQL-backed memory service. Connects to the controller over the standard module WebSocket.

## Setup

```bash
# From repo root
docker compose up -d postgres
cd modules/memory
pip install -e ".[dev]"
# Optional local embeddings (hybrid retrieval):
pip install -e ".[embeddings]"
set ECHO_MEMORY_DATABASE_URL=postgresql+psycopg://echo:echo@127.0.0.1:5432/echo_memory
set ECHO_MEMORY_EMBEDDING_MODEL=sentence-transformers/all-MiniLM-L6-v2
set ECHO_MEMORY_EMBEDDING_ENABLED=true
alembic upgrade head
python -m memory_module
```

The module runs a background **embedding worker** (same process) that processes `embed_memory` jobs when memories promote to `active`. Use pgvector image (`docker compose up -d postgres`) and migration **005** for cosine search.

**PyTorch / transformers:** the `[embeddings]` extra pins `transformers<4.48` so torch **2.3.x** works. If you already installed newer transformers globally, reinstall:

```bash
pip install -e ".[embeddings]" --force-reinstall
```

Or upgrade torch to **>= 2.6** and use current transformers. If you see `Disabling PyTorch because PyTorch >= 2.6 is required`, your stack is mismatched — fix versions before expecting hybrid retrieval.

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
