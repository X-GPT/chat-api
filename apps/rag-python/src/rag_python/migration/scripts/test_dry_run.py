#!/usr/bin/env python
"""Dry-run test with first 100 records to verify end-to-end flow."""

import asyncio
import sys

from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.controller import MigrationController

logger = get_logger(__name__)


async def test_dry_run():
    """Run migration with first 100 records only."""
    setup_logging()

    # Override settings for dry run
    settings = MigrationSettings()

    # Force small test run
    original_batch_size = settings.batch_size
    original_max_workers = settings.max_workers

    settings.batch_size = 10  # Small batches
    settings.max_workers = 2  # Only 2 workers
    settings.resume_existing = False  # Always create new job

    logger.info("=" * 70)
    logger.info("DRY RUN TEST - First 100 records")
    logger.info("=" * 70)
    logger.info(f"Batch size: {settings.batch_size}")
    logger.info(f"Max workers: {settings.max_workers}")
    logger.info(f"Original batch size: {original_batch_size}")
    logger.info(f"Original max workers: {original_max_workers}")
    logger.info("=" * 70)

    # Create controller with modified settings
    controller = MigrationController(settings)

    # Monkey-patch to limit records
    original_get_all_ids = controller.mysql_client.get_all_ids if controller.mysql_client else None

    async def limited_get_all_ids():
        """Get only first 100 IDs."""
        if original_get_all_ids:
            all_ids = await original_get_all_ids()
            limited = all_ids[:100]
            logger.info(f"Limited to first {len(limited)} records (out of {len(all_ids)} total)")
            return limited
        return []

    try:
        # Apply monkey patch during planning phase
        logger.info("\n--- Starting dry run ---\n")

        # We need to patch after open_for_planning is called
        # So we'll override create_new_job instead
        original_create_new_job = controller.create_new_job

        async def limited_create_new_job():
            """Create job with limited IDs."""
            if not controller.mysql_client:
                raise RuntimeError("MySQL client not initialized")

            logger.info("Planning new migration job (LIMITED TO 100 RECORDS)...")

            # Get limited IDs
            all_ids = await controller.mysql_client.get_all_ids()
            limited_ids = all_ids[:100]
            total_records = len(limited_ids)

            logger.info(f"Using {total_records} records (limited from {len(all_ids)} total)")

            if total_records == 0:
                logger.error("No records found")
                sys.exit(1)

            # Split into batches
            batch_size = settings.batch_size
            batch_specs = []

            for i in range(0, total_records, batch_size):
                batch_ids = limited_ids[i : i + batch_size]
                batch_specs.append(
                    {
                        "batch_number": len(batch_specs),
                        "start_id": batch_ids[0],
                        "end_id": batch_ids[-1],
                        "record_ids": batch_ids,
                    }
                )

            total_batches = len(batch_specs)
            logger.info(
                f"Split {total_records:,} records into {total_batches:,} batches "
                f"of ~{batch_size} records each"
            )

            # Create job
            if not controller.supabase_client:
                raise RuntimeError("Supabase client not initialized")

            job = await controller.supabase_client.create_job(total_batches, total_records)
            await controller.supabase_client.create_batches(job.id, batch_specs)
            await controller.supabase_client.update_job_status(
                job.id, controller.supabase_client.__class__.__module__.split(".")[-2]
            )

            # Import JobStatus properly
            from rag_python.migration.models import JobStatus

            await controller.supabase_client.update_job_status(job.id, JobStatus.RUNNING)

            logger.info(f"Created job {job.id}")
            return job.id

        controller.create_new_job = limited_create_new_job

        # Run the migration
        await controller.run()

        logger.info("\n" + "=" * 70)
        logger.info("✓ DRY RUN COMPLETED SUCCESSFULLY")
        logger.info("=" * 70)
        return True

    except KeyboardInterrupt:
        logger.warning("\nDry run interrupted by user")
        return False
    except Exception as e:
        logger.error(f"\n✗ DRY RUN FAILED: {e}", exc_info=True)
        return False


if __name__ == "__main__":
    success = asyncio.run(test_dry_run())
    exit(0 if success else 1)
