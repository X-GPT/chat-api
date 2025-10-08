"""Tests for RAG service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from rag_python.config import Settings
from rag_python.services.qdrant_service import QdrantService
from rag_python.services.rag_service import RAGService


@pytest.fixture
def settings():
    """Create test settings."""
    return Settings(
        openai_api_key="test-key",
        openai_embedding_model="text-embedding-3-small",
        qdrant_url="http://localhost:6333",
        qdrant_api_key="test-qdrant-key",
        qdrant_collection_prefix="test-summaries",
        chunk_size=512,
        chunk_overlap=128,
        parent_chunk_size=2048,
    )


@pytest.fixture
def mock_qdrant_clients():
    """Create mock Qdrant clients."""
    with (
        patch("rag_python.services.qdrant_service.AsyncQdrantClient") as mock_client,
        patch("rag_python.services.qdrant_service.QdrantVectorStore") as mock_store,
    ):
        yield mock_client, mock_store


@pytest.fixture
def qdrant_service(settings: Settings, mock_qdrant_clients: tuple[MagicMock, MagicMock]):
    """Create Qdrant service with mocked clients."""
    service = QdrantService(settings)
    # Mock the methods we'll be calling
    service.ensure_collection_exists = AsyncMock()
    service.collection_exists = AsyncMock(return_value=True)
    service.delete_by_summary_id = AsyncMock()
    # Mock both vector stores that will be used by VectorStoreIndex
    service.children_vector_store = MagicMock()
    service.parents_vector_store = MagicMock()
    return service


# Testing Strategy:
# ==================
# This test suite uses a hybrid approach to balance test realism with isolation:
#
# 1. Mock at the boundaries: External API calls (OpenAI embeddings) are mocked
# 2. Use real value objects: TextNode instances are real, not mocked
# 3. Partially mock complex dependencies: SemanticSplitterNodeParser is mocked
#    since it requires embeddings, but SentenceSplitter is real (purely algorithmic)
#
# Benefits:
# - Tests are realistic: Real chunking algorithms and data structures
# - No API calls: Fast and deterministic without external dependencies
# - Simple test code: No need to mock get_content() since TextNodes are real
# - Catches real bugs: Integration between RAG service and chunking logic is tested


@pytest.fixture
def mock_openai_embedding():
    """Mock OpenAI embedding model for generating embeddings."""
    with patch("rag_python.services.rag_service.OpenAIEmbedding") as mock:
        mock_instance = MagicMock()
        # Mock the async aget_text_embedding method (called per text with asyncio.gather)
        mock_instance.aget_text_embedding = AsyncMock(
            return_value=[0.1] * 1536  # Mock single embedding
        )
        mock.return_value = mock_instance
        yield mock


@pytest.fixture
def mock_semantic_parser():
    """Mock SemanticSplitterNodeParser since it requires embeddings.

    We use real TextNodes so we don't need to mock get_content().
    """
    from typing import Any

    from llama_index.core.schema import TextNode

    with patch("rag_python.services.rag_service.SemanticSplitterNodeParser") as mock:
        # Create a mock parser instance
        parser_instance = MagicMock()

        # Make it return a real TextNode so get_content() works naturally
        async def mock_parse(documents: list[Any]) -> list[TextNode]:
            # Return one parent node per document
            nodes: list[TextNode] = []
            for doc in documents:
                node = TextNode(text=doc.text, metadata=doc.metadata.copy())
                nodes.append(node)
            return nodes

        # Mock the ASYNC version which is what the actual code calls
        parser_instance.aget_nodes_from_documents = AsyncMock(side_effect=mock_parse)
        mock.return_value = parser_instance
        yield mock


@pytest.fixture
def mock_vector_store_index():
    """Mock VectorStoreIndex to capture nodes being stored."""
    with patch("rag_python.services.rag_service.VectorStoreIndex") as mock:
        mock_instance = MagicMock()
        mock.return_value = mock_instance
        yield mock


@pytest.fixture
def rag_service(
    settings: Settings,
    qdrant_service: QdrantService,
    mock_openai_embedding: MagicMock,
    mock_semantic_parser: MagicMock,
    mock_vector_store_index: MagicMock,
):
    """Create RAG service with mocked semantic parser and embedding.

    The SentenceSplitter is real (purely algorithmic), but SemanticSplitterNodeParser
    is mocked since it requires embeddings. We use real TextNode objects to avoid
    needing to mock get_content().
    """
    service = RAGService(settings, qdrant_service)
    return service


@pytest.mark.asyncio
async def test_ingest_document(
    rag_service: RAGService,
    qdrant_service: QdrantService,
    mock_vector_store_index: MagicMock,
):
    """Test document ingestion."""
    summary_id = 123
    member_code = "user123"
    content = "This is a test document with some content."

    # Ingest document
    stats = await rag_service.ingest_document(
        summary_id=summary_id,
        member_code=member_code,
        content=content,
    )

    # Verify results
    assert stats.summary_id == summary_id
    assert stats.member_code == member_code
    assert stats.parent_chunks == 1
    # Real SentenceSplitter produces variable chunks based on content size
    # For this short content, expect 1 child chunk
    assert stats.child_chunks is not None
    assert stats.child_chunks >= 1
    assert stats.total_nodes == stats.parent_chunks + stats.child_chunks

    # Verify Qdrant methods were called
    qdrant_service.ensure_collection_exists.assert_called_once()  # type: ignore

    # Verify VectorStoreIndex was called TWICE (children + parents)
    assert mock_vector_store_index.call_count == 2

    # First call is for children, second is for parents
    children_call_kwargs = mock_vector_store_index.call_args_list[0].kwargs
    parents_call_kwargs = mock_vector_store_index.call_args_list[1].kwargs

    child_nodes = children_call_kwargs["nodes"]
    parent_nodes = parents_call_kwargs["nodes"]

    assert len(child_nodes) == stats.child_chunks
    assert len(parent_nodes) == stats.parent_chunks

    # Verify child node metadata (no node_type field with two-collection architecture)
    for child_node in child_nodes:
        assert child_node.metadata["summary_id"] == summary_id
        assert child_node.metadata["member_code"] == member_code
        assert "parent_id" in child_node.metadata

    # Verify parent node metadata (no node_type field with two-collection architecture)
    for parent_node in parent_nodes:
        assert parent_node.metadata["summary_id"] == summary_id
        assert parent_node.metadata["member_code"] == member_code


@pytest.mark.asyncio
async def test_update_document(
    rag_service: RAGService,
    qdrant_service: QdrantService,
    mock_vector_store_index: MagicMock,
):
    """Test document update."""
    summary_id = 123
    member_code = "user123"
    content = "Updated content."

    # Update document
    stats = await rag_service.update_document(
        summary_id=summary_id,
        member_code=member_code,
        content=content,
    )

    # Verify delete was called
    qdrant_service.delete_by_summary_id.assert_called_once_with(summary_id)  # type: ignore

    # Verify re-ingestion happened (VectorStoreIndex called twice: children + parents)
    assert mock_vector_store_index.call_count == 2

    # Verify stats
    assert stats.summary_id == summary_id
    assert stats.operation == "update"


@pytest.mark.asyncio
async def test_delete_document(
    rag_service: RAGService,
    qdrant_service: QdrantService,
):
    """Test document deletion."""
    # Mock Qdrant methods
    qdrant_service.delete_by_summary_id = AsyncMock()

    summary_id = 123

    # Delete document
    stats = await rag_service.delete_document(summary_id=summary_id)

    # Verify deletion
    qdrant_service.delete_by_summary_id.assert_called_once_with(summary_id)

    # Verify stats
    assert stats.summary_id == summary_id
    assert stats.operation == "delete"


@pytest.mark.asyncio
async def test_ingest_document_with_error(
    rag_service: RAGService,
    qdrant_service: QdrantService,
    mock_vector_store_index: MagicMock,
):
    """Test error handling during ingestion."""
    # Mock VectorStoreIndex to raise an error
    qdrant_service.ensure_collection_exists = AsyncMock()
    mock_vector_store_index.side_effect = Exception("Vector store error")

    summary_id = 123
    member_code = "user123"
    content = "Test content."

    # Ingest document should raise exception
    with pytest.raises(Exception, match="Vector store error"):
        await rag_service.ingest_document(
            summary_id=summary_id,
            member_code=member_code,
            content=content,
        )


@pytest.mark.asyncio
async def test_parent_child_relationship(
    rag_service: RAGService,
    qdrant_service: QdrantService,
    mock_vector_store_index: MagicMock,
):
    """Test parent-child relationship is maintained."""
    summary_id = 456
    member_code = "user456"
    content = "Test document for parent-child relationships."

    # Ingest document
    await rag_service.ingest_document(
        summary_id=summary_id,
        member_code=member_code,
        content=content,
    )

    # Get nodes from both VectorStoreIndex calls (children first, parents second)
    children_call_kwargs = mock_vector_store_index.call_args_list[0].kwargs
    parents_call_kwargs = mock_vector_store_index.call_args_list[1].kwargs

    child_nodes = children_call_kwargs["nodes"]
    parent_nodes = parents_call_kwargs["nodes"]

    # Verify relationships
    assert len(parent_nodes) > 0
    assert len(child_nodes) > 0

    # Each child should reference a parent
    for child in child_nodes:
        assert "parent_id" in child.metadata
        parent_id = child.metadata["parent_id"]
        # Verify parent exists
        matching_parents = [p for p in parent_nodes if p.id_ == parent_id]
        assert len(matching_parents) == 1


@pytest.mark.asyncio
async def test_member_code_filtering(
    rag_service: RAGService,
    qdrant_service: QdrantService,
    mock_vector_store_index: MagicMock,
):
    """Test member code is properly set for filtering."""
    summary_id = 789
    member_code = "user789"
    content = "Test content for member filtering."

    # Ingest document
    await rag_service.ingest_document(
        summary_id=summary_id,
        member_code=member_code,
        content=content,
    )

    # Get nodes from both VectorStoreIndex calls (children first, parents second)
    children_call_kwargs = mock_vector_store_index.call_args_list[0].kwargs
    parents_call_kwargs = mock_vector_store_index.call_args_list[1].kwargs

    all_nodes = children_call_kwargs["nodes"] + parents_call_kwargs["nodes"]

    # Verify all nodes have the member_code
    for node in all_nodes:
        assert node.metadata["member_code"] == member_code
