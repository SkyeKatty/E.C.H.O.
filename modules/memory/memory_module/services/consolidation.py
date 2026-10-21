import uuid
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from memory_module.config import settings
from memory_module.db.models import BackgroundJob, LifecycleState, Memory, MemoryRelation, MemoryScope


def schedule_episode_embedding(session: Session, episode_id: uuid.UUID, summary_hash: str) -> None:
    if not settings.semantic_configured():
        return
    key = f"embed-episode:{episode_id}:{summary_hash}"
    exists = session.scalar(select(BackgroundJob.id).where(BackgroundJob.idempotency_key == key))
    if exists:
        return
    session.add(
        BackgroundJob(
            job_type="embed_episode",
            payload={"episodeId": str(episode_id), "summaryHash": summary_hash},
            status="pending",
            idempotency_key=key,
        )
    )


def _schedule_embedding_job(session: Session, memory_id: uuid.UUID, content_hash: str) -> None:
    if not settings.semantic_configured():
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


def schedule_consolidation_job(session: Session, memory_id: uuid.UUID, content_hash: str) -> None:
    if not settings.consolidation_enabled:
        return
    key = f"consolidate:{memory_id}:{content_hash}"
    exists = session.scalar(select(BackgroundJob.id).where(BackgroundJob.idempotency_key == key))
    if exists:
        return
    session.add(
        BackgroundJob(
            job_type="consolidate_memory",
            payload={"memoryId": str(memory_id), "contentHash": content_hash},
            status="pending",
            idempotency_key=key,
        )
    )


def apply_supersedes(session: Session, mem: Memory) -> None:
    """When a new memory becomes canonical, retire older memories it explicitly replaces."""
    rels = session.scalars(
        select(MemoryRelation).where(
            MemoryRelation.from_memory_id == mem.id,
            MemoryRelation.relation_type == "supersedes",
        )
    ).all()
    now = datetime.now(timezone.utc)
    for rel in rels:
        old = session.get(Memory, rel.to_memory_id)
        if not old or old.lifecycle_state != LifecycleState.active:
            continue
        old.lifecycle_state = LifecycleState.superseded
        old.valid_to = now
        old.version += 1


def maybe_auto_promote(session: Session, mem: Memory) -> bool:
    """Promote high-confidence candidates without contradiction links (system policy, not model direct write)."""
    if mem.lifecycle_state != LifecycleState.candidate:
        return False

    if (
        settings.require_subject_for_promotion
        and mem.scope == MemoryScope.participant
        and mem.subject_participant_id is None
    ):
        return False

    contradiction = session.scalar(
        select(MemoryRelation.id)
        .join(Memory, Memory.id == MemoryRelation.to_memory_id)
        .where(
            MemoryRelation.from_memory_id == mem.id,
            MemoryRelation.relation_type == "contradicts",
            Memory.lifecycle_state == LifecycleState.active,
        )
        .limit(1)
    )
    if contradiction:
        return False

    if mem.confidence >= 0.72 and mem.importance >= 0.35:
        mem.lifecycle_state = LifecycleState.active
        mem.version += 1
        apply_supersedes(session, mem)
        _schedule_embedding_job(session, mem.id, mem.content_hash)
        return True
    return False
