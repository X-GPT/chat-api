#!/usr/bin/env python
"""Pilot migration test with small batch sizes to validate the system.

This script runs the ACTUAL migration (not simulated) with small batch sizes
and worker counts to validate the entire end-to-end workflow before running
with production-scale settings.

Key features:
- Uses optimized create_batches_from_db() for memory-efficient batch creation
- Small batch size (10) and few workers (2) for safe testing
- Processes ALL records in exported_ip_summary_id table
- 3-second warning before starting

To limit records for testing:
    CREATE TABLE public.exported_ip_summary_id_test AS
    SELECT * FROM public.exported_ip_summary_id
    ORDER BY id LIMIT 100;

Then modify the PostgreSQL function to read from the test table.
"""

import asyncio

from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.controller import MigrationController

logger = get_logger(__name__)


async def test_migration_pilot():
    """Run pilot migration with small settings to validate the system.

    This uses the same create_batches_from_db() method that production will use,
    ensuring we're testing the actual optimized code path.

    IMPORTANT: This will process ALL records in exported_ip_summary_id table.
    To limit the number of records, create a test table first (see docstring).
    """
    setup_logging()

    # Override settings for pilot migration
    settings = MigrationSettings()

    # Use small settings for validation
    original_batch_size = settings.batch_size
    original_max_workers = settings.max_workers

    settings.batch_size = 10  # Small batches for pilot
    settings.max_workers = 2  # Only 2 workers for pilot
    settings.resume_existing = False  # Always create new job for pilot

    logger.info("=" * 70)
    logger.info("PILOT MIGRATION TEST - Validating optimized batch creation")
    logger.info("=" * 70)
    logger.info(f"Batch size: {settings.batch_size}")
    logger.info(f"Max workers: {settings.max_workers}")
    logger.info(f"Production batch size: {original_batch_size}")
    logger.info(f"Production max workers: {original_max_workers}")
    logger.info("=" * 70)
    logger.warning(
        "\n⚠️  WARNING: This will process ALL records in exported_ip_summary_id table!"
    )
    logger.warning(
        "To limit records, create a test table (see script docstring) or Ctrl+C to cancel.\n"
    )

    # Give user a chance to cancel
    await asyncio.sleep(3)

    try:
        logger.info("\n--- Starting pilot migration ---\n")

        # Create controller with modified settings
        # This will use the optimized create_batches_from_db() method automatically
        controller = MigrationController(settings)

        # Run the migration with the optimized batch creation
        # No need to override anything - it uses create_batches_from_db() by default
        await controller.run()

        logger.info("\n" + "=" * 70)
        logger.info("✓ PILOT MIGRATION COMPLETED SUCCESSFULLY")
        logger.info("=" * 70)
        logger.info("\nNext steps:")
        logger.info(
            "1. Review the results in Supabase (ingestion_job and ingestion_batch tables)"
        )
        logger.info("2. Check Qdrant for the ingested points")
        logger.info("3. Verify the batch creation was fast and memory-efficient")
        logger.info("4. If successful, run the full migration with production settings")
        logger.info("=" * 70)
        return True

    except KeyboardInterrupt:
        logger.warning("\nPilot migration interrupted by user")
        return False
    except Exception as e:
        logger.error(f"\n✗ PILOT MIGRATION FAILED: {e}", exc_info=True)
        return False


if __name__ == "__main__":
    success = asyncio.run(test_migration_pilot())
    exit(0 if success else 1)
