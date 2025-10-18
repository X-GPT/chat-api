"""Tests for deterministic Qdrant point ID helpers."""

from rag_python.services.point_ids import (
    child_point_id,
    chunk_point_id,
    generate_point_id,
    parent_point_id,
    summary_point_id,
)


def test_generate_point_id_deterministic() -> None:
    """Same inputs should produce identical UUIDs."""
    first = generate_point_id("summary", "user123", 42)
    second = generate_point_id("summary", "user123", 42)
    assert first == second


def test_generate_point_id_varies_with_inputs() -> None:
    """Changing any component should produce a different UUID."""
    base = generate_point_id("summary", "user123", 42)
    assert base != generate_point_id("summary", "user456", 42)
    assert base != generate_point_id("summary", "user123", 99)
    assert base != generate_point_id("summary", "user123", 42, extra="foo")
    # Different point type even with same identifiers must differ
    assert base != generate_point_id("parent", "user123", 42)


def test_summary_parent_child_helpers() -> None:
    """Helper wrappers should leverage generate_point_id appropriately."""
    summary_id = summary_point_id("tenant", 7)
    parent_first = parent_point_id("tenant", 7, 0)
    parent_second = parent_point_id("tenant", 7, 1)
    child_first = child_point_id("tenant", 7, 0, 0)
    child_second = child_point_id("tenant", 7, 0, 1)

    # Helpers should produce distinct IDs within/between types
    assert len({summary_id, parent_first, parent_second, child_first, child_second}) == 5

    # Parent index differentiates IDs
    assert parent_first != parent_second

    # Child helper should match alias export
    assert child_second == chunk_point_id("tenant", 7, 0, 1)


def test_chunk_alias_matches_child() -> None:
    """chunk_point_id should remain backward compatible with child_point_id."""
    assert chunk_point_id("tenant", 99, 2, 3) == child_point_id("tenant", 99, 2, 3)
