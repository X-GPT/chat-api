"""Tests for the minimal Qdrant service."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from qdrant_client import models as q

from rag_python.config import Settings
from rag_python.services.qdrant_service import QdrantService


@pytest.fixture
def settings() -> Settings:
    """Return test settings configured for the new single collection."""
    return Settings(
        qdrant_url="http://localhost:6333",
        qdrant_api_key="test-key",
        qdrant_collection_name="test-collection",
    )


@pytest.fixture
def mock_clients():
    """Patch Qdrant clients used by the service."""
    with (
        patch("rag_python.services.qdrant_service.QdrantClient") as mock_client_cls,
        patch("rag_python.services.qdrant_service.AsyncQdrantClient") as mock_async_cls,
    ):
        mock_client = MagicMock()
        mock_async = MagicMock()

        # Common async mocks used across tests
        mock_async.collection_exists = AsyncMock(return_value=False)
        mock_async.create_collection = AsyncMock()
        mock_async.create_payload_index = AsyncMock()
        mock_async.upsert = AsyncMock()
        mock_async.retrieve = AsyncMock()
        mock_async.scroll = AsyncMock()
        mock_async.delete = AsyncMock()
        mock_async.set_payload = AsyncMock()

        mock_client_cls.return_value = mock_client
        mock_async_cls.return_value = mock_async

        yield mock_client, mock_async


@pytest.fixture
def service(settings: Settings, mock_clients: tuple[MagicMock, MagicMock]) -> QdrantService:
    """Create a QdrantService instance with mocked clients."""
    return QdrantService(settings)


@pytest.mark.asyncio
async def test_ensure_schema_creates_collection(
    service: QdrantService,
    mock_clients: tuple[MagicMock, MagicMock],
) -> None:
    """Collection creation path should provision collection and indexes."""
    mock_async = mock_clients[1]
    mock_async.collection_exists.return_value = False

    await service.ensure_schema()

    mock_async.collection_exists.assert_awaited_once()
    mock_async.create_collection.assert_awaited_once()
    # 5 payload indexes (member_code, summary_id, collection_ids, type, checksum)
    assert mock_async.create_payload_index.await_count == 5


@pytest.mark.asyncio
async def test_ensure_schema_existing_collection_skips_create(
    service: QdrantService,
    mock_clients: tuple[MagicMock, MagicMock],
) -> None:
    """When collection already exists, ensure_schema should skip creation."""
    mock_async = mock_clients[1]
    mock_async.collection_exists.return_value = True

    await service.ensure_schema()

    mock_async.create_collection.assert_not_called()
    assert mock_async.create_payload_index.await_count == 5


@pytest.mark.asyncio
async def test_upsert_points_delegates_to_client(
    service: QdrantService,
    mock_clients: tuple[MagicMock, MagicMock],
) -> None:
    """Upsert should call the async client with provided points."""
    mock_async = mock_clients[1]
    points = [MagicMock(id="p1"), MagicMock(id="p2")]

    await service.upsert_points(points)

    mock_async.upsert.assert_awaited_once()
    call = mock_async.upsert.await_args_list[0]
    assert call.kwargs["collection_name"] == service.col
    assert call.kwargs["points"] == points
    assert call.kwargs["wait"] is True


@pytest.mark.asyncio
async def test_upsert_points_noop_for_empty(
    service: QdrantService,
    mock_clients: tuple[MagicMock, MagicMock],
) -> None:
    """Upserting nothing should not call the client."""
    mock_async = mock_clients[1]
    await service.upsert_points([])
    mock_async.upsert.assert_not_called()


@pytest.mark.asyncio
async def test_retrieve_by_ids(
    service: QdrantService,
    mock_clients: tuple[MagicMock, MagicMock],
) -> None:
    """retrieve_by_ids should delegate to AsyncQdrantClient.retrieve."""
    mock_async = mock_clients[1]
    record = MagicMock()
    mock_async.retrieve.return_value = [record]

    result = await service.retrieve_by_ids(["id-1"], with_payload=True)

    mock_async.retrieve.assert_awaited_once()
    call = mock_async.retrieve.await_args_list[0]
    assert call.kwargs["collection_name"] == service.col
    assert call.kwargs["ids"] == ["id-1"]
    assert result == [record]


@pytest.mark.asyncio
async def test_retrieve_by_filter(
    service: QdrantService,
    mock_clients: tuple[MagicMock, MagicMock],
) -> None:
    """retrieve_by_filter should use scroll under the hood."""
    mock_async = mock_clients[1]
    record = MagicMock()
    mock_async.scroll.return_value = ([record], None)

    filter_obj = MagicMock()
    result = await service.retrieve_by_filter(filter_obj, limit=10, with_payload=True)

    mock_async.scroll.assert_awaited_once()
    call = mock_async.scroll.await_args_list[0]
    assert call.kwargs["collection_name"] == service.col
    assert call.kwargs["scroll_filter"] == filter_obj
    assert call.kwargs["limit"] == 10
    assert result == [record]


@pytest.mark.asyncio
async def test_delete_requires_selector(service: QdrantService) -> None:
    """Deleting without ids or filter should raise."""
    with pytest.raises(ValueError):
        await service.delete()


@pytest.mark.asyncio
async def test_delete_by_ids(
    service: QdrantService,
    mock_clients: tuple[MagicMock, MagicMock],
) -> None:
    """delete_by_ids should forward to delete with ids."""
    mock_async = mock_clients[1]

    await service.delete_by_ids(["p1", "p2"])

    mock_async.delete.assert_awaited_once()
    call = mock_async.delete.await_args_list[0]
    assert call.kwargs["collection_name"] == service.col
    assert call.kwargs["points_selector"] == ["p1", "p2"]


@pytest.mark.asyncio
async def test_delete_by_summary_id(
    service: QdrantService,
    mock_clients: tuple[MagicMock, MagicMock],
) -> None:
    """delete_by_summary_id should build summary filter."""
    mock_async = mock_clients[1]

    await service.delete_by_summary_id(123)

    mock_async.delete.assert_awaited_once()
    call = mock_async.delete.await_args_list[0]
    selector = call.kwargs["points_selector"]
    assert isinstance(selector, q.Filter)
    must_conditions = selector.must or []
    assert len(must_conditions) == 1  # pyright: ignore[reportArgumentType]
    condition = must_conditions[0]  # pyright: ignore[reportIndexIssue, reportUnknownVariableType]
    assert isinstance(condition, q.FieldCondition)
    assert condition.key == "summary_id"
    assert isinstance(condition.match, q.MatchValue)
    assert condition.match.value == 123


@pytest.mark.asyncio
async def test_set_payload_requires_selector(service: QdrantService) -> None:
    """set_payload should validate selectors."""
    with pytest.raises(ValueError):
        await service.set_payload(payload={"foo": "bar"})


@pytest.mark.asyncio
async def test_set_payload_with_ids(
    service: QdrantService,
    mock_clients: tuple[MagicMock, MagicMock],
) -> None:
    """set_payload should pass ids through to the client."""
    mock_async = mock_clients[1]

    await service.set_payload(payload={"collection_ids": [1]}, ids=["id-123"])

    mock_async.set_payload.assert_awaited_once()
    call = mock_async.set_payload.await_args_list[0]
    assert call.kwargs["collection_name"] == service.col
    assert call.kwargs["payload"] == {"collection_ids": [1]}
    assert call.kwargs["points"] == ["id-123"]
