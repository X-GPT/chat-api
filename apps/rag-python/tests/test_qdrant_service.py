"""Tests for Qdrant service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from qdrant_client.models import CollectionsResponse

from rag_python.config import Settings
from rag_python.services.qdrant_service import QdrantService


@pytest.fixture
def settings():
    """Create test settings."""
    return Settings(
        qdrant_url="http://localhost:6333",
        qdrant_api_key="test-key",
        qdrant_collection_name="test-collection",
    )


@pytest.fixture
def mock_async_qdrant_client():
    """Create mock async Qdrant client."""
    mock_client = MagicMock()
    mock_client.get_collections = AsyncMock()
    mock_client.delete = AsyncMock()
    mock_client.retrieve = AsyncMock()
    mock_client.get_collection = AsyncMock()
    return mock_client


@pytest.fixture
def mock_vector_store():
    """Create mock QdrantVectorStore."""
    mock_store = MagicMock()
    mock_store.async_add = AsyncMock()
    mock_store.aquery = AsyncMock()
    return mock_store


@pytest.fixture
def qdrant_service(
    settings: Settings, mock_async_qdrant_client: MagicMock, mock_vector_store: MagicMock
):
    """Create Qdrant service with mocked clients."""
    with (
        patch("rag_python.services.qdrant_service.AsyncQdrantClient") as mock_client_class,
        patch("rag_python.services.qdrant_service.QdrantVectorStore") as mock_store_class,
    ):
        mock_client_class.return_value = mock_async_qdrant_client
        mock_store_class.return_value = mock_vector_store
        service = QdrantService(settings)
        service.aclient = mock_async_qdrant_client
        service.vector_store = mock_vector_store
        yield service


@pytest.mark.asyncio
async def test_ensure_collection_exists_new(
    qdrant_service: QdrantService,
):
    """Test collection check when it doesn't exist."""
    # Configure mock to return empty collections
    qdrant_service.aclient.get_collections = AsyncMock(
        return_value=CollectionsResponse(collections=[])
    )

    await qdrant_service.ensure_collection_exists()

    # Verify collection check was called
    qdrant_service.aclient.get_collections.assert_called_once()


@pytest.mark.asyncio
async def test_ensure_collection_exists_already_exists(
    qdrant_service: QdrantService,
):
    """Test when collection already exists."""
    from qdrant_client.models import CollectionDescription

    # Mock collection exists
    mock_collection = CollectionDescription(name="test-collection")
    qdrant_service.aclient.get_collections = AsyncMock(
        return_value=CollectionsResponse(collections=[mock_collection])
    )

    await qdrant_service.ensure_collection_exists()

    # Verify collection check was called
    qdrant_service.aclient.get_collections.assert_called_once()


@pytest.mark.asyncio
async def test_delete_by_summary_id(qdrant_service: QdrantService):
    """Test deleting points by summary ID."""
    summary_id = 123

    # Configure mock
    qdrant_service.aclient.delete = AsyncMock()

    await qdrant_service.delete_by_summary_id(summary_id)

    # Verify delete was called with correct filter
    qdrant_service.aclient.delete.assert_called_once()
    call_kwargs = qdrant_service.aclient.delete.call_args[1]
    assert call_kwargs["collection_name"] == "test-collection"
    assert call_kwargs["points_selector"] is not None


@pytest.mark.asyncio
async def test_delete_by_ids(qdrant_service: QdrantService):
    """Test deleting points by IDs."""
    # Configure mock
    qdrant_service.aclient.delete = AsyncMock()

    await qdrant_service.delete_by_ids(point_ids=["point1", "point2", "point3"])

    # Verify delete was called
    qdrant_service.aclient.delete.assert_called_once()
    call_kwargs = qdrant_service.aclient.delete.call_args[1]
    assert call_kwargs["collection_name"] == "test-collection"


@pytest.mark.asyncio
async def test_search_hybrid(qdrant_service: QdrantService):
    """Test hybrid search for similar vectors."""
    from llama_index.core.schema import TextNode
    from llama_index.core.vector_stores import VectorStoreQueryResult

    query_vector = [0.5] * 1536
    member_code = "user123"

    # Mock search results
    mock_node = TextNode(
        id_="node1",
        text="Sample text",
        metadata={"summary_id": 1, "member_code": "user123", "node_type": "child"},
    )
    mock_result = VectorStoreQueryResult(
        nodes=[mock_node],
        similarities=[0.95],
        ids=["node1"],
    )
    qdrant_service.vector_store.aquery = AsyncMock(return_value=mock_result)

    results = await qdrant_service.search(
        query_vector=query_vector,
        member_code=member_code,
        limit=10,
        sparse_top_k=10,
    )

    # Verify hybrid search was called
    qdrant_service.vector_store.aquery.assert_called_once()

    # Verify results
    assert len(results) == 1
    assert results[0].id == "node1"
    assert results[0].score == 0.95
    assert results[0].payload is not None
    assert results[0].payload["summary_id"] == 1


@pytest.mark.asyncio
async def test_search_without_member_filter(qdrant_service: QdrantService):
    """Test searching without member code filter."""
    from llama_index.core.vector_stores import VectorStoreQueryResult

    query_vector = [0.5] * 1536

    mock_result = VectorStoreQueryResult(
        nodes=[],
        similarities=[],
        ids=[],
    )
    qdrant_service.vector_store.aquery = AsyncMock(return_value=mock_result)

    results = await qdrant_service.search(
        query_vector=query_vector,
        member_code=None,
        limit=5,
    )

    # Verify search was called
    qdrant_service.vector_store.aquery.assert_called_once()
    assert len(results) == 0


@pytest.mark.asyncio
async def test_get_collection_info(qdrant_service: QdrantService):
    """Test getting collection information."""
    # Mock collection info
    mock_info = MagicMock()
    mock_info.vectors_count = 100
    mock_info.points_count = 50
    mock_info.status = "green"
    qdrant_service.aclient.get_collection = AsyncMock(return_value=mock_info)

    info = await qdrant_service.get_collection_info()

    # Verify info
    assert info.name == "test-collection"
    assert info.vectors_count == 100
    assert info.points_count == 50
    assert info.status == "green"


@pytest.mark.asyncio
async def test_get_node_by_id(qdrant_service: QdrantService):
    """Test retrieving a node by ID."""
    from llama_index.core.schema import TextNode

    # Mock retrieved point
    mock_point = MagicMock()
    mock_point.id = "parent_1"
    mock_point.payload = {
        "text": "Parent node text",
        "summary_id": 1,
        "member_code": "user1",
        "node_type": "parent",
    }
    qdrant_service.aclient.retrieve = AsyncMock(return_value=[mock_point])

    node = await qdrant_service.get_node_by_id("parent_1")

    # Verify node was retrieved
    assert node is not None
    assert isinstance(node, TextNode)
    assert node.id_ == "parent_1"
    assert node.text == "Parent node text"
    assert node.metadata["node_type"] == "parent"


@pytest.mark.asyncio
async def test_get_node_by_id_not_found(qdrant_service: QdrantService):
    """Test retrieving a node that doesn't exist."""
    qdrant_service.aclient.retrieve = AsyncMock(return_value=[])

    node = await qdrant_service.get_node_by_id("nonexistent")

    # Verify None is returned
    assert node is None
