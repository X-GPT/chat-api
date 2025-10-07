"""Tests for health check endpoint."""

from fastapi.testclient import TestClient

from rag_python.main import app

client = TestClient(app)


def test_health_check():
    """Test the health endpoint."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "healthy"
    assert "version" in data
    assert "environment" in data


def test_health_check_response_schema():
    """Test that the health response matches the expected schema."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()

    # Check all required fields are present
    assert "status" in data
    assert "version" in data
    assert "environment" in data

    # Check field types
    assert isinstance(data["status"], str)
    assert isinstance(data["version"], str)
    assert isinstance(data["environment"], str)


def test_health_check_returns_correct_version():
    """Test that health check returns the correct version."""
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["version"] == "0.1.0"
