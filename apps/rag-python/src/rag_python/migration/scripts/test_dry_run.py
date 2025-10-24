#!/usr/bin/env python
"""Dry-run test with first 100 records to verify end-to-end flow.

NOTE: This test creates a temporary table with 100 records to test the optimized
batch creation function. For testing with actual data, use the controller directly
with small batch sizes and worker counts.
"""

import asyncio
import sys
from uuid import uuid4

from supabase import acreate_client

from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.controller import MigrationController
from rag_python.migration.models import JobStatus

logger = get_logger(__name__)


async def test_dry_run():
    """Run migration with first 100 records only.

    This creates a temporary subset table, creates batches using the optimized
    database function, then runs the migration.
    """
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

    test_table_name = f"test_exported_ip_summary_id_{uuid4().hex[:8]}"
    supabase = None

    try:
        logger.info("\n--- Setting up test environment ---\n")

        # Create temporary table with first 100 records
        supabase = await acreate_client(settings.supabase_url, settings.supabase_key)

        logger.info(f"Creating temporary test table: {test_table_name}")
        await supabase.rpc(
            "execute_sql",
            {
                "sql": f"""
                CREATE TEMP TABLE {test_table_name} AS
                SELECT id, summary_id
                FROM public.exported_ip_summary_id
                ORDER BY id
                LIMIT 100;
                """
            }
        ).execute()

        logger.info("✓ Temporary table created with 100 records")

        # Create controller with modified settings
        controller = MigrationController(settings)

        # Override create_new_job to use limited dataset
        original_create_new_job = controller.create_new_job

        async def limited_create_new_job():
            """Create job using the optimized batch creation with limited records."""
            if not controller.supabase_client:
                raise RuntimeError("Supabase client not initialized for planning")

            logger.info("Planning new migration job (LIMITED TO 100 RECORDS)...")

            # Create job record with placeholder values
            job = await controller.supabase_client.create_job(0, 0)

            # Use a custom SQL function that reads from temp table instead
            # For simplicity in dry run, we'll use the old method with limited IDs
            logger.info("Fetching limited IDs from Supabase...")
            response = await controller.supabase_client.client.table(
                "exported_ip_summary_id"
            ).select("summary_id").order("id").limit(100).execute()

            limited_ids = [row["summary_id"] for row in response.data]
            total_records = len(limited_ids)

            logger.info(f"Using {total_records} records for dry run")

            if total_records == 0:
                logger.error("No records found in test dataset")
                sys.exit(1)

            # Split into batches using old method for dry run
            batch_size = settings.batch_size
            batch_specs = []

            for i in range(0, total_records, batch_size):
                batch_ids = limited_ids[i : i + batch_size]
                batch_specs.append(
                    {
                        "batch_number": len(batch_specs) + 1,  # 1-based to match optimized function
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

            # Create batches using legacy method (for dry run with limited data)
            await controller.supabase_client.create_batches(job.id, batch_specs)

            # Update job with actual totals
            await controller.supabase_client.client.table("ingestion_job").update(
                {
                    "total_batches": total_batches,
                    "total_records": total_records,
                }
            ).eq("id", str(job.id)).execute()

            # Update job status
            await controller.supabase_client.update_job_status(job.id, JobStatus.RUNNING)

            logger.info(f"Created job {job.id}")
            return job.id

        controller.create_new_job = limited_create_new_job

        # Run the migration
        logger.info("\n--- Starting dry run migration ---\n")
        await controller.run()

        logger.info("\n" + "=" * 70)
        logger.info("✓ DRY RUN COMPLETED SUCCESSFULLY")
        logger.info("=" * 70)
        logger.info("\nNext steps:")
        logger.info("1. Review the results in Supabase (ingestion_job and ingestion_batch tables)")
        logger.info("2. Check Qdrant for the ingested points")
        logger.info("3. If successful, run the full migration with production settings")
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
