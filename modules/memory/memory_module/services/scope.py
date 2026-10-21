import uuid
from datetime import datetime

from memory_module.db.models import MemoryScope, Participant


def infer_scope(body: dict, subject: Participant | None, involved: list[Participant]) -> MemoryScope:
    raw = body.get("scope")
    if raw in ("participant", "social", "general"):
        return MemoryScope(raw)
    if involved:
        return MemoryScope.social
    if subject:
        return MemoryScope.participant
    return MemoryScope.general


def parse_occurred_at(body: dict) -> datetime | None:
    raw = body.get("occurredAt") or body.get("occurred_at")
    if not raw:
        return None
    if isinstance(raw, datetime):
        return raw
    text = str(raw).replace("Z", "+00:00")
    return datetime.fromisoformat(text)


def resolve_involved(session, persona_id: uuid.UUID, body: dict) -> list[Participant]:
    from memory_module.services.participants import resolve_participant

    involved: list[Participant] = []
    for entry in body.get("involved") or body.get("involvedParticipants") or []:
        p = resolve_participant(session, persona_id, entry)
        if p and p not in involved:
            involved.append(p)
    return involved
