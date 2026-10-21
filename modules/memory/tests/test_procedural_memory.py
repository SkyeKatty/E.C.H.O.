import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("ECHO_MEMORY_DATABASE_URL"),
    reason="Set ECHO_MEMORY_DATABASE_URL for PostgreSQL integration tests",
)


def test_propose_procedural_memory():
    from memory_module.db.session import SessionLocal
    from memory_module.services import memory_ops

    persona_id = uuid.uuid4()
    with SessionLocal() as session:
        result = memory_ops.propose_memory(
            session,
            persona_id,
            {
                "content": "When the user asks for a recap, summarize the last three topics briefly.",
                "summary": "Recap workflow",
                "kind": "procedural",
                "scope": "general",
                "confidence": 0.9,
                "importance": 0.6,
            },
        )
        session.commit()
        assert result.get("duplicate") is not True
        assert result["lifecycleState"] in ("candidate", "active")

    with SessionLocal() as session:
        found = memory_ops.search_memories(
            session,
            persona_id,
            {"kind": "procedural", "limit": 5},
        )
        assert any(
            "recap" in ((item.get("summary") or "") + (item.get("kind") or "")).lower()
            for item in found.get("items", [])
        )
