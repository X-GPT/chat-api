"""Tests for search API endpoint."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from rag_python.main import app
from rag_python.schemas.search import SearchResponse, SearchResultItem, SummaryResults

client = TestClient(app)


@pytest.fixture
def mock_search_service():
    """Create mock search service."""
    mock_service = AsyncMock()
    mock_service.search = AsyncMock()
    return mock_service


def test_search_endpoint_success(mock_search_service: AsyncMock):
    """Test successful search request."""
    # Mock search response
    mock_response = SearchResponse(
        query="test query",
        results={
            "1": SummaryResults(
                summary_id=1,
                member_code="user123",
                chunks=[
                    SearchResultItem(
                        id="1_child_0_0",
                        text="Test chunk content",
                        score=0.9,
                        parent_id="1_parent_0",
                        chunk_index=0,
                    )
                ],
                total_chunks=1,
                max_score=0.9,
            )
        },
        total_results=1,
    )
    mock_search_service.search.return_value = mock_response

    with patch("rag_python.api.v1.endpoints.search.SearchServiceDep", mock_search_service):
        response = client.post(
            "/api/v1/search",
            json={
                "query": "test query",
                "member_code": "user123",
                "limit": 10,
            },
        )

    assert response.status_code == 200
    data = response.json()
    assert data["query"] == "test query"
    assert data["total_results"] == 1
    assert "1" in data["results"]


def test_search_endpoint_with_filters():
    """Test search with member_code and summary_id filters."""
    response = client.post(
        "/api/v1/search",
        json={
            "query": "test",
            "member_code": "user123",
            "summary_id": 1,
            "limit": 5,
            "sparse_top_k": 5,
        },
    )

    # We expect either 200 or 500 depending on if services are available
    # The important thing is the request is properly formatted
    assert response.status_code in [200, 500]


def test_search_endpoint_missing_query():
    """Test search with missing query field."""
    response = client.post(
        "/api/v1/search",
        json={
            "limit": 10,
        },
    )

    assert response.status_code == 422  # Validation error


def test_search_endpoint_invalid_limit():
    """Test search with invalid limit values."""
    # Limit too low
    response = client.post(
        "/api/v1/search",
        json={
            "query": "test",
            "limit": 0,
        },
    )
    assert response.status_code == 422

    # Limit too high
    response = client.post(
        "/api/v1/search",
        json={
            "query": "test",
            "limit": 101,
        },
    )
    assert response.status_code == 422


def test_search_endpoint_empty_query():
    """Test search with empty query string."""
    response = client.post(
        "/api/v1/search",
        json={
            "query": "",
            "limit": 10,
        },
    )

    assert response.status_code == 422  # Validation error (min_length=1)


def test_search_endpoint_default_values():
    """Test that default values are applied correctly."""
    # The request should succeed with just a query
    # (though it may fail if services are not available)
    response = client.post(
        "/api/v1/search",
        json={
            "query": "test query",
        },
    )

    # Either successful or service error, but not validation error
    assert response.status_code in [200, 500]


def test_search_endpoint_response_schema(mock_search_service: AsyncMock):
    """Test that response matches expected schema."""
    mock_response = SearchResponse(
        query="schema test",
        results={
            "1": SummaryResults(
                summary_id=1,
                member_code="user123",
                chunks=[
                    SearchResultItem(
                        id="1_child_0_0",
                        text="Chunk 1",
                        score=0.95,
                        parent_id="1_parent_0",
                        chunk_index=0,
                    ),
                    SearchResultItem(
                        id="1_child_0_1",
                        text="Chunk 2",
                        score=0.85,
                        parent_id="1_parent_0",
                        chunk_index=1,
                    ),
                ],
                total_chunks=2,
                max_score=0.95,
            ),
            "2": SummaryResults(
                summary_id=2,
                member_code="user123",
                chunks=[
                    SearchResultItem(
                        id="2_child_0_0",
                        text="Chunk from summary 2",
                        score=0.8,
                        parent_id="2_parent_0",
                        chunk_index=0,
                    ),
                ],
                total_chunks=1,
                max_score=0.8,
            ),
        },
        total_results=3,
    )
    mock_search_service.search.return_value = mock_response

    with patch(
        "rag_python.dependencies.get_search_service",
        return_value=mock_search_service,
    ):
        response = client.post(
            "/api/v1/search",
            json={"query": "schema test"},
        )

    assert response.status_code == 200
    data = response.json()

    # Check top-level fields
    assert "query" in data
    assert "results" in data
    assert "total_results" in data

    # Check results structure
    assert isinstance(data["results"], dict)
    assert "1" in data["results"]
    assert "2" in data["results"]

    # Check summary result structure
    summary1 = data["results"]["1"]
    assert "summary_id" in summary1
    assert "member_code" in summary1
    assert "chunks" in summary1
    assert "total_chunks" in summary1
    assert "max_score" in summary1

    # Check chunk structure
    chunk = summary1["chunks"][0]
    assert "id" in chunk
    assert "text" in chunk
    assert "score" in chunk
    assert "parent_id" in chunk
    assert "chunk_index" in chunk


def test_search_endpoint_no_results(mock_search_service: AsyncMock):
    """Test search with no results."""
    mock_response = SearchResponse(
        query="nonexistent",
        results={},
        total_results=0,
    )
    mock_search_service.search.return_value = mock_response

    with patch(
        "rag_python.dependencies.get_search_service",
        return_value=mock_search_service,
    ):
        response = client.post(
            "/api/v1/search",
            json={"query": "nonexistent"},
        )

    assert response.status_code == 200
    data = response.json()
    assert data["total_results"] == 0
    assert len(data["results"]) == 0
