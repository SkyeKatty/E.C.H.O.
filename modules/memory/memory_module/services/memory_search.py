import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from memory_module.config import settings
from memory_module.embeddings.runtime import try_get_embedding_runtime
from memory_module.services.hybrid_rank import reciprocal_rank_fusion

def _scope_sql(table: str = "memories") -> str:
    return f"""
              AND (
                {table}.scope = 'general'
                OR (
                  {table}.scope = 'participant'
                  AND (:subject_id IS NULL OR {table}.subject_participant_id IS NULL OR {table}.subject_participant_id = :subject_id)
                )
                OR (
                  {table}.scope = 'social'
                  AND (
                    :subject_id IS NULL
                    OR {table}.subject_participant_id = :subject_id
                    OR EXISTS (
                      SELECT 1 FROM memory_involvements mi
                      WHERE mi.memory_id = {table}.id AND mi.participant_id = :subject_id
                    )
                  )
                )
              )
"""


def _fts_memory_ids(
    session: Session,
    persona_id: uuid.UUID,
    query: str,
    subject_id: uuid.UUID | None,
    limit: int,
) -> list[uuid.UUID]:
    params = {
        "persona_id": persona_id,
        "query": query,
        "lim": limit,
        "subject_id": subject_id,
    }
    rows = session.execute(
        text(
            f"""
            SELECT id
            FROM memories
            WHERE persona_id = :persona_id
              AND lifecycle_state = 'active'
              AND search_vector @@ plainto_tsquery('english', :query)
              {_scope_sql("memories")}
            ORDER BY ts_rank(search_vector, plainto_tsquery('english', :query)) DESC,
                     importance DESC,
                     coalesce(occurred_at, created_at) DESC
            LIMIT :lim
            """
        ),
        params,
    ).fetchall()
    return [row[0] for row in rows]


def _vector_memory_ids(
    session: Session,
    persona_id: uuid.UUID,
    query_vector: list[float],
    model_id: str,
    subject_id: uuid.UUID | None,
    limit: int,
) -> list[uuid.UUID]:
    vec_literal = "[" + ",".join(f"{v:.8f}" for v in query_vector) + "]"
    params = {
        "persona_id": persona_id,
        "model_id": model_id,
        "qvec": vec_literal,
        "lim": limit,
        "subject_id": subject_id,
    }
    try:
        rows = session.execute(
            text(
                f"""
                SELECT m.id
                FROM memories m
                INNER JOIN embeddings e
                  ON e.memory_id = m.id AND e.model_id = :model_id
                WHERE m.persona_id = :persona_id
                  AND m.lifecycle_state = 'active'
                  AND e.embedding IS NOT NULL
                  {_scope_sql("m")}
                ORDER BY e.embedding <=> CAST(:qvec AS vector)
                LIMIT :lim
                """
            ),
            params,
        ).fetchall()
        return [row[0] for row in rows]
    except Exception:
        session.rollback()
        return []


def hybrid_memory_rows(
    session: Session,
    persona_id: uuid.UUID,
    query: str,
    subject_id: uuid.UUID | None,
    limit: int,
) -> tuple[list[dict], bool]:
    """
    Returns (rows as mappings, vector_ranking_used).
    Each row: id, kind, scope, snippet, occurred_at, created_at
    """
    fetch = max(limit * 2, 20)
    fts_ids = _fts_memory_ids(session, persona_id, query, subject_id, fetch)
    vec_ids: list[uuid.UUID] = []
    vector_used = False

    runtime = try_get_embedding_runtime()
    if runtime:
        try:
            qvec = runtime.encode(query)
            pg_dim = settings.embedding_dimension or runtime.dimension
            if pg_dim == runtime.dimension:
                vec_ids = _vector_memory_ids(session, persona_id, qvec, runtime.model_id, subject_id, fetch)
                vector_used = bool(vec_ids)
        except Exception:
            vec_ids = []

    lists = [ids for ids in (fts_ids, vec_ids) if ids]
    if not lists:
        return [], vector_used
    merged_ids = reciprocal_rank_fusion(lists)[:fetch]

    id_list = merged_ids[:limit]
    placeholders = ", ".join(f":id{i}" for i in range(len(id_list)))
    params: dict = {f"id{i}": mid for i, mid in enumerate(id_list)}
    params["persona_id"] = persona_id
    order_case = " ".join(f"WHEN id = :id{i} THEN {i}" for i in range(len(id_list)))

    rows = session.execute(
        text(
            f"""
            SELECT id, kind, scope, coalesce(summary, left(content, 400)) AS snippet,
                   occurred_at, created_at
            FROM memories
            WHERE persona_id = :persona_id AND id IN ({placeholders})
            ORDER BY CASE {order_case} END
            """
        ),
        params,
    ).mappings().all()
    return [dict(r) for r in rows], vector_used
