import hashlib
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from memory_module.db.models import (
    AuditEvent,
    LifecycleState,
    Memory,
    MemoryInvolvement,
    MemoryKind,
    MemoryProvenance,
    MemoryRelation,
    MemoryScope,
)
from memory_module.services.consolidation import (
    apply_supersedes,
    maybe_auto_promote,
    schedule_consolidation_job,
    _schedule_embedding_job,
)
from memory_module.services.participants import resolve_participant
from memory_module.services.persona import ensure_persona
from memory_module.services.scope import infer_scope, parse_occurred_at, resolve_involved


def _content_hash(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def search_memories(session: Session, persona_id: uuid.UUID, params: dict) -> dict:
    q = select(Memory).where(Memory.persona_id == persona_id)
    if params.get("kind"):
        q = q.where(Memory.kind == MemoryKind(params["kind"]))
    if params.get("scope"):
        q = q.where(Memory.scope == MemoryScope(params["scope"]))
    if params.get("lifecycleState"):
        q = q.where(Memory.lifecycle_state == LifecycleState(params["lifecycleState"]))
    else:
        q = q.where(Memory.lifecycle_state != LifecycleState.deleted)
    if params.get("subjectKey"):
        subject = resolve_participant(session, persona_id, {"key": params["subjectKey"]})
        if subject:
            q = q.where(Memory.subject_participant_id == subject.id)
        else:
            return {"items": [], "total": 0}
    if params.get("query"):
        result = session.execute(
            text(
                """
                SELECT id FROM memories
                WHERE persona_id = :persona_id
                  AND lifecycle_state != 'deleted'
                  AND search_vector @@ plainto_tsquery('english', :query)
                ORDER BY ts_rank(search_vector, plainto_tsquery('english', :query)) DESC
                LIMIT :lim OFFSET :off
                """
            ),
            {
                "persona_id": persona_id,
                "query": params["query"],
                "lim": params.get("limit", 25),
                "off": params.get("offset", 0),
            },
        )
        ids = [row[0] for row in result.fetchall()]
        if not ids:
            return {"items": [], "total": 0}
        memories = session.scalars(select(Memory).where(Memory.id.in_(ids))).all()
        order = {mid: i for i, mid in enumerate(ids)}
        memories.sort(key=lambda m: order.get(m.id, 9999))
    else:
        memories = session.scalars(
            q.order_by(Memory.updated_at.desc()).limit(params.get("limit", 25)).offset(params.get("offset", 0))
        ).all()

    subject_ids = {m.subject_participant_id for m in memories if m.subject_participant_id}
    subject_labels: dict = {}
    if subject_ids:
        from memory_module.db.models import Participant

        for p in session.scalars(select(Participant).where(Participant.id.in_(subject_ids))).all():
            subject_labels[p.id] = {"key": p.external_id, "displayName": p.display_name}

    return {
        "items": [
            {
                "id": str(m.id),
                "kind": m.kind.value,
                "summary": m.summary,
                "lifecycleState": m.lifecycle_state.value,
                "confidence": m.confidence,
                "importance": m.importance,
                "version": m.version,
                "updatedAt": m.updated_at.isoformat(),
                "occurredAt": m.occurred_at.isoformat() if m.occurred_at else None,
                "scope": m.scope.value,
                "subject": subject_labels.get(m.subject_participant_id) if m.subject_participant_id else None,
            }
            for m in memories
        ],
        "total": len(memories),
    }


def get_memory(session: Session, persona_id: uuid.UUID, memory_id: uuid.UUID) -> dict:
    mem = session.scalar(select(Memory).where(Memory.id == memory_id, Memory.persona_id == persona_id))
    if not mem or mem.lifecycle_state == LifecycleState.deleted:
        raise ValueError("Memory not found")
    prov = session.scalars(select(MemoryProvenance).where(MemoryProvenance.memory_id == mem.id)).all()
    return {
        "memory": {
            "id": str(mem.id),
            "kind": mem.kind.value,
            "lifecycleState": mem.lifecycle_state.value,
            "content": mem.content,
            "summary": mem.summary,
            "confidence": mem.confidence,
            "importance": mem.importance,
            "version": mem.version,
            "contentHash": mem.content_hash,
            "scope": mem.scope.value,
            "occurredAt": mem.occurred_at.isoformat() if mem.occurred_at else None,
        },
        "provenance": [
            {
                "id": str(p.id),
                "sourceType": p.source_type,
                "sourceId": str(p.source_id) if p.source_id else None,
                "recordedAt": p.recorded_at.isoformat(),
            }
            for p in prov
        ],
    }


def propose_memory(session: Session, persona_id: uuid.UUID, body: dict) -> dict:
    ensure_persona(session, persona_id)
    content = body["content"]
    h = _content_hash(content)
    subject = resolve_participant(session, persona_id, body.get("subject"))
    involved = resolve_involved(session, persona_id, body)
    scope = infer_scope(body, subject, involved)
    subject_id = subject.id if subject else None

    dup = session.scalar(
        select(Memory).where(
            Memory.persona_id == persona_id,
            Memory.content_hash == h,
            Memory.subject_participant_id == subject_id,
            Memory.scope == scope,
            Memory.lifecycle_state != LifecycleState.deleted,
        )
    )
    if dup:
        return {"memoryId": str(dup.id), "duplicate": True, "lifecycleState": dup.lifecycle_state.value}

    occurred_at = parse_occurred_at(body)
    mem = Memory(
        persona_id=persona_id,
        kind=MemoryKind(body.get("kind", "semantic")),
        content=content,
        summary=body.get("summary"),
        lifecycle_state=LifecycleState.candidate,
        confidence=body.get("confidence", 0.5),
        importance=body.get("importance", 0.5),
        content_hash=h,
        subject_participant_id=subject_id,
        scope=scope,
        occurred_at=occurred_at,
    )
    session.add(mem)
    session.flush()
    session.execute(
        text(
            "UPDATE memories SET search_vector = to_tsvector('english', coalesce(summary, '') || ' ' || coalesce(content, '')) WHERE id = :id"
        ),
        {"id": mem.id},
    )
    src = body.get("source", {})
    session.add(
        MemoryProvenance(
            memory_id=mem.id,
            source_type=src.get("type", "operator"),
            source_id=uuid.UUID(src["sourceId"]) if src.get("sourceId") else None,
            excerpt=src.get("excerpt"),
        )
    )
    for pid in {p.id for p in involved if p.id != subject_id}:
        session.add(MemoryInvolvement(memory_id=mem.id, participant_id=pid))
    if subject_id and scope == MemoryScope.social:
        session.add(MemoryInvolvement(memory_id=mem.id, participant_id=subject_id))

    if body.get("contradictionOfMemoryId"):
        session.add(
            MemoryRelation(
                from_memory_id=mem.id,
                to_memory_id=uuid.UUID(body["contradictionOfMemoryId"]),
                relation_type="contradicts",
            )
        )
    if body.get("supersedesMemoryId"):
        session.add(
            MemoryRelation(
                from_memory_id=mem.id,
                to_memory_id=uuid.UUID(body["supersedesMemoryId"]),
                relation_type="supersedes",
            )
        )
    for related_id in body.get("relatedMemoryIds") or []:
        session.add(
            MemoryRelation(
                from_memory_id=mem.id,
                to_memory_id=uuid.UUID(related_id),
                relation_type="related",
            )
        )
    session.add(
        AuditEvent(
            event_type="memory.proposed",
            entity_type="memory",
            entity_id=mem.id,
            metadata_json={"kind": mem.kind.value, "hash": h},
        )
    )
    promoted = maybe_auto_promote(session, mem)
    if not promoted:
        schedule_consolidation_job(session, mem.id, mem.content_hash)
    session.flush()
    state = mem.lifecycle_state.value
    return {
        "memoryId": str(mem.id),
        "duplicate": False,
        "lifecycleState": state,
        "promoted": promoted,
        "version": mem.version,
    }


def update_memory(session: Session, persona_id: uuid.UUID, body: dict) -> dict:
    mem = session.scalar(select(Memory).where(Memory.id == uuid.UUID(body["memoryId"]), Memory.persona_id == persona_id))
    if not mem or mem.lifecycle_state == LifecycleState.deleted:
        raise ValueError("Memory not found")
    if mem.version != body["expectedVersion"]:
        raise ValueError("Version conflict")
    if body.get("content"):
        mem.content = body["content"]
        mem.content_hash = _content_hash(mem.content)
    if body.get("summary") is not None:
        mem.summary = body["summary"]
    prev_state = mem.lifecycle_state
    if body.get("lifecycleState"):
        mem.lifecycle_state = LifecycleState(body["lifecycleState"])
    if body.get("confidence") is not None:
        mem.confidence = body["confidence"]
    if body.get("importance") is not None:
        mem.importance = body["importance"]
    mem.version += 1
    mem.updated_at = datetime.now(timezone.utc)
    session.execute(
        text(
            "UPDATE memories SET search_vector = to_tsvector('english', coalesce(summary, '') || ' ' || coalesce(content, '')) WHERE id = :id"
        ),
        {"id": mem.id},
    )
    if prev_state != LifecycleState.active and mem.lifecycle_state == LifecycleState.active:
        apply_supersedes(session, mem)
        _schedule_embedding_job(session, mem.id, mem.content_hash)
    session.flush()
    return {"memoryId": str(mem.id), "version": mem.version}


def delete_memory(session: Session, persona_id: uuid.UUID, body: dict) -> dict:
    mem = session.scalar(select(Memory).where(Memory.id == uuid.UUID(body["memoryId"]), Memory.persona_id == persona_id))
    if not mem or mem.lifecycle_state == LifecycleState.deleted:
        raise ValueError("Memory not found")
    if mem.version != body["expectedVersion"]:
        raise ValueError("Version conflict")
    mem.lifecycle_state = LifecycleState.deleted
    mem.valid_to = datetime.now(timezone.utc)
    mem.version += 1
    session.execute(text("DELETE FROM embeddings WHERE memory_id = :id"), {"id": mem.id})
    session.add(
        AuditEvent(
            event_type="memory.deleted",
            entity_type="memory",
            entity_id=mem.id,
            metadata_json={"reason": body.get("reason", "")[:200]},
        )
    )
    session.flush()
    return {"memoryId": str(mem.id), "deleted": True, "version": mem.version}
