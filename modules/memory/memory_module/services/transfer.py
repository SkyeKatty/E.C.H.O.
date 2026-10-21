"""Export/import memory DB chunks for controller-orchestrated migration."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from memory_module.db.models import (
    Conversation,
    Embedding,
    Episode,
    LifecycleState,
    Memory,
    MemoryInvolvement,
    MemoryProvenance,
    MemoryRelation,
    Message,
    Participant,
    Persona,
)


def _persona_filter_ids(body: dict) -> list[uuid.UUID] | None:
    raw = body.get("personaIds")
    if not raw:
        return None
    return [uuid.UUID(str(x)) for x in raw]


def export_chunk(session: Session, body: dict) -> dict:
    entity = body["entity"]
    offset = int(body.get("offset", 0))
    limit = min(int(body.get("limit", 100)), 500)
    persona_ids = _persona_filter_ids(body)
    records: list[dict[str, Any]] = []
    has_more = False

    if entity == "personas":
        q = select(Persona)
        if persona_ids:
            q = q.where(Persona.id.in_(persona_ids))
        rows = session.scalars(q.order_by(Persona.created_at).offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {
                "id": str(p.id),
                "externalId": p.external_id,
                "displayName": p.display_name,
                "createdAt": p.created_at.isoformat() if p.created_at else None,
            }
            for p in rows
        ]

    elif entity == "participants":
        q = select(Participant)
        if persona_ids:
            q = q.where(Participant.persona_id.in_(persona_ids))
        rows = session.scalars(q.order_by(Participant.id).offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {
                "id": str(p.id),
                "personaId": str(p.persona_id),
                "kind": p.kind,
                "displayName": p.display_name,
                "externalId": p.external_id,
                "lastInteractionAt": p.last_interaction_at.isoformat() if p.last_interaction_at else None,
            }
            for p in rows
        ]

    elif entity == "memories":
        q = select(Memory).where(Memory.lifecycle_state != LifecycleState.deleted)
        if persona_ids:
            q = q.where(Memory.persona_id.in_(persona_ids))
        rows = session.scalars(q.order_by(Memory.id).offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {
                "id": str(m.id),
                "personaId": str(m.persona_id),
                "kind": m.kind.value,
                "scope": m.scope.value,
                "content": m.content,
                "summary": m.summary,
                "lifecycleState": m.lifecycle_state.value,
                "confidence": m.confidence,
                "importance": m.importance,
                "contentHash": m.content_hash,
                "version": m.version,
                "validFrom": m.valid_from.isoformat() if m.valid_from else None,
                "validTo": m.valid_to.isoformat() if m.valid_to else None,
                "occurredAt": m.occurred_at.isoformat() if m.occurred_at else None,
                "subjectParticipantId": str(m.subject_participant_id) if m.subject_participant_id else None,
                "createdAt": m.created_at.isoformat() if m.created_at else None,
                "updatedAt": m.updated_at.isoformat() if m.updated_at else None,
            }
            for m in rows
        ]

    elif entity == "memory_provenance":
        q = select(MemoryProvenance).join(Memory, Memory.id == MemoryProvenance.memory_id)
        if persona_ids:
            q = q.where(Memory.persona_id.in_(persona_ids))
        rows = session.scalars(q.order_by(MemoryProvenance.id).offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {
                "id": str(p.id),
                "memoryId": str(p.memory_id),
                "sourceType": p.source_type,
                "sourceId": str(p.source_id) if p.source_id else None,
                "excerpt": p.excerpt,
                "recordedAt": p.recorded_at.isoformat() if p.recorded_at else None,
            }
            for p in rows
        ]

    elif entity == "memory_relations":
        q = select(MemoryRelation).join(Memory, Memory.id == MemoryRelation.from_memory_id)
        if persona_ids:
            q = q.where(Memory.persona_id.in_(persona_ids))
        rows = session.scalars(q.order_by(MemoryRelation.id).offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {
                "id": str(r.id),
                "fromMemoryId": str(r.from_memory_id),
                "toMemoryId": str(r.to_memory_id),
                "relationType": r.relation_type,
            }
            for r in rows
        ]

    elif entity == "memory_involvements":
        q = select(MemoryInvolvement).join(Memory, Memory.id == MemoryInvolvement.memory_id)
        if persona_ids:
            q = q.where(Memory.persona_id.in_(persona_ids))
        rows = session.scalars(q.offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {"memoryId": str(r.memory_id), "participantId": str(r.participant_id)} for r in rows
        ]

    elif entity == "episodes":
        q = select(Episode)
        if persona_ids:
            q = q.where(Episode.persona_id.in_(persona_ids))
        rows = session.scalars(q.order_by(Episode.id).offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {
                "id": str(e.id),
                "personaId": str(e.persona_id),
                "conversationId": str(e.conversation_id) if e.conversation_id else None,
                "summary": e.summary,
                "importance": e.importance,
                "lifecycleState": e.lifecycle_state.value,
                "startedAt": e.started_at.isoformat() if e.started_at else None,
                "endedAt": e.ended_at.isoformat() if e.ended_at else None,
                "fromSequence": e.from_sequence,
                "toSequence": e.to_sequence,
                "idempotencyKey": e.idempotency_key,
                "createdAt": e.created_at.isoformat() if e.created_at else None,
            }
            for e in rows
        ]

    elif entity == "embeddings":
        q = select(Embedding).join(Memory, Memory.id == Embedding.memory_id)
        if persona_ids:
            q = q.where(Memory.persona_id.in_(persona_ids))
        rows = session.scalars(q.order_by(Embedding.id).offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {
                "id": str(e.id),
                "memoryId": str(e.memory_id),
                "modelId": e.model_id,
                "modelVersion": e.model_version,
                "contentHash": e.content_hash,
                "dimension": e.dimension,
                "vectorJson": e.vector_json,
            }
            for e in rows
        ]

    elif entity == "conversations":
        q = select(Conversation)
        if persona_ids:
            q = q.where(Conversation.persona_id.in_(persona_ids))
        rows = session.scalars(q.order_by(Conversation.id).offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {
                "id": str(c.id),
                "personaId": str(c.persona_id),
                "sessionId": str(c.session_id),
                "channel": c.channel,
                "compactedThroughSequence": c.compacted_through_sequence,
                "createdAt": c.created_at.isoformat() if c.created_at else None,
                "updatedAt": c.updated_at.isoformat() if c.updated_at else None,
            }
            for c in rows
        ]

    elif entity == "messages":
        q = select(Message).join(Conversation, Conversation.id == Message.conversation_id)
        if persona_ids:
            q = q.where(Conversation.persona_id.in_(persona_ids))
        rows = session.scalars(q.order_by(Message.id).offset(offset).limit(limit + 1)).all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        records = [
            {
                "id": str(m.id),
                "conversationId": str(m.conversation_id),
                "idempotencyKey": m.idempotency_key,
                "role": m.role,
                "content": m.content,
                "sequence": m.sequence,
                "tokenEstimate": m.token_estimate,
                "participantId": str(m.participant_id) if m.participant_id else None,
                "createdAt": m.created_at.isoformat() if m.created_at else None,
            }
            for m in rows
        ]
    else:
        raise ValueError(f"Unknown entity {entity}")

    return {
        "entity": entity,
        "offset": offset,
        "limit": limit,
        "count": len(records),
        "hasMore": has_more,
        "records": records,
    }


def _parse_dt(val: str | None) -> datetime | None:
    if not val:
        return None
    return datetime.fromisoformat(str(val).replace("Z", "+00:00"))


def import_chunk(session: Session, body: dict) -> dict:
    entity = body["entity"]
    mode = body.get("mode", "merge")
    records = body.get("records") or []
    inserted = updated = skipped = 0

    for raw in records:
        if entity == "personas":
            pid = uuid.UUID(raw["id"])
            existing = session.get(Persona, pid)
            if existing:
                if mode == "skip_existing":
                    skipped += 1
                    continue
                existing.external_id = raw["externalId"]
                existing.display_name = raw.get("displayName")
                updated += 1
            else:
                session.add(
                    Persona(
                        id=pid,
                        external_id=raw["externalId"],
                        display_name=raw.get("displayName"),
                        created_at=_parse_dt(raw.get("createdAt")),
                    )
                )
                inserted += 1

        elif entity == "participants":
            pid = uuid.UUID(raw["id"])
            existing = session.get(Participant, pid)
            if existing and mode == "skip_existing":
                skipped += 1
                continue
            if existing:
                existing.display_name = raw.get("displayName")
                existing.external_id = raw.get("externalId")
                existing.kind = raw.get("kind", "user")
                existing.last_interaction_at = _parse_dt(raw.get("lastInteractionAt"))
                updated += 1
            else:
                session.add(
                    Participant(
                        id=pid,
                        persona_id=uuid.UUID(raw["personaId"]),
                        kind=raw.get("kind", "user"),
                        display_name=raw.get("displayName"),
                        external_id=raw.get("externalId"),
                        last_interaction_at=_parse_dt(raw.get("lastInteractionAt")),
                    )
                )
                inserted += 1

        elif entity == "memories":
            from memory_module.db.models import LifecycleState, MemoryKind, MemoryScope

            mid = uuid.UUID(raw["id"])
            existing = session.get(Memory, mid)
            if existing and mode == "skip_existing":
                skipped += 1
                continue
            fields = dict(
                persona_id=uuid.UUID(raw["personaId"]),
                kind=MemoryKind(raw["kind"]),
                scope=MemoryScope(raw.get("scope", "participant")),
                content=raw["content"],
                summary=raw.get("summary"),
                lifecycle_state=LifecycleState(raw["lifecycleState"]),
                confidence=float(raw.get("confidence", 0.5)),
                importance=float(raw.get("importance", 0.5)),
                content_hash=raw["contentHash"],
                version=int(raw.get("version", 1)),
                valid_from=_parse_dt(raw.get("validFrom")),
                valid_to=_parse_dt(raw.get("validTo")),
                occurred_at=_parse_dt(raw.get("occurredAt")),
                subject_participant_id=uuid.UUID(raw["subjectParticipantId"])
                if raw.get("subjectParticipantId")
                else None,
            )
            if existing:
                for k, v in fields.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                session.add(Memory(id=mid, **fields))
                inserted += 1
            session.flush()
            session.execute(
                text(
                    "UPDATE memories SET search_vector = to_tsvector('english', coalesce(summary, '') || ' ' || coalesce(content, '')) WHERE id = :id"
                ),
                {"id": mid},
            )

        elif entity == "memory_provenance":
            from memory_module.db.models import MemoryProvenance as MP

            rid = uuid.UUID(raw["id"])
            if session.get(MP, rid) and mode == "skip_existing":
                skipped += 1
                continue
            if session.get(MP, rid):
                skipped += 1
                continue
            session.add(
                MP(
                    id=rid,
                    memory_id=uuid.UUID(raw["memoryId"]),
                    source_type=raw["sourceType"],
                    source_id=uuid.UUID(raw["sourceId"]) if raw.get("sourceId") else None,
                    excerpt=raw.get("excerpt"),
                    recorded_at=_parse_dt(raw.get("recordedAt")),
                )
            )
            inserted += 1

        elif entity == "memory_relations":
            from memory_module.db.models import MemoryRelation as MR

            rid = uuid.UUID(raw["id"])
            if session.get(MR, rid) and mode == "skip_existing":
                skipped += 1
                continue
            if session.get(MR, rid):
                skipped += 1
                continue
            session.add(
                MR(
                    id=rid,
                    from_memory_id=uuid.UUID(raw["fromMemoryId"]),
                    to_memory_id=uuid.UUID(raw["toMemoryId"]),
                    relation_type=raw["relationType"],
                )
            )
            inserted += 1

        elif entity == "memory_involvements":
            mem_id = uuid.UUID(raw["memoryId"])
            part_id = uuid.UUID(raw["participantId"])
            exists = session.scalar(
                select(MemoryInvolvement).where(
                    MemoryInvolvement.memory_id == mem_id,
                    MemoryInvolvement.participant_id == part_id,
                )
            )
            if exists:
                skipped += 1
                continue
            session.add(MemoryInvolvement(memory_id=mem_id, participant_id=part_id))
            inserted += 1

        elif entity == "episodes":
            from memory_module.db.models import LifecycleState

            eid = uuid.UUID(raw["id"])
            existing = session.get(Episode, eid)
            if existing and mode == "skip_existing":
                skipped += 1
                continue
            fields = dict(
                persona_id=uuid.UUID(raw["personaId"]),
                conversation_id=uuid.UUID(raw["conversationId"]) if raw.get("conversationId") else None,
                summary=raw["summary"],
                importance=float(raw.get("importance", 0.5)),
                lifecycle_state=LifecycleState(raw.get("lifecycleState", "active")),
                started_at=_parse_dt(raw.get("startedAt")),
                ended_at=_parse_dt(raw.get("endedAt")),
                from_sequence=raw.get("fromSequence"),
                to_sequence=raw.get("toSequence"),
                idempotency_key=raw.get("idempotencyKey"),
            )
            if existing:
                for k, v in fields.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                session.add(Episode(id=eid, **fields))
                inserted += 1
            session.flush()
            session.execute(
                text("UPDATE episodes SET search_vector = to_tsvector('english', coalesce(summary, '')) WHERE id = :id"),
                {"id": eid},
            )

        elif entity == "embeddings":
            eid = uuid.UUID(raw["id"])
            existing = session.get(Embedding, eid)
            if existing and mode == "skip_existing":
                skipped += 1
                continue
            vector = raw.get("vectorJson")
            if existing:
                existing.model_id = raw["modelId"]
                existing.model_version = raw["modelVersion"]
                existing.content_hash = raw["contentHash"]
                existing.dimension = int(raw["dimension"])
                existing.vector_json = vector
                updated += 1
            else:
                session.add(
                    Embedding(
                        id=eid,
                        memory_id=uuid.UUID(raw["memoryId"]),
                        model_id=raw["modelId"],
                        model_version=raw["modelVersion"],
                        content_hash=raw["contentHash"],
                        dimension=int(raw["dimension"]),
                        vector_json=vector,
                    )
                )
                inserted += 1
            session.flush()
            if vector and len(vector) == int(raw["dimension"]):
                vec_literal = "[" + ",".join(f"{float(v):.8f}" for v in vector) + "]"
                session.execute(
                    text("UPDATE embeddings SET embedding = CAST(:vec AS vector) WHERE id = :id"),
                    {"vec": vec_literal, "id": eid},
                )

        elif entity == "conversations":
            cid = uuid.UUID(raw["id"])
            existing = session.get(Conversation, cid)
            if existing and mode == "skip_existing":
                skipped += 1
                continue
            fields = dict(
                persona_id=uuid.UUID(raw["personaId"]),
                session_id=uuid.UUID(raw["sessionId"]),
                channel=raw.get("channel", "dashboard"),
                compacted_through_sequence=int(raw.get("compactedThroughSequence", 0)),
            )
            if existing:
                for k, v in fields.items():
                    setattr(existing, k, v)
                updated += 1
            else:
                session.add(Conversation(id=cid, **fields))
                inserted += 1

        elif entity == "messages":
            mid = uuid.UUID(raw["id"])
            existing = session.get(Message, mid)
            if existing and mode == "skip_existing":
                skipped += 1
                continue
            if existing:
                skipped += 1
                continue
            session.add(
                Message(
                    id=mid,
                    conversation_id=uuid.UUID(raw["conversationId"]),
                    idempotency_key=raw["idempotencyKey"],
                    role=raw["role"],
                    content=raw.get("content"),
                    sequence=int(raw["sequence"]),
                    token_estimate=raw.get("tokenEstimate"),
                    participant_id=uuid.UUID(raw["participantId"]) if raw.get("participantId") else None,
                    created_at=_parse_dt(raw.get("createdAt")),
                )
            )
            inserted += 1
            session.flush()
            session.execute(
                text("UPDATE messages SET search_vector = to_tsvector('english', coalesce(content, '')) WHERE id = :id"),
                {"id": mid},
            )
        else:
            raise ValueError(f"Unknown entity {entity}")

    session.flush()
    return {"entity": entity, "inserted": inserted, "updated": updated, "skipped": skipped}
