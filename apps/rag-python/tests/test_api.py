"""Tests for API functionality."""

from fastapi.testclient import TestClient

from rag_python.main import app

client = TestClient(app)


def test_api_docs_available():
    """Test that API documentation is available."""
    response = client.get("/docs")
    assert response.status_code == 200


def test_redoc_available():
    """Test that ReDoc documentation is available."""
    response = client.get("/redoc")
    assert response.status_code == 200


def test_openapi_schema_available():
    """Test that OpenAPI schema is available."""
    response = client.get("/openapi.json")
    assert response.status_code == 200
    schema = response.json()
    assert "openapi" in schema
    assert "info" in schema
    assert schema["info"]["title"] == "RAG Python API"


def test_cors_headers_present():
    """Test that CORS headers are present in responses when Origin is set."""
    response = client.get("/api/v1/health", headers={"Origin": "http://localhost:3000"})
    assert response.status_code == 200
    # CORS headers are added by the middleware when Origin header is present
    assert "access-control-allow-origin" in response.headers


def test_security_headers_present():
    """Test that security headers are present."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert "x-content-type-options" in response.headers
    assert response.headers["x-content-type-options"] == "nosniff"
    assert "x-frame-options" in response.headers
    assert response.headers["x-frame-options"] == "DENY"


def test_invalid_endpoint_returns_404():
    """Test that invalid endpoints return 404."""
    response = client.get("/api/v1/nonexistent")
    assert response.status_code == 404
