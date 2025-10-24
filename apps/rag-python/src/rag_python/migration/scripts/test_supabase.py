#!/usr/bin/env python
"""Test Supabase connection and table operations."""

import asyncio

from supabase import acreate_client

from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import JobStatus
from rag_python.migration.supabase_client import SupabaseClient

logger = get_logger(__name__)


async def test_supabase_connection():
    """Test Supabase connection and CRUD operations."""
    setup_logging()
    settings = MigrationSettings()

    logger.info("Testing Supabase connection...")
    logger.info(f"URL: {settings.supabase_url}")

    if not settings.supabase_url or not settings.supabase_key:
        raise ValueError("Supabase URL and key must be set")
    async_client = await acreate_client(settings.supabase_url, settings.supabase_key)
    client = SupabaseClient(async_client, settings)

    test_job_id = None

    try:
        # Test 1: Check for existing jobs
        logger.info("\n--- Test 1: Get active jobs ---")
        active_jobs = await client.get_active_jobs()
        logger.info(f"✓ Found {len(active_jobs)} active jobs")

        # Test 2: Create a test job
        logger.info("\n--- Test 2: Create test job ---")
        test_job = await client.create_job(total_batches=3, total_records=30)
        test_job_id = test_job.id
        logger.info(f"✓ Created test job: {test_job_id}")
        logger.info(f"  Status: {test_job.status}")
        logger.info(f"  Total batches: {test_job.total_batches}")

        # Test 3: Create test batches
        logger.info("\n--- Test 3: Create test batches ---")
        batch_specs = [
            {
                "batch_number": 0,
                "start_id": 1,
                "end_id": 10,
                "record_ids": list(range(1, 11)),
            },
            {
                "batch_number": 1,
                "start_id": 11,
                "end_id": 20,
                "record_ids": list(range(11, 21)),
            },
            {
                "batch_number": 2,
                "start_id": 21,
                "end_id": 30,
                "record_ids": list(range(21, 31)),
            },
        ]
        batches = await client.create_batches(test_job_id, batch_specs)
        logger.info(f"✓ Created {len(batches)} test batches")

        # Test 4: Claim a batch (atomic operation)
        logger.info("\n--- Test 4: Claim batch (atomic) ---")
        claimed_batch = await client.claim_next_batch(test_job_id, "test-worker-1")
        if claimed_batch:
            logger.info(f"✓ Claimed batch {claimed_batch.batch_number}")
            logger.info(f"  Worker ID: {claimed_batch.worker_id}")
            logger.info(f"  Status: {claimed_batch.status}")
            logger.info(f"  Record IDs: {claimed_batch.record_ids[:3]}...")

            # Test 5: Update batch progress
            logger.info("\n--- Test 5: Update batch progress ---")
            updated_batch = await client.update_batch_progress(
                claimed_batch.id, "test-worker-1", processed_delta=5, failed_delta=1
            )
            if updated_batch:
                logger.info(f"✓ Updated batch progress")
                logger.info(f"  Processed: {updated_batch.processed_count}")
                logger.info(f"  Failed: {updated_batch.failed_count}")

            # Test 6: Mark batch completed
            logger.info("\n--- Test 6: Mark batch completed ---")
            await client.mark_batch_completed(claimed_batch.id, "test-worker-1")
            logger.info("✓ Marked batch as completed")

        # Test 7: Get job statistics
        logger.info("\n--- Test 7: Get job statistics ---")
        stats = await client.get_job_stats(test_job_id)
        logger.info(f"✓ Job statistics:")
        logger.info(f"  Completed batches: {stats['completed_batches']}")
        logger.info(f"  Pending batches: {stats['pending_batches']}")
        logger.info(f"  Processed records: {stats['processed_records']}")
        logger.info(f"  Failed records: {stats['failed_records']}")

        # Test 8: Update job status
        logger.info("\n--- Test 8: Update job status ---")
        await client.update_job_status(test_job_id, JobStatus.COMPLETED)
        logger.info("✓ Updated job status to COMPLETED")

        logger.info("\n✓ All Supabase tests passed!")
        return True

    except Exception as e:
        logger.error(f"✗ Supabase test failed: {e}", exc_info=True)
        return False

    finally:
        # Cleanup: Delete test job (cascades to batches)
        if test_job_id:
            try:
                logger.info("\n--- Cleanup: Deleting test job ---")
                await (
                    async_client.table("ingestion_job")
                    .delete()
                    .eq("id", str(test_job_id))
                    .execute()
                )
                logger.info(f"✓ Deleted test job {test_job_id}")
            except Exception as e:
                logger.warning(f"Failed to cleanup test job: {e}")


if __name__ == "__main__":
    success = asyncio.run(test_supabase_connection())
    exit(0 if success else 1)
