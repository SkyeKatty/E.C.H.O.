"""Consolidation rules: near-duplicates, contradictions, promotion retry."""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from memory_module.config import settings
from memory_module.db.models import AuditEvent, LifecycleState, Memory, MemoryProvenance, MemoryRelation


def _near_duplicate_active_id(session: Session, mem: Memory) -> uuid.UUID | None:
    query_text = (mem.summary or mem.content or "")[:400].strip()
    if len(query_text) < 12:
        return None
    row = session.execute(
        text(
            """
            SELECT id, ts_rank(search_vector, plainto_tsquery('english', :query)) AS rank
            FROM memories
            WHERE persona_id = :persona_id
              AND lifecycle_state = 'active'
              AND id != :memory_id
              AND search_vector @@ plainto_tsquery('english', :query)
              AND subject_participant_id IS NOT DISTINCT FROM :subject_id
            ORDER BY rank DESC
            LIMIT 1
            """
        ),
        {
            "persona_id": mem.persona_id,
            "memory_id": mem.id,
            "query": query_text,
            "subject_id": mem.subject_participant_id,
        },
    ).first()
    if not row or float(row.rank) < settings.consolidation_duplicate_rank_min:
        return None
    return row.id


def _resolve_outgoing_contradictions(session: Session, mem: Memory) -> bool:
    """
    Returns True if no unresolved contradiction against an active memory remains.
    When the candidate is clearly stronger, supersede the older active memory.
    """
    rels = session.scalars(
        select(MemoryRelation).where(
            MemoryRelation.from_memory_id == mem.id,
            MemoryRelation.relation_type == "contradicts",
        )
    ).all()
    delta = settings.consolidation_contradiction_confidence_delta
    now = datetime.now(timezone.utc)
    unresolved = False

    for rel in rels:
        target = session.get(Memory, rel.to_memory_id)
        if not target or target.lifecycle_state != LifecycleState.active:
            continue
        if mem.confidence >= target.confidence + delta:
            target.lifecycle_state = LifecycleState.superseded
            target.valid_to = now
            target.version += 1
            session.add(
                AuditEvent(
                    event_type="memory.contradiction_resolved",
                    entity_type="memory",
                    entity_id=mem.id,
                    metadata_json={
                        "supersededMemoryId": str(target.id),
                        "reason": "higher_confidence_candidate",
                    },
                )
            )
        else:
            unresolved = True
            session.add(
                AuditEvent(
                    event_type="memory.contradiction_unresolved",
                    entity_type="memory",
                    entity_id=mem.id,
                    metadata_json={
                        "activeMemoryId": str(target.id),
                        "candidateConfidence": mem.confidence,
                        "activeConfidence": target.confidence,
                    },
                )
            )
    return not unresolved


def _merge_as_duplicate(session: Session, mem: Memory, canonical_id: uuid.UUID) -> bool:
    if mem.lifecycle_state != LifecycleState.candidate:
        return False
    canonical = session.get(Memory, canonical_id)
    if not canonical or canonical.lifecycle_state != LifecycleState.active:
        return False

    session.add(
        MemoryRelation(
            from_memory_id=mem.id,
            to_memory_id=canonical_id,
            relation_type="duplicate_of",
        )
    )
    for prov in session.scalars(select(MemoryProvenance).where(MemoryProvenance.memory_id == mem.id)).all():
        session.add(
            MemoryProvenance(
                memory_id=canonical_id,
                source_type=prov.source_type,
                source_id=prov.source_id,
                excerpt=prov.excerpt,
            )
        )
    mem.lifecycle_state = LifecycleState.superseded
    mem.valid_to = datetime.now(timezone.utc)
    mem.version += 1
    session.add(
        AuditEvent(
            event_type="memory.merged_duplicate",
            entity_type="memory",
            entity_id=mem.id,
            metadata_json={"canonicalMemoryId": str(canonical_id)},
        )
    )
    return True


def run_consolidation_for_memory(session: Session, memory_id: uuid.UUID) -> dict:
    mem = session.get(Memory, memory_id)
    if not mem or mem.lifecycle_state in (LifecycleState.deleted, LifecycleState.superseded):
        return {"action": "skipped", "reason": "not_consolidatable"}

    result: dict = {"memoryId": str(memory_id), "actions": []}

    if mem.lifecycle_state == LifecycleState.candidate:
        dup_id = _near_duplicate_active_id(session, mem)
        if dup_id and _merge_as_duplicate(session, mem, dup_id):
            result["actions"].append("merged_duplicate")
            session.flush()
            return result

    if mem.lifecycle_state == LifecycleState.candidate:
        if not _resolve_outgoing_contradictions(session, mem):
            result["actions"].append("contradiction_unresolved")
            session.flush()
            return result

    from memory_module.services.consolidation import maybe_auto_promote

    if mem.lifecycle_state == LifecycleState.candidate and maybe_auto_promote(session, mem):
        result["actions"].append("promoted")
    elif mem.lifecycle_state == LifecycleState.candidate:
        result["actions"].append("still_candidate")

    session.flush()
    return result
