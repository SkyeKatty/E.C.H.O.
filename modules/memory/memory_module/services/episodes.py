import hashlib
import uuid
from datetime import datetime

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from memory_module.db.models import Conversation, Episode, LifecycleState, Message
from memory_module.services.consolidation import schedule_episode_embedding
from memory_module.services.persona import ensure_persona


def _summary_hash(summary: str) -> str:
    return hashlib.sha256(summary.encode("utf-8")).hexdigest()


def compaction_state(session: Session, persona_id: uuid.UUID, session_id: uuid.UUID) -> dict:
    conv = session.scalar(
        select(Conversation).where(
            Conversation.persona_id == persona_id, Conversation.session_id == session_id
        )
    )
    if not conv:
        return {
            "conversationId": None,
            "channel": None,
            "maxSequence": 0,
            "compactedThroughSequence": 0,
            "messageCount": 0,
        }
    max_seq = session.scalar(
        select(func.coalesce(func.max(Message.sequence), 0)).where(Message.conversation_id == conv.id)
    )
    count = session.scalar(select(func.count(Message.id)).where(Message.conversation_id == conv.id))
    return {
        "conversationId": str(conv.id),
        "channel": conv.channel,
        "maxSequence": int(max_seq or 0),
        "compactedThroughSequence": int(conv.compacted_through_sequence or 0),
        "messageCount": int(count or 0),
    }


def record_episode(session: Session, persona_id: uuid.UUID, body: dict) -> dict:
    ensure_persona(session, persona_id)
    session_id = uuid.UUID(body["sessionId"])
    conv = session.scalar(
        select(Conversation).where(
            Conversation.persona_id == persona_id, Conversation.session_id == session_id
        )
    )

    from_seq = body.get("fromSequence")
    to_seq = body.get("toSequence")
    idempotency_key = body.get("idempotencyKey")
    if idempotency_key:
        existing = session.scalar(select(Episode.id).where(Episode.idempotency_key == idempotency_key))
        if existing:
            return {"episodeId": str(existing), "duplicate": True}

    started_at = _parse_dt(body.get("startedAt"))
    ended_at = _parse_dt(body.get("endedAt"))

    summary = body["summary"]
    sh = _summary_hash(summary)
    ep = Episode(
        persona_id=persona_id,
        conversation_id=conv.id if conv else None,
        summary=summary,
        importance=body.get("importance", 0.5),
        lifecycle_state=LifecycleState.active,
        started_at=started_at,
        ended_at=ended_at,
        from_sequence=from_seq,
        to_sequence=to_seq,
        idempotency_key=idempotency_key,
    )
    session.add(ep)
    session.flush()
    session.execute(
        text(
            """
            UPDATE episodes
            SET search_vector = to_tsvector('english', coalesce(summary, '')),
                summary_hash = :sh
            WHERE id = :id
            """
        ),
        {"id": ep.id, "sh": sh},
    )
    schedule_episode_embedding(session, ep.id, sh)

    if conv and to_seq is not None and int(to_seq) > int(conv.compacted_through_sequence or 0):
        conv.compacted_through_sequence = int(to_seq)

    session.flush()
    return {"episodeId": str(ep.id), "duplicate": False}


def _parse_dt(raw) -> datetime | None:
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw
    return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
