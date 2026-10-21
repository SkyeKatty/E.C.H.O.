import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("ECHO_MEMORY_DATABASE_URL"),
    reason="Set ECHO_MEMORY_DATABASE_URL for PostgreSQL integration tests",
)


def test_record_episode_queues_embed_job():
    from sqlalchemy import select, text

    from memory_module.db.models import BackgroundJob
    from memory_module.db.session import SessionLocal
    from memory_module.services import episodes

    persona_id = uuid.uuid4()
    session_id = uuid.uuid4()
    with SessionLocal() as session:
        out = episodes.record_episode(
            session,
            persona_id,
            {
                "sessionId": str(session_id),
                "summary": "They discussed travel plans and agreed to meet next week.",
                "importance": 0.7,
                "idempotencyKey": f"ep-{uuid.uuid4()}",
            },
        )
        session.commit()
        episode_id = uuid.UUID(out["episodeId"])

    with SessionLocal() as session:
        jobs = list(
            session.scalars(select(BackgroundJob).where(BackgroundJob.job_type == "embed_episode")).all()
        )
        assert any(j.payload.get("episodeId") == str(episode_id) for j in jobs)
        row = session.execute(
            text("SELECT summary_hash FROM episodes WHERE id = :id"),
            {"id": episode_id},
        ).one()
        assert row[0] is not None
