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
        qdrant_collection_prefix="test-collection",
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
def mock_children_vector_store():
    """Create mock children vector store."""
    mock_store = MagicMock()
    mock_store.async_add = AsyncMock()
    mock_store.aquery = AsyncMock()
    return mock_store


@pytest.fixture
def mock_parents_vector_store():
    """Create mock parents vector store."""
    mock_store = MagicMock()
    mock_store.async_add = AsyncMock()
    mock_store.aquery = AsyncMock()
    return mock_store


@pytest.fixture
def qdrant_service(
    settings: Settings,
    mock_async_qdrant_client: MagicMock,
    mock_children_vector_store: MagicMock,
    mock_parents_vector_store: MagicMock,
):
    """Create Qdrant service with mocked clients."""
    with (
        patch("rag_python.services.qdrant_service.AsyncQdrantClient") as mock_client_class,
        patch("rag_python.services.qdrant_service.QdrantVectorStore") as mock_store_class,
    ):
        mock_client_class.return_value = mock_async_qdrant_client
        # Return different stores for children and parents
        mock_store_class.side_effect = [mock_children_vector_store, mock_parents_vector_store]
        service = QdrantService(settings)
        service.aclient = mock_async_qdrant_client
        service.children_vector_store = mock_children_vector_store
        service.parents_vector_store = mock_parents_vector_store
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
    """Test when collections already exist."""
    from qdrant_client.models import CollectionDescription

    # Mock both collections exist
    mock_children = CollectionDescription(name="test-collection_children")
    mock_parents = CollectionDescription(name="test-collection_parents")
    qdrant_service.aclient.get_collections = AsyncMock(
        return_value=CollectionsResponse(collections=[mock_children, mock_parents])
    )

    await qdrant_service.ensure_collection_exists()

    # Verify collection check was called
    qdrant_service.aclient.get_collections.assert_called_once()


@pytest.mark.asyncio
async def test_delete_by_summary_id(qdrant_service: QdrantService):
    """Test deleting points by summary ID from both collections."""
    summary_id = 123

    # Configure mock
    qdrant_service.aclient.delete = AsyncMock()

    await qdrant_service.delete_by_summary_id(summary_id)

    # Verify delete was called twice (once for each collection)
    assert qdrant_service.aclient.delete.call_count == 2
    call_args_list = qdrant_service.aclient.delete.call_args_list
    collection_names = {call[1]["collection_name"] for call in call_args_list}
    assert collection_names == {"test-collection_children", "test-collection_parents"}


@pytest.mark.asyncio
async def test_delete_by_ids(qdrant_service: QdrantService):
    """Test deleting points by IDs from both collections."""
    # Configure mock
    qdrant_service.aclient.delete = AsyncMock()

    await qdrant_service.delete_by_ids(point_ids=["point1", "point2", "point3"])

    # Verify delete was called twice (default is "both")
    assert qdrant_service.aclient.delete.call_count == 2
    call_args_list = qdrant_service.aclient.delete.call_args_list
    collection_names = {call[1]["collection_name"] for call in call_args_list}
    assert collection_names == {"test-collection_children", "test-collection_parents"}


@pytest.mark.asyncio
async def test_search_hybrid(qdrant_service: QdrantService):
    """Test hybrid search for similar vectors on children collection."""
    from llama_index.core.schema import NodeWithScore, TextNode

    query = "Sample text"
    member_code = "user123"

    # Mock search results
    mock_node = TextNode(
        id_="node1",
        text="Sample text",
        metadata={"summary_id": 1, "member_code": "user123", "parent_id": "parent1"},
    )
    mock_node_with_score = NodeWithScore(node=mock_node, score=0.95)

    # Mock the embedding model to avoid real API calls
    with (
        patch("rag_python.services.qdrant_service.OpenAIEmbedding") as mock_embedding_class,
        patch("rag_python.services.qdrant_service.VectorStoreIndex") as mock_index_class,
    ):
        # Mock embedding instance
        mock_embedding = MagicMock()
        mock_embedding.aget_query_embedding = AsyncMock(return_value=[0.1] * 1536)
        mock_embedding_class.return_value = mock_embedding

        # Mock retriever
        mock_retriever = AsyncMock()
        mock_retriever.aretrieve = AsyncMock(return_value=[mock_node_with_score])

        # Mock index
        mock_index = MagicMock()
        mock_index.as_retriever = MagicMock(return_value=mock_retriever)
        mock_index_class.from_vector_store.return_value = mock_index

        results = await qdrant_service.search(
            query=query,
            member_code=member_code,
            limit=10,
            sparse_top_k=10,
        )

        # Verify embedding was created with correct parameters
        mock_embedding_class.assert_called_once()

        # Verify retriever was called
        mock_retriever.aretrieve.assert_called_once_with(query)

        # Verify results
        assert len(results) == 1
        assert results[0].id == "node1"
        assert results[0].score == 0.95
        assert results[0].payload is not None
        assert results[0].payload["summary_id"] == 1


@pytest.mark.asyncio
async def test_search_without_member_filter(qdrant_service: QdrantService):
    """Test searching without member code filter."""
    query = "Sample text"

    # Mock the embedding model to avoid real API calls
    with (
        patch("rag_python.services.qdrant_service.OpenAIEmbedding") as mock_embedding_class,
        patch("rag_python.services.qdrant_service.VectorStoreIndex") as mock_index_class,
    ):
        # Mock embedding instance
        mock_embedding = MagicMock()
        mock_embedding.aget_query_embedding = AsyncMock(return_value=[0.1] * 1536)
        mock_embedding_class.return_value = mock_embedding

        # Mock retriever returning no results
        mock_retriever = AsyncMock()
        mock_retriever.aretrieve = AsyncMock(return_value=[])

        # Mock index
        mock_index = MagicMock()
        mock_index.as_retriever = MagicMock(return_value=mock_retriever)
        mock_index_class.from_vector_store.return_value = mock_index

        results = await qdrant_service.search(
            query=query,
            member_code=None,
            limit=5,
        )

        # Verify retriever was called
        mock_retriever.aretrieve.assert_called_once_with(query)
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

    # Test getting children collection info (default)
    info = await qdrant_service.get_collection_info()

    # Verify info
    assert info.name == "test-collection_children"
    assert info.vectors_count == 100
    assert info.points_count == 50
    assert info.status == "green"

    # Test getting parents collection info
    info_parents = await qdrant_service.get_collection_info(collection="parents")
    assert info_parents.name == "test-collection_parents"


@pytest.mark.asyncio
async def test_get_node_by_id(qdrant_service: QdrantService):
    """Test retrieving a parent node by ID."""
    import json

    from llama_index.core.schema import TextNode

    # Mock retrieved point with LlamaIndex's actual storage format
    # LlamaIndex stores node content as JSON in "_node_content" field
    mock_point = MagicMock()
    mock_point.id = "parent_1"
    node_content = {
        "id_": "parent_1",
        "text": "Parent node text",
        "metadata": {
            "summary_id": 1,
            "member_code": "user1",
            "chunk_index": 0,
        },
        "embedding": None,
    }
    mock_point.payload = {
        "_node_content": json.dumps(node_content),
        "_node_type": "TextNode",
        "summary_id": 1,
        "member_code": "user1",
        "chunk_index": 0,
        "doc_id": "None",
        "document_id": "None",
        "ref_doc_id": "None",
    }
    qdrant_service.aclient.retrieve = AsyncMock(return_value=[mock_point])

    node = await qdrant_service.get_node_by_id("parent_1")

    # Verify node was retrieved from parents collection
    qdrant_service.aclient.retrieve.assert_called_once()
    call_kwargs = qdrant_service.aclient.retrieve.call_args[1]
    assert call_kwargs["collection_name"] == "test-collection_parents"

    # Verify node content
    assert node is not None
    assert isinstance(node, TextNode)
    assert node.id_ == "parent_1"
    assert node.text == "Parent node text"
    assert node.metadata["summary_id"] == 1


@pytest.mark.asyncio
async def test_get_node_by_id_not_found(qdrant_service: QdrantService):
    """Test retrieving a node that doesn't exist."""
    qdrant_service.aclient.retrieve = AsyncMock(return_value=[])

    node = await qdrant_service.get_node_by_id("nonexistent")

    # Verify None is returned
    assert node is None


@pytest.mark.asyncio
async def test_get_node_by_id_legacy_format(qdrant_service: QdrantService):
    """Test retrieving a node with legacy format (no _node_content)."""
    from llama_index.core.schema import TextNode

    # Mock retrieved point with legacy format (text directly in payload)
    mock_point = MagicMock()
    mock_point.id = "parent_2"
    mock_point.payload = {
        "text": "Legacy parent node text",
        "summary_id": 2,
        "member_code": "user2",
        "chunk_index": 1,
    }
    qdrant_service.aclient.retrieve = AsyncMock(return_value=[mock_point])

    node = await qdrant_service.get_node_by_id("parent_2")

    # Verify node content from legacy format
    assert node is not None
    assert isinstance(node, TextNode)
    assert node.id_ == "parent_2"
    assert node.text == "Legacy parent node text"
    assert node.metadata["summary_id"] == 2
    assert node.metadata["member_code"] == "user2"


@pytest.mark.asyncio
async def test_get_child_by_id(qdrant_service: QdrantService):
    """Test retrieving a child node by ID."""
    import json

    from llama_index.core.schema import TextNode

    # Mock retrieved point with LlamaIndex's actual storage format
    mock_point = MagicMock()
    mock_point.id = "child_1"
    node_content = {
        "id_": "child_1",
        "text": "Child node text content",
        "metadata": {
            "summary_id": 1,
            "member_code": "user1",
            "parent_id": "parent_1",
            "chunk_index": 0,
        },
        "embedding": None,
    }
    mock_point.payload = {
        "_node_content": json.dumps(node_content),
        "_node_type": "TextNode",
        "summary_id": 1,
        "member_code": "user1",
        "parent_id": "parent_1",
        "chunk_index": 0,
        "doc_id": "None",
        "document_id": "None",
        "ref_doc_id": "None",
    }
    qdrant_service.aclient.retrieve = AsyncMock(return_value=[mock_point])

    node = await qdrant_service.get_child_by_id("child_1")

    # Verify node was retrieved from children collection
    qdrant_service.aclient.retrieve.assert_called_once()
    call_kwargs = qdrant_service.aclient.retrieve.call_args[1]
    assert call_kwargs["collection_name"] == "test-collection_children"

    # Verify node content
    assert node is not None
    assert isinstance(node, TextNode)
    assert node.id_ == "child_1"
    assert node.text == "Child node text content"
    assert node.metadata["summary_id"] == 1
    assert node.metadata["parent_id"] == "parent_1"


@pytest.mark.asyncio
async def test_get_child_by_id_not_found(qdrant_service: QdrantService):
    """Test retrieving a child node that doesn't exist."""
    qdrant_service.aclient.retrieve = AsyncMock(return_value=[])

    node = await qdrant_service.get_child_by_id("nonexistent")

    # Verify None is returned
    assert node is None


@pytest.mark.asyncio
async def test_get_child_by_id_legacy_format(qdrant_service: QdrantService):
    """Test retrieving a child node with legacy format (no _node_content)."""
    from llama_index.core.schema import TextNode

    # Mock retrieved point with legacy format
    mock_point = MagicMock()
    mock_point.id = "child_2"
    mock_point.payload = {
        "text": "Legacy child node text",
        "summary_id": 2,
        "member_code": "user2",
        "parent_id": "parent_2",
        "chunk_index": 1,
    }
    qdrant_service.aclient.retrieve = AsyncMock(return_value=[mock_point])

    node = await qdrant_service.get_child_by_id("child_2")

    # Verify node content from legacy format
    assert node is not None
    assert isinstance(node, TextNode)
    assert node.id_ == "child_2"
    assert node.text == "Legacy child node text"
    assert node.metadata["summary_id"] == 2
    assert node.metadata["parent_id"] == "parent_2"
