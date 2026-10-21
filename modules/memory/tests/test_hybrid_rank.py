import uuid

from memory_module.services.hybrid_rank import reciprocal_rank_fusion


def test_rrf_prefers_items_in_both_lists():
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    merged = reciprocal_rank_fusion([[a, b], [b, c]])
    assert merged[0] == b
    assert set(merged) == {a, b, c}
