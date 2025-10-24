"""Migration-specific configuration."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class MigrationSettings(BaseSettings):
    """Migration settings loaded from .env file (same as main app settings)."""

    model_config = SettingsConfigDict(
        env_file=".env",  # Use same .env as main app
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # MySQL Configuration (AWS RDS)
    mysql_host: str
    mysql_port: int = 3306
    mysql_user: str
    mysql_password: str
    mysql_database: str
    mysql_table: str = "ip_summary"
    mysql_pool_size: int = 10  # Connection pool size

    # Supabase Configuration
    supabase_url: str
    supabase_key: str  # Service role key (not anon key!)

    # Migration Configuration
    batch_size: int = 100
    max_workers: int = 5
    max_retries: int = 3
    worker_poll_interval: float = 1.0  # Seconds between batch claim attempts
    worker_heartbeat_interval: float = 30.0  # How often to log "still alive"
    batch_timeout_minutes: int = 10  # Consider batch stuck if processing > 10min

    # Reuse existing app settings for Qdrant/OpenAI
    # (loaded separately in worker via get_settings())
