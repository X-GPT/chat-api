"""Application configuration and settings."""

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
        frozen=True,
    )

    # Application
    app_name: str = "RAG Python API"
    app_version: str = "0.1.0"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False

    # API
    api_v1_prefix: str = "/api/v1"

    # CORS
    cors_origins: list[str] = ["*"]
    cors_credentials: bool = True
    cors_methods: list[str] = ["*"]
    cors_headers: list[str] = ["*"]

    # Logging
    log_level: str = "INFO"

    # AWS SQS Configuration
    aws_region: str = "us-east-1"
    aws_access_key_id: str | None = None
    aws_secret_access_key: str | None = None
    sqs_queue_url: str | None = None
    sqs_max_messages: int = 10  # Max messages to receive per batch (1-10)
    sqs_wait_time_seconds: int = 20  # Long polling wait time (0-20)
    sqs_visibility_timeout: int = 300  # Message visibility timeout in seconds
    sqs_message_retention_period: int = 345600  # 4 days in seconds

    # Worker Configuration
    worker_poll_interval: int = 0  # Seconds between polls (0 for continuous)
    worker_max_retries: int = 3
    worker_shutdown_timeout: int = 30  # Graceful shutdown timeout

    # OpenAI Configuration
    openai_api_key: str | None = None
    openai_embedding_model: str = "text-embedding-3-small"
    openai_max_retries: int = 20
    # Qdrant Configuration
    qdrant_url: str = "https://your-cluster.qdrant.io"
    qdrant_api_key: str | None = None
    qdrant_collection_name: str = "memos-2025-10-25"
    qdrant_prefer_grpc: bool = False
    qdrant_local_mode: bool = False
    qdrant_timeout: int = 30  # Timeout in seconds

    # RAG Configuration
    chunk_size: int = 512  # Child chunk size
    chunk_overlap: int = 128
    parent_chunk_size: int = 2048  # Parent chunk size

    # Hybrid Search Configuration
    sparse_top_k: int = 10  # Number of results from sparse (BM25) search
    hybrid_alpha: float = 0.5  # Fusion weight (0.0 = sparse only, 1.0 = dense only)


@lru_cache
def get_settings() -> Settings:
    """Get cached settings instance.

    Returns:
        Settings: Application settings instance.
    """
    return Settings()
