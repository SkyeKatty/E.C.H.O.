import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from memory_module.config import settings
from memory_module.db.models import BackgroundJob, LifecycleState, Memory, MemoryRelation


def _schedule_embedding_job(session: Session, memory_id: uuid.UUID, content_hash: str) -> None:
    if not settings.embedding_enabled or not settings.embedding_model:
        return
    key = f"embed:{memory_id}:{content_hash}"
    exists = session.scalar(select(BackgroundJob.id).where(BackgroundJob.idempotency_key == key))
    if exists:
        return
    session.add(
        BackgroundJob(
            job_type="embed_memory",
            payload={"memoryId": str(memory_id), "contentHash": content_hash},
            status="pending",
            idempotency_key=key,
        )
    )


def maybe_auto_promote(session: Session, mem: Memory) -> bool:
    """Promote high-confidence candidates without contradiction links (system policy, not model direct write)."""
    if mem.lifecycle_state != LifecycleState.candidate:
        return False

    if settings.require_subject_for_promotion and mem.subject_participant_id is None:
        return False

    contradiction = session.scalar(
        select(MemoryRelation.id)
        .where(
            MemoryRelation.from_memory_id == mem.id,
            MemoryRelation.relation_type == "contradicts",
        )
        .limit(1)
    )
    if contradiction:
        return False

    if mem.confidence >= 0.72 and mem.importance >= 0.35:
        mem.lifecycle_state = LifecycleState.active
        mem.version += 1
        _schedule_embedding_job(session, mem.id, mem.content_hash)
        return True
    return False
