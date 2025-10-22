"""Tests for LlamaIndex document builder helpers."""

from __future__ import annotations

import pytest

pytest.importorskip("llama_index")

from llama_index.core.schema import TextNode  # noqa: E402

from rag_python.core.models import Parent  # noqa: E402
from rag_python.services.document_builders import build_child_docs  # noqa: E402


def _make_parent(idx: int = 0) -> Parent:
    return Parent(
        id=f"parent-{idx}",
        summary_id=123,
        member_code="tenant",
        parent_idx=idx,
        text=f"parent text {idx}",
        checksum=f"checksum-{idx}",
        collection_ids=[1, 2],
    )


def test_build_child_docs_metadata_includes_parent_checksum() -> None:
    parent = _make_parent(0)
    child = TextNode(
        id_="child-0",
        text="child content",
        metadata={
            "parent_id": parent.id,
            "parent_idx": parent.parent_idx,
            "chunk_index": 0,
        },
    )

    docs = build_child_docs(
        member_code="tenant",
        summary_id=123,
        parents=[parent],
        child_nodes=[child],
        checksum="deadbeef",
        collection_ids=[10, 11],
    )

    assert len(docs) == 1
    doc = docs[0]
    assert doc.id_ == child.id_
    assert doc.text == child.text

    metadata = doc.metadata
    assert metadata["type"] == "child"
    assert metadata["summary_id"] == 123
    assert metadata["member_code"] == "tenant"
    assert metadata["parent_id"] == parent.id
    assert metadata["parent_idx"] == parent.parent_idx
    assert metadata["chunk_index"] == 0
    assert metadata["collection_ids"] == [10, 11]
    assert metadata["checksum"] == "deadbeef"
    assert metadata["parent_text_checksum"] == parent.checksum


def test_build_child_docs_returns_fresh_collection_id_lists() -> None:
    parent = _make_parent(1)
    child = TextNode(
        id_="child-1",
        text="content",
        metadata={
            "parent_id": parent.id,
            "parent_idx": parent.parent_idx,
            "chunk_index": 5,
        },
    )

    collection_ids = [42]
    docs = build_child_docs(
        member_code="tenant",
        summary_id=999,
        parents=[parent],
        child_nodes=[child],
        checksum="beadfeed",
        collection_ids=collection_ids,
    )

    meta_list = docs[0].metadata["collection_ids"]
    assert meta_list == [42]
    assert meta_list is not collection_ids

    # Mutating the returned list should not touch the original input
    meta_list.append(100)
    assert collection_ids == [42]


def test_build_child_docs_missing_metadata_key_raises() -> None:
    parent = _make_parent(2)
    child = TextNode(
        id_="child-2",
        text="content",
        metadata={
            "parent_id": parent.id,
            "parent_idx": parent.parent_idx,
            # chunk_index intentionally missing
        },
    )

    with pytest.raises(ValueError) as exc:
        build_child_docs(
            member_code="tenant",
            summary_id=456,
            parents=[parent],
            child_nodes=[child],
            checksum="feedface",
            collection_ids=[],
        )

    assert "missing metadata key" in str(exc.value)
