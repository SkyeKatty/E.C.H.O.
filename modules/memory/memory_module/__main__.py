import asyncio
import logging
import uuid
from datetime import datetime, timezone

from memory_module.config import settings
from memory_module.db.session import SessionLocal
from memory_module.services import conversation, memory_ops, retrieve
from memory_module.db.models import Episode, LifecycleState
from memory_module.services.persona import ensure_persona
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
    return {
        "status": "ready",
        "database": True,
        "semanticAvailable": bool(settings.embedding_enabled and settings.embedding_model),
        "embeddingModel": settings.embedding_model,
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
        )


async def handle_retrieve(_env, params, _cancel) -> dict:
    body = params or {}
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


async def handle_episode(_env, params, _cancel) -> dict:
    body = params or {}
    persona_id = _parse_uuid(body["personaId"], "personaId")
    session_id = _parse_uuid(body["sessionId"], "sessionId")
    with _session_scope() as session:
        ensure_persona(session, persona_id)
        from sqlalchemy import select
        from memory_module.db.models import Conversation

        conv = session.scalar(
            select(Conversation).where(
                Conversation.persona_id == persona_id, Conversation.session_id == session_id
            )
        )
        ep = Episode(
            persona_id=persona_id,
            conversation_id=conv.id if conv else None,
            summary=body["summary"],
            importance=body.get("importance", 0.5),
            lifecycle_state=LifecycleState.active,
        )
        session.add(ep)
        session.flush()
        return {"episodeId": str(ep.id)}


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
        {"id": "memory.context.retrieve", "name": "Retrieve context", "version": "1.0.0", "enabled": True},
        {"id": "memory.episode.record", "name": "Record episode", "version": "1.0.0", "enabled": True},
        {"id": "memory.search", "name": "Search memories", "version": "1.0.0", "enabled": True},
        {"id": "memory.get", "name": "Get memory", "version": "1.0.0", "enabled": True},
        {"id": "memory.propose", "name": "Propose memory", "version": "1.0.0", "enabled": True},
        {"id": "memory.update", "name": "Update memory", "version": "1.0.0", "enabled": True},
        {"id": "memory.delete", "name": "Delete memory", "version": "1.0.0", "enabled": True},
        {"id": "memory.job.list", "name": "List jobs", "version": "1.0.0", "enabled": True},
    ]
    handlers = {
        "memory.health.get": handle_health,
        "memory.conversation.append": handle_append,
        "memory.conversation.list": handle_list,
        "memory.context.retrieve": handle_retrieve,
        "memory.episode.record": handle_episode,
        "memory.search": handle_search,
        "memory.get": handle_get,
        "memory.propose": handle_propose,
        "memory.update": handle_update,
        "memory.delete": handle_delete,
        "memory.job.list": handle_jobs,
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
    logger.info("Connecting to %s", settings.controller_module_ws)
    asyncio.run(client.run())


if __name__ == "__main__":
    main()
