import asyncio
import contextlib
import logging
import uuid
from datetime import datetime, timezone

from memory_module.config import settings
from memory_module.db.session import SessionLocal
from memory_module.services import conversation, episodes, memory_ops, retrieve, transfer
from memory_module.services.persona import ensure_persona
from memory_module.services.consolidation_worker import (
    count_pending_consolidation_jobs,
    consolidation_worker_loop,
)
from memory_module.services.embedding_worker import count_pending_embed_jobs, embedding_worker_loop
from memory_module.embeddings.runtime import try_get_embedding_runtime
from memory_module.ws.client import MemoryModuleClient

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("memory")


from contextlib import contextmanager


@contextmanager
def _session_scope():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def _parse_uuid(value: str, field: str) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise ValueError(f"Invalid {field}") from exc


async def handle_health(_env, _params, _cancel) -> dict:
    with _session_scope() as session:
        session.execute(__import__("sqlalchemy").text("SELECT 1"))
        pending = count_pending_embed_jobs(session)
        pending_consolidation = count_pending_consolidation_jobs(session)
    # Do not load the model on health checks (blocks event loop); report configuration only.
    runtime = try_get_embedding_runtime()
    return {
        "status": "ready",
        "database": True,
        "semanticAvailable": runtime is not None,
        "embeddingModel": settings.embedding_model,
        "embeddingConfigured": settings.semantic_configured(),
        "embeddingWorker": settings.semantic_configured(),
        "pendingEmbedJobs": pending,
        "consolidationEnabled": settings.consolidation_enabled,
        "pendingConsolidationJobs": pending_consolidation,
    }


async def handle_append(_env, params, _cancel) -> dict:
    body = params or {}
    persona_id = _parse_uuid(body["personaId"], "personaId")
    session_id = _parse_uuid(body["sessionId"], "sessionId")
    with _session_scope() as session:
        return conversation.append_messages(
            session,
            persona_id,
            session_id,
            body.get("channel", "dashboard"),
            body["messages"],
            body.get("speaker"),
        )


async def handle_list(_env, params, _cancel) -> dict:
    body = params or {}
    with _session_scope() as session:
        return conversation.list_messages(
            session,
            _parse_uuid(body["personaId"], "personaId"),
            _parse_uuid(body["sessionId"], "sessionId"),
            int(body.get("limit", 100)),
            body.get("beforeSequence"),
            body.get("fromSequence"),
            body.get("toSequence"),
        )


def _retrieve_sync(body: dict) -> dict:
    sid = body.get("sessionId")
    with _session_scope() as session:
        return retrieve.retrieve_context(
            session,
            _parse_uuid(body["personaId"], "personaId"),
            body["query"],
            int(body.get("tokenBudget", 2048)),
            int(body.get("maxItems", 12)),
            _parse_uuid(sid, "sessionId") if sid else None,
            body.get("speaker"),
        )


async def handle_retrieve(_env, params, _cancel) -> dict:
    body = params or {}
    return await asyncio.to_thread(_retrieve_sync, body)


async def handle_search(_env, params, _cancel) -> dict:
    body = params or {}
    with _session_scope() as session:
        return memory_ops.search_memories(session, _parse_uuid(body["personaId"], "personaId"), body)


async def handle_get(_env, params, _cancel) -> dict:
    body = params or {}
    with _session_scope() as session:
        return memory_ops.get_memory(
            session,
            _parse_uuid(body["personaId"], "personaId"),
            _parse_uuid(body["memoryId"], "memoryId"),
        )


async def handle_propose(_env, params, _cancel) -> dict:
    body = params or {}
    with _session_scope() as session:
        return memory_ops.propose_memory(session, _parse_uuid(body["personaId"], "personaId"), body)


async def handle_update(_env, params, _cancel) -> dict:
    body = params or {}
    with _session_scope() as session:
        return memory_ops.update_memory(session, _parse_uuid(body["personaId"], "personaId"), body)


async def handle_delete(_env, params, _cancel) -> dict:
    body = params or {}
    with _session_scope() as session:
        return memory_ops.delete_memory(session, _parse_uuid(body["personaId"], "personaId"), body)


async def handle_compaction_state(_env, params, _cancel) -> dict:
    body = params or {}
    with _session_scope() as session:
        return episodes.compaction_state(
            session,
            _parse_uuid(body["personaId"], "personaId"),
            _parse_uuid(body["sessionId"], "sessionId"),
        )


async def handle_episode(_env, params, _cancel) -> dict:
    body = params or {}
    with _session_scope() as session:
        return episodes.record_episode(session, _parse_uuid(body["personaId"], "personaId"), body)


async def handle_transfer_export(_env, params, _cancel) -> dict:
    body = params or {}
    with _session_scope() as session:
        return transfer.export_chunk(session, body)


async def handle_transfer_import(_env, params, _cancel) -> dict:
    body = params or {}
    with _session_scope() as session:
        return transfer.import_chunk(session, body)


async def handle_jobs(_env, _params, _cancel) -> dict:
    with _session_scope() as session:
        from sqlalchemy import select
        from memory_module.db.models import BackgroundJob

        jobs = session.scalars(select(BackgroundJob).order_by(BackgroundJob.scheduled_at.desc()).limit(20)).all()
        return {
            "jobs": [
                {
                    "id": str(j.id),
                    "jobType": j.job_type,
                    "status": j.status,
                    "attempts": j.attempts,
                    "scheduledAt": j.scheduled_at.isoformat(),
                    "lastError": j.last_error,
                }
                for j in jobs
            ]
        }


def main() -> None:
    capabilities = [
        {
            "id": "memory.health.get",
            "name": "Memory health",
            "description": "Database and embedding worker status",
            "version": "1.0.0",
            "enabled": True,
        },
        {"id": "memory.conversation.append", "name": "Append messages", "version": "1.0.0", "enabled": True},
        {"id": "memory.conversation.list", "name": "List messages", "version": "1.0.0", "enabled": True},
        {
            "id": "memory.conversation.compaction-state",
            "name": "Compaction cursor",
            "version": "1.0.0",
            "enabled": True,
        },
        {"id": "memory.context.retrieve", "name": "Retrieve context", "version": "1.0.0", "enabled": True},
        {"id": "memory.episode.record", "name": "Record episode", "version": "1.0.0", "enabled": True},
        {"id": "memory.search", "name": "Search memories", "version": "1.0.0", "enabled": True},
        {"id": "memory.get", "name": "Get memory", "version": "1.0.0", "enabled": True},
        {"id": "memory.propose", "name": "Propose memory", "version": "1.0.0", "enabled": True},
        {"id": "memory.update", "name": "Update memory", "version": "1.0.0", "enabled": True},
        {"id": "memory.delete", "name": "Delete memory", "version": "1.0.0", "enabled": True},
        {"id": "memory.job.list", "name": "List jobs", "version": "1.0.0", "enabled": True},
        {"id": "memory.transfer.export.chunk", "name": "Export transfer chunk", "version": "1.0.0", "enabled": True},
        {"id": "memory.transfer.import.chunk", "name": "Import transfer chunk", "version": "1.0.0", "enabled": True},
    ]
    handlers = {
        "memory.health.get": handle_health,
        "memory.conversation.append": handle_append,
        "memory.conversation.list": handle_list,
        "memory.conversation.compaction-state": handle_compaction_state,
        "memory.context.retrieve": handle_retrieve,
        "memory.episode.record": handle_episode,
        "memory.search": handle_search,
        "memory.get": handle_get,
        "memory.propose": handle_propose,
        "memory.update": handle_update,
        "memory.delete": handle_delete,
        "memory.job.list": handle_jobs,
        "memory.transfer.export.chunk": handle_transfer_export,
        "memory.transfer.import.chunk": handle_transfer_import,
    }
    client = MemoryModuleClient(
        settings.controller_module_ws,
        settings.module_id,
        settings.module_auth_token,
        {
            "moduleId": settings.module_id,
            "name": "Memory Module",
            "version": "0.1.0",
            "protocolVersion": "1",
            "capabilities": capabilities,
            "metadata": {"role": "memory"},
        },
        handlers,
    )
    async def run_all() -> None:
        embed_worker = asyncio.create_task(embedding_worker_loop())
        consolidate_worker = asyncio.create_task(consolidation_worker_loop())
        try:
            await client.run()
        finally:
            embed_worker.cancel()
            consolidate_worker.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await embed_worker
                await consolidate_worker

    logger.info("Connecting to %s", settings.controller_module_ws)
    asyncio.run(run_all())


if __name__ == "__main__":
    main()
