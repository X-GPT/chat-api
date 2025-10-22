"""Tests for Qdrant mapper utilities."""

from __future__ import annotations

import math
from collections.abc import Sequence

import pytest

pytest.importorskip("qdrant_client")

from qdrant_client import models as q  # noqa: E402

from rag_python.adapters import qdrant_mapper  # noqa: E402
from rag_python.core.constants import (  # noqa: E402
    CHILD_SPARSE_VEC,
    CHILD_VEC,
    POINT_TYPE_CHILD,
    POINT_TYPE_PARENT,
)
from rag_python.core.models import (  # noqa: E402
    ChildVector,
    Parent,
    SparseVector,
)


def _assert_floats_close(left: Sequence[float] | None, right: Sequence[float] | None) -> None:
    if left is None or right is None:
        assert left == right
        return
    assert len(left) == len(right)
    for l, r in zip(left, right):
        assert math.isclose(l, r)


def test_parent_round_trip() -> None:
    parent = Parent(
        id="parent-uuid",
        summary_id=321,
        member_code="tenant-1",
        parent_idx=2,
        text="Parent text",
        checksum="deadbeef",
        collection_ids=[7, 11],
    )

    point = qdrant_mapper.parent_to_point(parent)
    assert point.id == parent.id
    assert point.payload is not None
    assert point.payload["type"] == POINT_TYPE_PARENT
    assert point.vector == {}

    record = q.Record(id=point.id, payload=point.payload, vector=point.vector)  # pyright: ignore[reportArgumentType]
    mapped = qdrant_mapper.record_to_parent(record)
    assert mapped == parent


def test_child_round_trip() -> None:
    child = ChildVector(
        id="child-uuid",
        summary_id=123,
        member_code="tenant-2",
        parent_id="parent-uuid",
        parent_idx=4,
        chunk_index=0,
        text="Chunk content",
        collection_ids=[3, 5],
        embedding=[0.9, 0.8],
        sparse_embedding=SparseVector(indices=[1, 5], values=[0.2, 0.7]),
    )

    point = qdrant_mapper.child_to_point(child)
    assert point.payload is not None
    assert point.payload["type"] == POINT_TYPE_CHILD
    assert point.payload["parent_id"] == child.parent_id
    assert point.vector is not None
    _assert_floats_close(point.vector[CHILD_VEC], child.embedding)  # pyright: ignore[reportCallIssue, reportArgumentType, reportIndexIssue]
    assert CHILD_SPARSE_VEC in point.vector  # pyright: ignore[reportOperatorIssue]
    sparse_entry = point.vector[CHILD_SPARSE_VEC]  # pyright: ignore[reportCallIssue, reportArgumentType, reportIndexIssue, reportUnknownVariableType]
    assert isinstance(sparse_entry, q.SparseVector)
    assert list(sparse_entry.indices) == [1, 5]
    _assert_floats_close(sparse_entry.values, [0.2, 0.7])

    record = q.Record(
        id=point.id,
        payload=point.payload,
        vector=point.vector,  # pyright: ignore[reportArgumentType]
    )
    mapped = qdrant_mapper.record_to_child(record)
    assert mapped.id == child.id
    assert mapped.summary_id == child.summary_id
    assert mapped.member_code == child.member_code
    assert mapped.parent_id == child.parent_id
    assert mapped.parent_idx == child.parent_idx
    assert mapped.chunk_index == child.chunk_index
    assert mapped.text == child.text
    assert mapped.collection_ids == child.collection_ids
    _assert_floats_close(mapped.embedding, child.embedding)
    assert mapped.sparse_embedding is not None
    assert mapped.sparse_embedding.indices == [1, 5]
    _assert_floats_close(mapped.sparse_embedding.values, [0.2, 0.7])
