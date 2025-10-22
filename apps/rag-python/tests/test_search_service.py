"""Tests for search service."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from rag_python.config import Settings
from rag_python.services.qdrant_service import QdrantService, SearchResult
from rag_python.services.search_service import SearchService


@pytest.fixture
def settings():
    """Create test settings."""
    return Settings(
        qdrant_url="http://localhost:6333",
        qdrant_api_key="test-key",
        qdrant_collection_name="test-collection",
        openai_api_key="test-openai-key",
        openai_embedding_model="text-embedding-3-small",
    )


@pytest.fixture
def mock_qdrant_service():
    """Create mock Qdrant service."""
    mock_service = MagicMock(spec=QdrantService)
    mock_service.search = AsyncMock()
    mock_service.get_node_by_id = AsyncMock()
    return mock_service


@pytest.fixture
def mock_embed_model():
    """Create mock embedding model."""
    mock_model = MagicMock()
    mock_model.aget_text_embedding = AsyncMock(
        return_value=[0.1] * 1536  # Mock embedding vector
    )
    return mock_model


@pytest.fixture
def search_service(
    settings: Settings,
    mock_qdrant_service: MagicMock,
    mock_embed_model: MagicMock,
):
    """Create search service with mocked dependencies."""
    with patch("rag_python.services.search_service.OpenAIEmbedding") as mock_embed_class:
        mock_embed_class.return_value = mock_embed_model
        service = SearchService(settings, mock_qdrant_service)
        service.embed_model = mock_embed_model
        yield service


@pytest.mark.asyncio
async def test_search_basic(
    search_service: SearchService,
    mock_qdrant_service: MagicMock,
    mock_embed_model: MagicMock,
):
    """Test basic search functionality with parent-based results."""
    from llama_index.core.schema import TextNode

    # Mock search results (2 children from same parent)
    mock_results = [
        SearchResult(
            id="1_child_0_0",
            score=0.9,
            payload={
                "summary_id": 1,
                "member_code": "user123",
                "text": "This is a test chunk",
                "parent_id": "1_parent_0",
                "chunk_index": 0,
            },
        ),
        SearchResult(
            id="1_child_0_1",
            score=0.8,
            payload={
                "summary_id": 1,
                "member_code": "user123",
                "text": "Another test chunk",
                "parent_id": "1_parent_0",
                "chunk_index": 1,
            },
        ),
    ]
    mock_qdrant_service.search.return_value = mock_results

    # Mock parent node retrieval
    mock_parent = TextNode(
        id_="1_parent_0",
        text="Full parent text containing both chunks",
        metadata={"summary_id": 1, "member_code": "user123", "chunk_index": 0},
    )
    mock_qdrant_service.get_node_by_id.return_value = mock_parent

    # Perform search
    response = await search_service.search(
        query="test query",
        member_code="user123",
        limit=10,
    )

    mock_qdrant_service.search.assert_called_once()

    # Verify parent was fetched
    mock_qdrant_service.get_node_by_id.assert_called_once_with("1_parent_0")

    # Verify response structure - now returns 1 parent with 2 matching children
    assert response.query == "test query"
    assert response.total_results == 1  # 1 parent (not 2 children)
    assert len(response.results) == 1
    assert "1" in response.results

    summary_result = response.results["1"]
    assert summary_result.summary_id == 1
    assert summary_result.member_code == "user123"
    assert summary_result.total_chunks == 1  # 1 parent chunk
    assert summary_result.max_score == 0.9
    assert len(summary_result.chunks) == 1

    # Verify parent chunk structure
    parent_chunk = summary_result.chunks[0]
    assert parent_chunk.id == "1_parent_0"
    assert parent_chunk.text == "Full parent text containing both chunks"
    assert parent_chunk.max_score == 0.9
    assert len(parent_chunk.matching_children) == 2

    # Verify matching children are included
    assert parent_chunk.matching_children[0].id == "1_child_0_0"
    assert parent_chunk.matching_children[0].score == 0.9
    assert parent_chunk.matching_children[1].id == "1_child_0_1"
    assert parent_chunk.matching_children[1].score == 0.8


@pytest.mark.asyncio
async def test_search_multiple_summaries(
    search_service: SearchService,
    mock_qdrant_service: MagicMock,
):
    """Test search with results from multiple summaries."""
    from llama_index.core.schema import TextNode

    mock_results = [
        SearchResult(
            id="1_child_0_0",
            score=0.9,
            payload={
                "summary_id": 1,
                "member_code": "user123",
                "text": "Chunk from summary 1",
                "parent_id": "1_parent_0",
                "chunk_index": 0,
            },
        ),
        SearchResult(
            id="2_child_0_0",
            score=0.85,
            payload={
                "summary_id": 2,
                "member_code": "user123",
                "text": "Chunk from summary 2",
                "parent_id": "2_parent_0",
                "chunk_index": 0,
            },
        ),
        SearchResult(
            id="1_child_0_1",
            score=0.7,
            payload={
                "summary_id": 1,
                "member_code": "user123",
                "text": "Another chunk from summary 1",
                "parent_id": "1_parent_0",
                "chunk_index": 1,
            },
        ),
    ]
    mock_qdrant_service.search.return_value = mock_results

    # Mock parent node retrieval for multiple parents
    def get_parent_by_id(parent_id: str):
        if parent_id == "1_parent_0":
            return TextNode(
                id_="1_parent_0",
                text="Full parent text from summary 1",
                metadata={"summary_id": 1, "member_code": "user123", "chunk_index": 0},
            )
        elif parent_id == "2_parent_0":
            return TextNode(
                id_="2_parent_0",
                text="Full parent text from summary 2",
                metadata={"summary_id": 2, "member_code": "user123", "chunk_index": 0},
            )
        return None

    mock_qdrant_service.get_node_by_id.side_effect = get_parent_by_id

    response = await search_service.search(query="test", limit=10)

    # With parent-based results: 2 parents (not 3 children)
    assert response.total_results == 2
    assert len(response.results) == 2
    assert "1" in response.results
    assert "2" in response.results

    # Verify parent-based results
    summary1 = response.results["1"]
    assert summary1.total_chunks == 1  # 1 parent chunk
    assert summary1.max_score == 0.9
    # Verify the parent has 2 matching children
    assert len(summary1.chunks[0].matching_children) == 2
    assert summary1.chunks[0].matching_children[0].score == 0.9
    assert summary1.chunks[0].matching_children[1].score == 0.7

    summary2 = response.results["2"]
    assert summary2.total_chunks == 1  # 1 parent chunk
    assert summary2.max_score == 0.85
    assert len(summary2.chunks[0].matching_children) == 1


@pytest.mark.asyncio
async def test_search_with_summary_id_filter(
    search_service: SearchService,
    mock_qdrant_service: MagicMock,
):
    """Test search with summary_id filter."""
    from llama_index.core.schema import TextNode

    mock_results = [
        SearchResult(
            id="1_child_0_0",
            score=0.9,
            payload={
                "summary_id": 1,
                "member_code": "user123",
                "text": "Chunk from summary 1",
                "parent_id": "1_parent_0",
                "chunk_index": 0,
            },
        ),
        SearchResult(
            id="2_child_0_0",
            score=0.85,
            payload={
                "summary_id": 2,
                "member_code": "user123",
                "text": "Chunk from summary 2",
                "parent_id": "2_parent_0",
                "chunk_index": 0,
            },
        ),
    ]
    mock_qdrant_service.search.return_value = mock_results

    # Mock parent node retrieval
    def get_parent_by_id(parent_id: str):
        if parent_id == "1_parent_0":
            return TextNode(
                id_="1_parent_0",
                text="Full parent text from summary 1",
                metadata={"summary_id": 1, "member_code": "user123", "chunk_index": 0},
            )
        elif parent_id == "2_parent_0":
            return TextNode(
                id_="2_parent_0",
                text="Full parent text from summary 2",
                metadata={"summary_id": 2, "member_code": "user123", "chunk_index": 0},
            )
        return None

    mock_qdrant_service.get_node_by_id.side_effect = get_parent_by_id

    # Search with summary_id filter
    response = await search_service.search(
        query="test",
        summary_id=1,
        limit=10,
    )

    # Only summary 1 results should be in response
    assert response.total_results == 1
    assert len(response.results) == 1
    assert "1" in response.results
    assert "2" not in response.results


@pytest.mark.asyncio
async def test_search_no_results(
    search_service: SearchService,
    mock_qdrant_service: MagicMock,
):
    """Test search with no results."""
    mock_qdrant_service.search.return_value = []

    response = await search_service.search(query="nonexistent", limit=10)

    assert response.query == "nonexistent"
    assert response.total_results == 0
    assert len(response.results) == 0


@pytest.mark.asyncio
async def test_search_with_none_payload(
    search_service: SearchService,
    mock_qdrant_service: MagicMock,
):
    """Test search handles results with None payload gracefully."""
    from llama_index.core.schema import TextNode

    mock_results = [
        SearchResult(id="1", score=0.9, payload=None),
        SearchResult(
            id="2_child_0_0",
            score=0.8,
            payload={
                "summary_id": 2,
                "member_code": "user123",
                "text": "Valid chunk",
                "parent_id": "2_parent_0",
                "chunk_index": 0,
            },
        ),
    ]
    mock_qdrant_service.search.return_value = mock_results

    # Mock parent node retrieval
    mock_parent = TextNode(
        id_="2_parent_0",
        text="Full parent text from summary 2",
        metadata={"summary_id": 2, "member_code": "user123", "chunk_index": 0},
    )
    mock_qdrant_service.get_node_by_id.return_value = mock_parent

    response = await search_service.search(query="test", limit=10)

    # Only the result with valid payload should be included
    assert response.total_results == 1
    assert len(response.results) == 1
    assert "2" in response.results


@pytest.mark.asyncio
async def test_search_error_handling(
    search_service: SearchService,
    mock_qdrant_service: MagicMock,
):
    """Test search error handling."""
    mock_qdrant_service.search.side_effect = Exception("Search failed")

    with pytest.raises(Exception, match="Search failed"):
        await search_service.search(query="test", limit=10)
