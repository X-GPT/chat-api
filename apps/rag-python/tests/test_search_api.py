"""Tests for search API endpoint."""

from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from rag_python.main import app
from rag_python.schemas.search import (
    MatchingChild,
    SearchResponse,
    SearchResultItem,
    SummaryResults,
)

client = TestClient(app)


@pytest.fixture
def mock_search_service():
    """Create mock search service."""
    mock_service = AsyncMock()
    mock_service.search = AsyncMock()
    return mock_service


def test_search_endpoint_success(mock_search_service: AsyncMock):
    """Test successful search request."""
    from rag_python.dependencies import get_search_service

    # Mock search response with parent-based structure
    mock_response = SearchResponse(
        query="test query",
        results={
            "1": SummaryResults(
                summary_id=1,
                member_code="user123",
                chunks=[
                    SearchResultItem(
                        id="1_parent_0",
                        text="Full parent text content",
                        max_score=0.9,
                        chunk_index=0,
                        matching_children=[
                            MatchingChild(
                                id="1_child_0_0",
                                text="Test chunk content",
                                score=0.9,
                                chunk_index=0,
                            )
                        ],
                    )
                ],
                total_chunks=1,
                max_score=0.9,
            )
        },
        total_results=1,
    )
    mock_search_service.search.return_value = mock_response

    # Use FastAPI dependency override
    app.dependency_overrides[get_search_service] = lambda: mock_search_service

    try:
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
    finally:
        # Clean up override
        app.dependency_overrides.clear()


def test_search_endpoint_with_filters(mock_search_service: AsyncMock):
    """Test search with member_code and summary_id filters."""
    from rag_python.dependencies import get_search_service

    mock_response = SearchResponse(
        query="test",
        results={
            "1": SummaryResults(
                summary_id=1,
                member_code="user123",
                chunks=[
                    SearchResultItem(
                        id="1_parent_0",
                        text="Filtered parent text",
                        max_score=0.85,
                        chunk_index=0,
                        matching_children=[
                            MatchingChild(
                                id="1_child_0_0",
                                text="Filtered chunk",
                                score=0.85,
                                chunk_index=0,
                            )
                        ],
                    )
                ],
                total_chunks=1,
                max_score=0.85,
            )
        },
        total_results=1,
    )
    mock_search_service.search.return_value = mock_response

    # Use FastAPI dependency override
    app.dependency_overrides[get_search_service] = lambda: mock_search_service

    try:
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

        assert response.status_code == 200
        data = response.json()
        assert data["query"] == "test"
        assert data["total_results"] == 1
    finally:
        # Clean up override
        app.dependency_overrides.clear()


def test_search_endpoint_missing_query(mock_search_service: AsyncMock):
    """Test search with missing query field."""
    from rag_python.dependencies import get_search_service

    # Mock the dependency to avoid initialization issues
    app.dependency_overrides[get_search_service] = lambda: mock_search_service

    try:
        response = client.post(
            "/api/v1/search",
            json={
                "limit": 10,
            },
        )

        assert response.status_code == 422  # Validation error
    finally:
        app.dependency_overrides.clear()


def test_search_endpoint_invalid_limit(mock_search_service: AsyncMock):
    """Test search with invalid limit values."""
    from rag_python.dependencies import get_search_service

    # Mock the dependency to avoid initialization issues
    app.dependency_overrides[get_search_service] = lambda: mock_search_service

    try:
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
    finally:
        app.dependency_overrides.clear()


def test_search_endpoint_empty_query(mock_search_service: AsyncMock):
    """Test search with empty query string."""
    from rag_python.dependencies import get_search_service

    # Mock the dependency to avoid initialization issues
    app.dependency_overrides[get_search_service] = lambda: mock_search_service

    try:
        response = client.post(
            "/api/v1/search",
            json={
                "query": "",
                "limit": 10,
            },
        )

        assert response.status_code == 422  # Validation error (min_length=1)
    finally:
        app.dependency_overrides.clear()


def test_search_endpoint_default_values(mock_search_service: AsyncMock):
    """Test that default values are applied correctly."""
    from rag_python.dependencies import get_search_service

    mock_response = SearchResponse(
        query="test query",
        results={
            "1": SummaryResults(
                summary_id=1,
                member_code="user123",
                chunks=[
                    SearchResultItem(
                        id="1_parent_0",
                        text="Default values test",
                        max_score=0.8,
                        chunk_index=0,
                        matching_children=[
                            MatchingChild(
                                id="1_child_0_0",
                                text="Default chunk",
                                score=0.8,
                                chunk_index=0,
                            )
                        ],
                    )
                ],
                total_chunks=1,
                max_score=0.8,
            )
        },
        total_results=1,
    )
    mock_search_service.search.return_value = mock_response

    # Use FastAPI dependency override
    app.dependency_overrides[get_search_service] = lambda: mock_search_service

    try:
        response = client.post(
            "/api/v1/search",
            json={
                "query": "test query",
            },
        )

        assert response.status_code == 200
        data = response.json()
        assert data["query"] == "test query"
        assert data["total_results"] == 1
    finally:
        # Clean up override
        app.dependency_overrides.clear()


def test_search_endpoint_response_schema(mock_search_service: AsyncMock):
    """Test that response matches expected schema."""
    from rag_python.dependencies import get_search_service

    mock_response = SearchResponse(
        query="schema test",
        results={
            "1": SummaryResults(
                summary_id=1,
                member_code="user123",
                chunks=[
                    SearchResultItem(
                        id="1_parent_0",
                        text="Full parent text with multiple matching children",
                        max_score=0.95,
                        chunk_index=0,
                        matching_children=[
                            MatchingChild(
                                id="1_child_0_0",
                                text="Chunk 1",
                                score=0.95,
                                chunk_index=0,
                            ),
                            MatchingChild(
                                id="1_child_0_1",
                                text="Chunk 2",
                                score=0.85,
                                chunk_index=1,
                            ),
                        ],
                    ),
                ],
                total_chunks=1,
                max_score=0.95,
            ),
            "2": SummaryResults(
                summary_id=2,
                member_code="user123",
                chunks=[
                    SearchResultItem(
                        id="2_parent_0",
                        text="Parent text from summary 2",
                        max_score=0.8,
                        chunk_index=0,
                        matching_children=[
                            MatchingChild(
                                id="2_child_0_0",
                                text="Chunk from summary 2",
                                score=0.8,
                                chunk_index=0,
                            ),
                        ],
                    ),
                ],
                total_chunks=1,
                max_score=0.8,
            ),
        },
        total_results=2,
    )
    mock_search_service.search.return_value = mock_response

    # Use FastAPI dependency override
    app.dependency_overrides[get_search_service] = lambda: mock_search_service

    try:
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

        # Check parent chunk structure (new schema)
        parent_chunk = summary1["chunks"][0]
        assert "id" in parent_chunk
        assert "text" in parent_chunk
        assert "max_score" in parent_chunk
        assert "chunk_index" in parent_chunk
        assert "matching_children" in parent_chunk

        # Check matching children structure
        assert isinstance(parent_chunk["matching_children"], list)
        assert len(parent_chunk["matching_children"]) > 0
        matching_child = parent_chunk["matching_children"][0]
        assert "id" in matching_child
        assert "text" in matching_child
        assert "score" in matching_child
        assert "chunk_index" in matching_child
    finally:
        # Clean up override
        app.dependency_overrides.clear()


def test_search_endpoint_no_results(mock_search_service: AsyncMock):
    """Test search with no results."""
    from rag_python.dependencies import get_search_service

    mock_response = SearchResponse(
        query="nonexistent",
        results={},
        total_results=0,
    )
    mock_search_service.search.return_value = mock_response

    # Use FastAPI dependency override
    app.dependency_overrides[get_search_service] = lambda: mock_search_service

    try:
        response = client.post(
            "/api/v1/search",
            json={"query": "nonexistent"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["total_results"] == 0
        assert len(data["results"]) == 0
    finally:
        # Clean up override
        app.dependency_overrides.clear()
