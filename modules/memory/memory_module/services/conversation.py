import uuid
from datetime import datetime, timezone

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from memory_module.db.models import Conversation, Message, Participant
from memory_module.services.participants import ensure_participant, resolve_participant
from memory_module.services.persona import ensure_persona


def _estimate_tokens(content: str | None) -> int:
    if not content:
        return 0
    return max(1, len(content) // 4)


def append_messages(
    session: Session,
    persona_id: uuid.UUID,
    session_id: uuid.UUID,
    channel: str,
    messages: list[dict],
    speaker: dict | None = None,
) -> dict:
    ensure_persona(session, persona_id)
    default_speaker = resolve_participant(session, persona_id, speaker)

    conv = session.scalar(
        select(Conversation).where(
            Conversation.persona_id == persona_id, Conversation.session_id == session_id
        )
    )
    if not conv:
        conv = Conversation(persona_id=persona_id, session_id=session_id, channel=channel)
        session.add(conv)
        session.flush()

    max_seq = session.scalar(
        select(func.coalesce(func.max(Message.sequence), 0)).where(Message.conversation_id == conv.id)
    )
    inserted = 0
    for msg in messages:
        exists = session.scalar(
            select(Message.id).where(
                Message.conversation_id == conv.id,
                Message.idempotency_key == msg["idempotencyKey"],
            )
        )
        if exists:
            continue
        seq = int(max_seq) + inserted + 1
        content = msg.get("content")
        participant_id = None
        if msg.get("role") == "user":
            per_msg = resolve_participant(session, persona_id, msg.get("participant"))
            subject = per_msg or default_speaker
            if subject:
                participant_id = subject.id
        row = Message(
            conversation_id=conv.id,
            idempotency_key=msg["idempotencyKey"],
            role=msg["role"],
            content=content,
            sequence=seq,
            token_estimate=_estimate_tokens(content),
            participant_id=participant_id,
            created_at=datetime.fromisoformat(msg["createdAt"].replace("Z", "+00:00"))
            if msg.get("createdAt")
            else datetime.now(timezone.utc),
        )
        session.add(row)
        session.flush()
        session.execute(
            text(
                "UPDATE messages SET search_vector = to_tsvector('english', coalesce(content, '')) WHERE id = :id"
            ),
            {"id": row.id},
        )
        inserted += 1

    conv.updated_at = datetime.now(timezone.utc)
    session.flush()
    return {"conversationId": str(conv.id), "inserted": inserted}


def list_messages(
    session: Session,
    persona_id: uuid.UUID,
    session_id: uuid.UUID,
    limit: int,
    before_sequence: int | None,
) -> dict:
    conv = session.scalar(
        select(Conversation).where(
            Conversation.persona_id == persona_id, Conversation.session_id == session_id
        )
    )
    if not conv:
        return {"messages": [], "hasMore": False}

    q = select(Message).where(Message.conversation_id == conv.id).order_by(Message.sequence.desc())
    if before_sequence:
        q = q.where(Message.sequence < before_sequence)
    rows = session.scalars(q.limit(limit + 1)).all()
    has_more = len(rows) > limit
    rows = rows[:limit]
    rows.reverse()

    participant_ids = {m.participant_id for m in rows if m.participant_id}
    names: dict[uuid.UUID, str] = {}
    keys: dict[uuid.UUID, str] = {}
    if participant_ids:
        for p in session.scalars(select(Participant).where(Participant.id.in_(participant_ids))).all():
            names[p.id] = p.display_name or p.external_id or str(p.id)
            keys[p.id] = p.external_id or ""

    return {
        "messages": [
            {
                "id": str(m.id),
                "role": m.role,
                "content": m.content,
                "sequence": m.sequence,
                "createdAt": m.created_at.isoformat(),
                "speakerDisplayName": names.get(m.participant_id) if m.participant_id else None,
                "speakerKey": keys.get(m.participant_id) if m.participant_id else None,
            }
            for m in rows
        ],
        "hasMore": has_more,
    }
