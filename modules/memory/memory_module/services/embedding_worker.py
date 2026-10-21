import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from memory_module.config import settings
from memory_module.db.models import BackgroundJob, Embedding, LifecycleState, Memory
from memory_module.services.consolidation import _schedule_embedding_job
from memory_module.db.session import SessionLocal
from memory_module.embeddings.runtime import get_embedding_runtime, try_get_embedding_runtime

logger = logging.getLogger("memory.worker")


def count_pending_embed_jobs(session: Session) -> int:
    return int(
        session.scalar(
            select(func.count(BackgroundJob.id)).where(
                BackgroundJob.job_type == "embed_memory",
                BackgroundJob.status == "pending",
            )
        )
        or 0
    )


def _memory_embed_text(mem: Memory) -> str:
    parts = [mem.summary or "", mem.content or ""]
    return "\n".join(p for p in parts if p).strip()


def process_one_embed_job(session: Session) -> bool:
    """Returns True if a job was processed (success or terminal failure)."""
    job = session.scalar(
        select(BackgroundJob)
        .where(
            BackgroundJob.job_type == "embed_memory",
            BackgroundJob.status == "pending",
        )
        .order_by(BackgroundJob.scheduled_at.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if not job:
        return False

    runtime = try_get_embedding_runtime()
    if not runtime:
        return False

    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    job.attempts += 1
    session.flush()

    memory_id = uuid.UUID(job.payload["memoryId"])
    expected_hash = job.payload.get("contentHash")
    mem = session.get(Memory, memory_id)
    if not mem:
        _fail_job(session, job, "Memory not found")
        return True
    if expected_hash and mem.content_hash != expected_hash:
        _fail_job(session, job, "Content hash mismatch (memory updated)")
        return True

    try:
        vector = runtime.encode(_memory_embed_text(mem))
    except Exception as exc:
        _retry_or_fail(session, job, str(exc))
        return True

    session.execute(delete(Embedding).where(Embedding.memory_id == memory_id, Embedding.model_id == runtime.model_id))
    row = Embedding(
        memory_id=memory_id,
        model_id=runtime.model_id,
        model_version=runtime.model_version,
        content_hash=mem.content_hash,
        dimension=runtime.dimension,
        vector_json=vector,
    )
    session.add(row)
    session.flush()

    pg_dim = settings.embedding_dimension or runtime.dimension
    if pg_dim == runtime.dimension:
        vec_literal = "[" + ",".join(f"{v:.8f}" for v in vector) + "]"
        session.execute(
            text(
                """
                UPDATE embeddings SET embedding = CAST(:vec AS vector)
                WHERE id = :id
                """
            ),
            {"vec": vec_literal, "id": row.id},
        )

    job.status = "completed"
    job.finished_at = datetime.now(timezone.utc)
    job.last_error = None
    session.flush()
    logger.info("Embedded memory %s (%s dims)", memory_id, runtime.dimension)
    return True


def _fail_job(session: Session, job: BackgroundJob, message: str) -> None:
    job.status = "failed"
    job.finished_at = datetime.now(timezone.utc)
    job.last_error = message[:2000]
    session.flush()


def _retry_or_fail(session: Session, job: BackgroundJob, message: str) -> None:
    job.last_error = message[:2000]
    if job.attempts >= settings.worker_max_attempts:
        job.status = "failed"
        job.finished_at = datetime.now(timezone.utc)
    else:
        job.status = "pending"
        job.started_at = None
    session.flush()


def _enqueue_active_memories_missing_embeddings(session: Session) -> int:
    runtime = try_get_embedding_runtime()
    if not runtime:
        return 0
    queued = 0
    for mem in session.scalars(select(Memory).where(Memory.lifecycle_state == LifecycleState.active)):
        exists = session.scalar(
            select(Embedding.id).where(
                Embedding.memory_id == mem.id,
                Embedding.model_id == runtime.model_id,
                Embedding.content_hash == mem.content_hash,
            )
        )
        if not exists:
            before = count_pending_embed_jobs(session)
            _schedule_embedding_job(session, mem.id, mem.content_hash)
            after = count_pending_embed_jobs(session)
            if after > before:
                queued += 1
    return queued


async def _load_runtime_in_thread() -> bool:
    try:
        await asyncio.to_thread(get_embedding_runtime)
        return True
    except RuntimeError as exc:
        logger.warning("%s", exc)
        return False


async def embedding_worker_loop() -> None:
    if not settings.semantic_configured():
        logger.info("Embedding worker idle (ECHO_MEMORY_EMBEDDING_MODEL not configured)")
        return

    logger.info("Embedding worker started (model=%s)", settings.embedding_model)
    # Let the WebSocket client register before blocking the event loop on model download/load.
    await asyncio.sleep(max(1.0, settings.worker_poll_interval_sec))

    backfill_done = False
    while True:
        if not await _load_runtime_in_thread():
            await asyncio.sleep(max(5.0, settings.worker_poll_interval_sec))
            continue

        if not backfill_done:
            with SessionLocal() as session:
                try:
                    n = await asyncio.to_thread(_enqueue_active_memories_missing_embeddings, session)
                    session.commit()
                    if n:
                        logger.info("Queued %s embedding backfill job(s) for active memories", n)
                except Exception as exc:
                    session.rollback()
                    logger.warning("Embedding backfill skipped: %s", exc)
            backfill_done = True

        processed = False
        with SessionLocal() as session:
            try:
                processed = await asyncio.to_thread(process_one_embed_job, session)
                session.commit()
            except Exception as exc:
                session.rollback()
                logger.exception("Embedding job failed: %s", exc)

        await asyncio.sleep(0.05 if processed else settings.worker_poll_interval_sec)
