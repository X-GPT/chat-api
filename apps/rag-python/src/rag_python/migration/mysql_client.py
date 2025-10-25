"""MySQL client wrapper for async operations."""

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import aiomysql  # pyright: ignore[reportMissingTypeStubs]
from aiomysql import Pool  # pyright: ignore[reportMissingTypeStubs]

from rag_python.core.logging import get_logger
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import SummaryRecord

logger = get_logger(__name__)


class MySQLClient:
    """Async MySQL client for reading ip_summary table."""

    def __init__(self, settings: MigrationSettings):
        self.settings = settings
        self.pool: Pool | None = None
        self._validate_table_name()

    def _validate_table_name(self) -> None:
        """Validate table name to prevent SQL injection."""
        table_name = self.settings.mysql_table
        # Allow only alphanumeric, underscore, and dot (for db.table notation)
        if not all(c.isalnum() or c in ("_", ".") for c in table_name):
            raise ValueError(
                f"Invalid table name: {table_name}. "
                "Only alphanumeric characters, underscores, and dots are allowed."
            )

    async def connect(self) -> None:
        """Create connection pool."""
        logger.info(f"Connecting to MySQL: {self.settings.mysql_host}:{self.settings.mysql_port}")
        self.pool = await aiomysql.create_pool(  # pyright: ignore[reportUnknownMemberType]
            host=self.settings.mysql_host,
            port=self.settings.mysql_port,
            user=self.settings.mysql_user,
            password=self.settings.mysql_password,
            db=self.settings.mysql_database,
            minsize=1,
            maxsize=self.settings.mysql_pool_size,
            autocommit=True,
        )
        logger.info("MySQL connection pool created")

    async def close(self) -> None:
        """Close connection pool."""
        if self.pool:
            self.pool.close()  # pyright: ignore[reportUnknownMemberType]
            await self.pool.wait_closed()  # pyright: ignore[reportUnknownMemberType]
            logger.info("MySQL connection pool closed")

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[aiomysql.Connection]:
        """Acquire a connection from the pool."""
        if not self.pool:
            raise RuntimeError("MySQL client not connected")
        async with self.pool.acquire() as conn:  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
            yield conn

    async def get_records_by_ids(self, ids: list[int]) -> list[SummaryRecord]:
        """Fetch specific records by their IDs.

        Args:
            ids: List of summary IDs to fetch.

        Returns:
            List of SummaryRecord objects.
        """
        if not ids:
            return []

        logger.debug(f"Fetching {len(ids)} records from MySQL")
        async with self.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
                # Use parameterized query for IDs to prevent SQL injection
                # Note: Table name validated in __init__, safe to use in f-string
                placeholders = ",".join(["%s"] * len(ids))
                query = f"""
                    SELECT id, member_code, parse_content
                    FROM {self.settings.mysql_table}
                    WHERE id IN ({placeholders})
                """
                await cursor.execute(query, ids)  # pyright: ignore[reportUnknownMemberType]
                rows = await cursor.fetchall()  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]

                # Convert to Pydantic models
                records = [
                    SummaryRecord(
                        id=row["id"],  # pyright: ignore[reportUnknownArgumentType]
                        member_code=row["member_code"],  # pyright: ignore[reportUnknownArgumentType]
                        parse_content=row["parse_content"] or "",  # pyright: ignore[reportUnknownArgumentType]
                    )
                    for row in rows  # pyright: ignore[reportUnknownVariableType]
                    if row["parse_content"]  # Skip records with NULL content
                ]

                logger.debug(f"Fetched {len(records)}/{len(ids)} valid records")
                return records
