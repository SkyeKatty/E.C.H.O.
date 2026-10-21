import uuid

from sqlalchemy import text
from sqlalchemy.orm import Session

from memory_module.config import settings
from memory_module.embeddings.runtime import try_get_embedding_runtime
from memory_module.services.hybrid_rank import reciprocal_rank_fusion


def _fts_episode_ids(session: Session, persona_id: uuid.UUID, query: str, limit: int) -> list[uuid.UUID]:
    rows = session.execute(
        text(
            """
            SELECT id
            FROM episodes
            WHERE persona_id = :persona_id
              AND lifecycle_state = 'active'
              AND search_vector @@ plainto_tsquery('english', :query)
            ORDER BY ts_rank(search_vector, plainto_tsquery('english', :query)) DESC,
                     importance DESC,
                     coalesce(started_at, created_at) DESC
            LIMIT :lim
            """
        ),
        {"persona_id": persona_id, "query": query, "lim": limit},
    ).fetchall()
    return [row[0] for row in rows]


def _vector_episode_ids(
    session: Session,
    persona_id: uuid.UUID,
    query_vector: list[float],
    limit: int,
) -> list[uuid.UUID]:
    vec_literal = "[" + ",".join(f"{v:.8f}" for v in query_vector) + "]"
    try:
        rows = session.execute(
            text(
                """
                SELECT id
                FROM episodes
                WHERE persona_id = :persona_id
                  AND lifecycle_state = 'active'
                  AND embedding IS NOT NULL
                ORDER BY embedding <=> CAST(:qvec AS vector)
                LIMIT :lim
                """
            ),
            {"persona_id": persona_id, "qvec": vec_literal, "lim": limit},
        ).fetchall()
        return [row[0] for row in rows]
    except Exception:
        session.rollback()
        return []


def hybrid_episode_rows(
    session: Session,
    persona_id: uuid.UUID,
    query: str,
    limit: int,
) -> tuple[list[dict], bool]:
    """Returns (episode row dicts, vector_ranking_used)."""
    fetch = max(limit * 2, 12)
    fts_ids = _fts_episode_ids(session, persona_id, query, fetch)
    vec_ids: list[uuid.UUID] = []
    vector_used = False

    runtime = try_get_embedding_runtime()
    if runtime and query.strip():
        try:
            qvec = runtime.encode(query)
            pg_dim = settings.embedding_dimension or runtime.dimension
            if pg_dim == runtime.dimension:
                vec_ids = _vector_episode_ids(session, persona_id, qvec, fetch)
                vector_used = bool(vec_ids)
        except Exception:
            vec_ids = []

    lists = [ids for ids in (fts_ids, vec_ids) if ids]
    if lists:
        merged_ids = reciprocal_rank_fusion(lists)[:fetch]
    else:
        rows = session.execute(
            text(
                """
                SELECT id
                FROM episodes
                WHERE persona_id = :persona_id
                  AND lifecycle_state = 'active'
                ORDER BY importance DESC, coalesce(started_at, created_at) DESC
                LIMIT :lim
                """
            ),
            {"persona_id": persona_id, "lim": fetch},
        ).fetchall()
        merged_ids = [row[0] for row in rows]

    id_list = merged_ids[:limit]
    if not id_list:
        return [], vector_used

    placeholders = ", ".join(f":id{i}" for i in range(len(id_list)))
    params: dict = {f"id{i}": eid for i, eid in enumerate(id_list)}
    params["persona_id"] = persona_id
    order_case = " ".join(f"WHEN id = :id{i} THEN {i}" for i in range(len(id_list)))

    rows = session.execute(
        text(
            f"""
            SELECT id, summary, started_at, created_at, importance
            FROM episodes
            WHERE persona_id = :persona_id AND id IN ({placeholders})
            ORDER BY CASE {order_case} END
            """
        ),
        params,
    ).mappings().all()
    return [dict(r) for r in rows], vector_used
