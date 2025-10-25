#!/usr/bin/env python
"""Test MySQL connection and query capabilities."""

import asyncio

from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.mysql_client import MySQLClient

logger = get_logger(__name__)


async def test_mysql_connection():
    """Test MySQL connection with sample queries."""
    setup_logging()
    settings = MigrationSettings()

    logger.info("Testing MySQL connection...")
    logger.info(f"Host: {settings.mysql_host}")
    logger.info(f"Database: {settings.mysql_database}")
    logger.info(f"Table: {settings.mysql_table}")

    client = MySQLClient(settings)

    try:
        # Test connection
        await client.connect()
        logger.info("✓ MySQL connection established")

        # Test fetching sample records by IDs
        # Use some sample IDs to test get_records_by_ids()
        sample_ids = [1981614220625575936, 1981613025991327744, 1981612765621518336]
        logger.info(f"Testing get_records_by_ids with sample IDs: {sample_ids}")
        records = await client.get_records_by_ids(sample_ids)
        logger.info(f"✓ Successfully fetched {len(records)} sample records")

        for record in records:
            logger.info(
                f"  Record {record.id}: member_code={record.member_code}, "
                f"content_length={len(record.parse_content)}"
            )

        logger.info("\n✓ All MySQL tests passed!")
        return True

    except Exception as e:
        logger.error(f"✗ MySQL test failed: {e}", exc_info=True)
        return False

    finally:
        await client.close()


if __name__ == "__main__":
    success = asyncio.run(test_mysql_connection())
    exit(0 if success else 1)
