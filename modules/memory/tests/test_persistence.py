import os
import uuid

import pytest

pytestmark = pytest.mark.skipif(
    not os.getenv("ECHO_MEMORY_DATABASE_URL"),
    reason="Set ECHO_MEMORY_DATABASE_URL for PostgreSQL integration tests",
)


def test_conversation_persistence_roundtrip():
    from memory_module.db.session import SessionLocal
    from memory_module.services import conversation

    persona_id = uuid.uuid4()
    session_id = uuid.uuid4()
    with SessionLocal() as session:
        conversation.append_messages(
            session,
            persona_id,
            session_id,
            "dashboard",
            [
                {
                    "idempotencyKey": "t1-user",
                    "role": "user",
                    "content": "My favorite color is blue.",
                }
            ],
        )
        session.commit()

    with SessionLocal() as session:
        listed = conversation.list_messages(session, persona_id, session_id, 10, None)
        assert len(listed["messages"]) == 1
        assert "blue" in (listed["messages"][0]["content"] or "")

    with SessionLocal() as session:
        again = conversation.append_messages(
            session,
            persona_id,
            session_id,
            "dashboard",
            [
                {
                    "idempotencyKey": "t1-user",
                    "role": "user",
                    "content": "My favorite color is blue.",
                }
            ],
        )
        session.commit()
        assert again["inserted"] == 0
