"""Tests for configuration."""

from rag_python.config import Settings, get_settings


def test_settings_defaults():
    """Test that settings have correct default values."""
    settings = Settings()
    assert settings.app_name == "RAG Python API"
    assert settings.app_version == "0.1.0"
    assert settings.environment in ["development", "staging", "production"]
    assert settings.api_v1_prefix == "/api/v1"


def test_get_settings_returns_singleton():
    """Test that get_settings returns the same instance."""
    settings1 = get_settings()
    settings2 = get_settings()
    assert settings1 is settings2


def test_settings_cors_configuration():
    """Test CORS configuration defaults."""
    settings = Settings()
    assert settings.cors_origins == ["*"]
    assert settings.cors_credentials is True
    assert settings.cors_methods == ["*"]
    assert settings.cors_headers == ["*"]
