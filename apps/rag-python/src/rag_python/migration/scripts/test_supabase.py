#!/usr/bin/env python
"""Test Supabase connection and optimized batch creation."""

import asyncio

from postgrest import CountMethod
from pydantic import BaseModel
from supabase import acreate_client

from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import BatchStatus, JobStatus
from rag_python.migration.supabase_client import SupabaseClient

logger = get_logger(__name__)


async def test_supabase_connection():
    """Test Supabase connection and optimized batch creation."""
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

        # Test 2: Check exported_ip_summary_id table
        logger.info("\n--- Test 2: Check exported_ip_summary_id table ---")
        count_response = await (
            async_client.table("exported_ip_summary_id")
            .select("id", count=CountMethod.exact)
            .limit(1)
            .execute()
        )

        if not count_response.count or count_response.count == 0:
            logger.warning(
                "⚠️  No data in exported_ip_summary_id table - cannot test optimized batch creation"
            )
            logger.info(
                "This is expected if you haven't populated the table yet - test will run during actual migration"
            )
            return True

        logger.info(f"✓ Found {count_response.count:,} records in exported_ip_summary_id table")

        # Test 3: Create test job
        logger.info("\n--- Test 3: Create test job ---")
        test_job = await client.create_job(total_batches=0, total_records=0)
        test_job_id = test_job.id
        logger.info(f"✓ Created test job: {test_job_id}")

        # Test 4: Test optimized batch creation from DB
        logger.info("\n--- Test 4: Test optimized create_batches_from_db() ---")
        logger.info("This tests the PostgreSQL function for memory-efficient batch creation")

        # For safety, only test if table has <= 1000 records
        if count_response.count <= 1000:
            logger.info(
                f"Testing optimized batch creation with {count_response.count:,} records..."
            )
            total_records, total_batches = await client.create_batches_from_db(
                test_job_id, batch_size=100
            )
            logger.info("✓ Optimized batch creation succeeded!")
            logger.info(f"  Total records: {total_records:,}")
            logger.info(f"  Total batches: {total_batches:,}")

            # Verify batches were created
            batch_count_response = await (
                async_client.table("ingestion_batch")
                .select("id", count=CountMethod.exact)
                .eq("job_id", str(test_job_id))
                .execute()
            )
            logger.info(f"  Verified {batch_count_response.count:,} batches in database")

            if batch_count_response.count == total_batches:
                logger.info("✓ Batch count verification passed!")
            else:
                logger.warning(
                    f"Batch count mismatch: expected {total_batches}, got {batch_count_response.count}"
                )

            # Test 5: Verify batch structure
            logger.info("\n--- Test 5: Verify batch structure ---")
            sample_batches = await (
                async_client.table("ingestion_batch")
                .select("batch_number, start_id, end_id, status, record_ids")
                .eq("job_id", str(test_job_id))
                .order("batch_number")
                .limit(3)
                .execute()
            )

            class IngestionBatch(BaseModel):
                batch_number: int
                start_id: int
                end_id: int
                status: BatchStatus
                record_ids: list[int]

            sample_batches = [IngestionBatch.model_validate(batch) for batch in sample_batches.data]

            logger.info("Sample of first 3 batches:")
            for batch in sample_batches:
                num_records = len(batch.record_ids)
                logger.info(
                    f"  Batch {batch.batch_number}: "
                    f"IDs {batch.start_id} to {batch.end_id} "
                    f"({num_records} records, status: {batch.status})"
                )

            # Test 6: Claim a batch (atomic operation)
            logger.info("\n--- Test 6: Claim batch (atomic) ---")
            claimed_batch = await client.claim_next_batch(test_job_id, "test-worker-1")
            if claimed_batch:
                logger.info(f"✓ Claimed batch {claimed_batch.batch_number}")
                logger.info(f"  Worker ID: {claimed_batch.worker_id}")
                logger.info(f"  Status: {claimed_batch.status}")
                logger.info(f"  Record count: {len(claimed_batch.record_ids)}")

                # Test 7: Update batch progress
                logger.info("\n--- Test 7: Update batch progress ---")
                updated_batch = await client.update_batch_progress(
                    claimed_batch.id, "test-worker-1", processed_delta=5, failed_delta=1
                )
                if updated_batch:
                    logger.info("✓ Updated batch progress")
                    logger.info(f"  Processed: {updated_batch.processed_count}")
                    logger.info(f"  Failed: {updated_batch.failed_count}")

                # Test 8: Mark batch completed
                logger.info("\n--- Test 8: Mark batch completed ---")
                await client.mark_batch_completed(claimed_batch.id, "test-worker-1")
                logger.info("✓ Marked batch as completed")

            # Test 9: Get job statistics
            logger.info("\n--- Test 9: Get job statistics ---")
            stats = await client.get_job_stats(test_job_id)
            logger.info("✓ Job statistics:")
            logger.info(f"  Completed batches: {stats['completed_batches']}")
            logger.info(f"  Pending batches: {stats['pending_batches']}")
            logger.info(f"  Processing batches: {stats['processing_batches']}")
            logger.info(f"  Processed records: {stats['processed_records']}")
            logger.info(f"  Failed records: {stats['failed_records']}")

            # Test 10: Update job status
            logger.info("\n--- Test 10: Update job status ---")
            await client.update_job_status(test_job_id, JobStatus.COMPLETED)
            logger.info("✓ Updated job status to COMPLETED")

        else:
            logger.info(
                f"⚠️  Skipping optimized batch creation test (table has {count_response.count:,} records, limit is 1000)"
            )
            logger.info(
                "To test with larger datasets, run test_batch_creation.py or the actual migration"
            )

        logger.info("\n✓✓✓ All Supabase tests completed successfully! ✓✓✓")
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
