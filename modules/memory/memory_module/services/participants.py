import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from memory_module.db.models import Participant


def ensure_participant(
    session: Session,
    persona_id: uuid.UUID,
    key: str,
    display_name: str,
    kind: str = "user",
) -> Participant:
    key = key.strip()
    if not key:
        raise ValueError("participant key is required")
    existing = session.scalar(
        select(Participant).where(
            Participant.persona_id == persona_id,
            Participant.external_id == key,
        )
    )
    if existing:
        if display_name and existing.display_name != display_name:
            existing.display_name = display_name[:256]
        if kind and existing.kind != kind:
            existing.kind = kind
        return existing
    participant = Participant(
        persona_id=persona_id,
        external_id=key[:128],
        display_name=display_name[:256] if display_name else key,
        kind=kind[:32],
    )
    session.add(participant)
    session.flush()
    return participant


def resolve_participant(
    session: Session,
    persona_id: uuid.UUID,
    body: dict | None,
) -> Participant | None:
    if not body:
        return None
    key = body.get("key") or body.get("participantKey")
    if not key:
        return None
    display = body.get("displayName") or body.get("display_name") or str(key)
    kind = body.get("kind") or "user"
    return ensure_participant(session, persona_id, str(key), str(display), str(kind))
