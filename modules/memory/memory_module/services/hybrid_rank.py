"""Reciprocal rank fusion for FTS + vector candidate lists."""

from __future__ import annotations

import uuid


def reciprocal_rank_fusion(
    ranked_lists: list[list[uuid.UUID]],
    *,
    k: int = 60,
) -> list[uuid.UUID]:
    scores: dict[uuid.UUID, float] = {}
    for ids in ranked_lists:
        for rank, mid in enumerate(ids):
            scores[mid] = scores.get(mid, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores.keys(), key=lambda mid: scores[mid], reverse=True)
