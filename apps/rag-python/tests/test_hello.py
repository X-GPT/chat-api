"""Tests for hello world endpoint."""

from fastapi.testclient import TestClient

from rag_python.main import app

client = TestClient(app)


def test_hello_world():
    """Test the hello-world endpoint."""
    response = client.get("/api/v1/hello-world")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello, World!"}


def test_hello_world_response_schema():
    """Test that the response matches the expected schema."""
    response = client.get("/api/v1/hello-world")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
    assert isinstance(data["message"], str)


def test_hello_world_has_correct_content_type():
    """Test that the response has correct content type."""
    response = client.get("/api/v1/hello-world")
    assert response.status_code == 200
    assert "application/json" in response.headers["content-type"]
