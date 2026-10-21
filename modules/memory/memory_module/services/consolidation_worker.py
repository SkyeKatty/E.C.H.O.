import asyncio
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from memory_module.config import settings
from memory_module.db.models import BackgroundJob, Memory
from memory_module.db.session import SessionLocal
from memory_module.services.consolidation_policy import run_consolidation_for_memory

logger = logging.getLogger("memory.consolidation")


def count_pending_consolidation_jobs(session: Session) -> int:
    return int(
        session.scalar(
            select(func.count(BackgroundJob.id)).where(
                BackgroundJob.job_type == "consolidate_memory",
                BackgroundJob.status == "pending",
            )
        )
        or 0
    )


def process_one_consolidation_job(session: Session) -> bool:
    job = session.scalar(
        select(BackgroundJob)
        .where(
            BackgroundJob.job_type == "consolidate_memory",
            BackgroundJob.status == "pending",
        )
        .order_by(BackgroundJob.scheduled_at.asc())
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if not job:
        return False

    job.status = "running"
    job.started_at = datetime.now(timezone.utc)
    job.attempts += 1
    session.flush()

    memory_id = uuid.UUID(job.payload["memoryId"])
    expected_hash = job.payload.get("contentHash")

    try:
        mem_check = session.get(Memory, memory_id)
        if not mem_check:
            job.status = "failed"
            job.finished_at = datetime.now(timezone.utc)
            job.last_error = "Memory not found"
            session.flush()
            return True
        if expected_hash and mem_check.content_hash != expected_hash:
            job.status = "completed"
            job.finished_at = datetime.now(timezone.utc)
            job.last_error = "Stale content hash; skipped"
            session.flush()
            return True

        outcome = run_consolidation_for_memory(session, memory_id)
        job.status = "completed"
        job.finished_at = datetime.now(timezone.utc)
        job.last_error = None
        session.flush()
        logger.info("Consolidated memory %s: %s", memory_id, outcome.get("actions"))
        return True
    except Exception as exc:
        job.last_error = str(exc)[:2000]
        if job.attempts >= settings.consolidation_max_attempts:
            job.status = "failed"
            job.finished_at = datetime.now(timezone.utc)
        else:
            job.status = "pending"
            job.started_at = None
        session.flush()
        logger.exception("Consolidation job failed for %s", memory_id)
        return True


async def consolidation_worker_loop() -> None:
    if not settings.consolidation_enabled:
        logger.info("Consolidation worker disabled")
        return

    logger.info("Consolidation worker started")
    while True:
        processed = False
        with SessionLocal() as session:
            try:
                processed = await asyncio.to_thread(process_one_consolidation_job, session)
                session.commit()
            except Exception as exc:
                session.rollback()
                logger.exception("Consolidation worker error: %s", exc)

        await asyncio.sleep(0.05 if processed else settings.consolidation_poll_interval_sec)
