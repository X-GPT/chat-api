"""Helpers to translate between domain models and Qdrant transport objects."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast

from qdrant_client import models as q

from rag_python.core.constants import (
    CHILD_SPARSE_VEC,
    CHILD_VEC,
    POINT_TYPE_CHILD,
    POINT_TYPE_PARENT,
)
from rag_python.core.models import ChildVector, Parent, SparseVector


def parent_to_point(parent: Parent) -> q.PointStruct:
    """Convert a parent payload into a Qdrant point."""
    payload = {
        "type": POINT_TYPE_PARENT,
        "summary_id": parent.summary_id,
        "member_code": parent.member_code,
        "parent_idx": parent.parent_idx,
        "parent_text": parent.text,
        "collection_ids": list(parent.collection_ids),
        "checksum": parent.checksum,
    }
    return q.PointStruct(id=parent.id, payload=payload, vector={})


def child_to_point(child: ChildVector) -> q.PointStruct:
    """Convert a child vector (dense + sparse) into a Qdrant point."""
    payload = {
        "type": POINT_TYPE_CHILD,
        "summary_id": child.summary_id,
        "member_code": child.member_code,
        "parent_id": child.parent_id,
        "parent_idx": child.parent_idx,
        "chunk_index": child.chunk_index,
        "collection_ids": list(child.collection_ids),
        "text": child.text,
    }

    dense_vectors = child.embedding
    sparse_vector = child.sparse_embedding

    vectors: q.VectorStruct = {}
    if dense_vectors is not None:
        vectors[CHILD_VEC] = dense_vectors
    if sparse_vector is not None:
        vectors[CHILD_SPARSE_VEC] = q.SparseVector(
            indices=sparse_vector.indices,
            values=sparse_vector.values,
        )

    return q.PointStruct(
        id=child.id,
        payload=payload,
        vector=vectors,
    )


def record_to_parent(record: q.Record) -> Parent:
    """Convert a Qdrant record into a Parent payload model."""
    payload = record.payload or {}
    return Parent(
        id=_stringify_point_id(record.id),
        summary_id=cast(int, payload.get("summary_id")),
        member_code=cast(str | None, payload.get("member_code")) or "",
        parent_idx=cast(int | None, payload.get("parent_idx")) or 0,
        text=cast(str | None, payload.get("parent_text")) or "",
        checksum=cast(str | None, payload.get("checksum")) or "",
        collection_ids=_coerce_int_list(payload.get("collection_ids")),
    )


def record_to_child(record: q.Record) -> ChildVector:
    """Convert a Qdrant record into a ChildVector model."""
    payload = record.payload or {}
    return ChildVector(
        id=_stringify_point_id(record.id),
        summary_id=cast(int, payload.get("summary_id")),
        member_code=cast(str | None, payload.get("member_code")) or "",
        parent_id=cast(str | None, payload.get("parent_id")) or "",
        parent_idx=cast(int | None, payload.get("parent_idx")) or 0,
        chunk_index=cast(int | None, payload.get("chunk_index")) or 0,
        text=cast(str | None, payload.get("text")) or "",
        collection_ids=_coerce_int_list(payload.get("collection_ids")),
        embedding=_extract_named_vector(record.vector, CHILD_VEC),
        sparse_embedding=_extract_sparse_vector(record.vector, CHILD_SPARSE_VEC),
    )


def _extract_named_vector(
    vector: q.VectorStructOutput | None,
    name: str,
) -> list[float] | None:
    if vector is None:
        return None

    if isinstance(vector, Mapping):
        value = vector.get(name)
        if value is None:
            return None
        if isinstance(value, list) and all(isinstance(x, (int, float)) for x in value):
            return value  # pyright: ignore[reportReturnType]
        raise ValueError(f"Expected vector to be a list, got {type(value)}")

    raise ValueError(f"Expected vector to be a mapping, got {type(vector)}")


def _extract_sparse_vector(
    vector: q.VectorStructOutput | None,
    name: str,
) -> SparseVector | None:
    if vector is None:
        return None

    if isinstance(vector, Mapping):
        value = vector.get(name)
        if value is None:
            return None
        if isinstance(value, q.SparseVector):
            return SparseVector(indices=list(value.indices), values=list(value.values))
        raise ValueError(f"Expected vector to be a sparse vector, got {type(value)}")

    raise ValueError(f"Expected vector to be a mapping, got {type(vector)}")


def _coerce_int_list(value: Any) -> list[int]:
    if value is None:
        return []
    if isinstance(value, list):
        result: list[int] = []
        for item in value:  # pyright: ignore[reportUnknownVariableType]
            coerced = _coerce_int(item)
            if coerced is not None:
                result.append(coerced)
        return result
    if isinstance(value, tuple):
        return _coerce_int_list(list(value))  # pyright: ignore[reportUnknownArgumentType]
    return []


def _coerce_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        try:
            return int(value)
        except ValueError:
            return None
    return None


def _stringify_point_id(value: Any) -> str:
    return str(value)
