"""Tests for the vector repository."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

pytest.importorskip("qdrant_client")

from qdrant_client import models as q  # noqa: E402

from rag_python.core.models import Parent  # noqa: E402
from rag_python.repositories.vector_repository import VectorRepository  # noqa: E402


def _make_service(**overrides: AsyncMock) -> SimpleNamespace:
    defaults = {
        "upsert_points": AsyncMock(),
        "retrieve_by_filter": AsyncMock(),
        "retrieve_by_ids": AsyncMock(),
        "delete": AsyncMock(),
        "set_payload": AsyncMock(),
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


@pytest.mark.asyncio
async def test_upsert_parents_delegates_to_service() -> None:
    service = _make_service()
    repo = VectorRepository(service)  # type: ignore[arg-type]

    parents = [
        Parent(
            id="parent-1",
            summary_id=101,
            member_code="tenant-a",
            parent_idx=0,
            text="Parent text",
            checksum="abc123",
            collection_ids=[1, 2],
        )
    ]

    await repo.upsert_parents(parents)

    service.upsert_points.assert_awaited_once()
    call = service.upsert_points.await_args_list[0]
    points_arg = call.args[0]
    assert len(points_arg) == 1
    point = points_arg[0]
    assert point.id == "parent-1"
    assert point.payload is not None
    assert point.payload["type"] == "parent"


@pytest.mark.asyncio
async def test_get_existing_checksum_returns_checksum() -> None:
    record = q.Record(
        id="parent-1",
        payload={"checksum": "deadbeef"},
        vector=None,
    )
    service = _make_service(retrieve_by_filter=AsyncMock(return_value=[record]))
    repo = VectorRepository(service)  # type: ignore[arg-type]

    checksum = await repo.get_existing_checksum(summary_id=55)

    assert checksum == "deadbeef"
    service.retrieve_by_filter.assert_awaited_once()
    call = service.retrieve_by_filter.await_args_list[0]
    filter_ = call.kwargs["filter_"]
    assert isinstance(filter_, q.Filter)
    assert len(filter_.must or []) == 2


@pytest.mark.asyncio
async def test_get_existing_checksum_handles_empty() -> None:
    service = _make_service(retrieve_by_filter=AsyncMock(return_value=[]))
    repo = VectorRepository(service)  # type: ignore[arg-type]

    checksum = await repo.get_existing_checksum(summary_id=99)

    assert checksum is None


@pytest.mark.asyncio
async def test_get_parents_maps_records() -> None:
    record = q.Record(
        id="parent-1",
        payload={
            "summary_id": 77,
            "member_code": "tenant",
            "parent_idx": 0,
            "parent_text": "stored text",
            "checksum": "deadbeef",
            "collection_ids": [4, 5],
        },
        vector=None,
    )
    service = _make_service(retrieve_by_ids=AsyncMock(return_value=[record]))
    repo = VectorRepository(service)  # type: ignore[arg-type]

    parents = await repo.get_parents(["parent-1"])

    assert len(parents) == 1
    parent = parents[0]
    assert parent.id == "parent-1"
    assert parent.summary_id == 77
    assert parent.member_code == "tenant"
    assert parent.collection_ids == [4, 5]


@pytest.mark.asyncio
async def test_delete_summary_tree_filters_on_summary_id() -> None:
    service = _make_service()
    repo = VectorRepository(service)  # type: ignore[arg-type]

    await repo.delete_summary_tree(summary_id=123)

    service.delete.assert_awaited_once()
    call = service.delete.await_args_list[0]
    filter_ = call.kwargs["filter_"]
    assert isinstance(filter_, q.Filter)
    must_conditions = filter_.must or []
    assert len(must_conditions) == 1
    condition = must_conditions[0]
    assert isinstance(condition, q.FieldCondition)
    assert condition.key == "summary_id"


@pytest.mark.asyncio
async def test_update_collection_ids_sets_payload() -> None:
    service = _make_service()
    repo = VectorRepository(service)  # type: ignore[arg-type]

    await repo.update_collection_ids(summary_id=555, collection_ids=[1, 2, 3])

    service.set_payload.assert_awaited_once()
    call = service.set_payload.await_args_list[0]
    assert call.kwargs["payload"] == {"collection_ids": [1, 2, 3]}
    filter_ = call.kwargs["filter_"]
    assert isinstance(filter_, q.Filter)


@pytest.mark.asyncio
async def test_get_collection_ids_returns_ids() -> None:
    record = q.Record(
        id="parent-uuid",
        payload={
            "collection_ids": [42, 7],
        },
        vector=None,
    )
    service = _make_service(retrieve_by_filter=AsyncMock(return_value=[record]))
    repo = VectorRepository(service)  # type: ignore[arg-type]

    result = await repo.get_collection_ids(summary_id=8)

    assert result == [42, 7]


@pytest.mark.asyncio
async def test_get_collection_ids_handles_invalid_payload() -> None:
    record = q.Record(
        id="parent-uuid",
        payload={"collection_ids": "not-a-list"},
        vector=None,
    )
    service = _make_service(retrieve_by_filter=AsyncMock(return_value=[record]))
    repo = VectorRepository(service)  # type: ignore[arg-type]

    result = await repo.get_collection_ids(summary_id=9)

    assert result == []
