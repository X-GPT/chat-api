#!/usr/bin/env python
"""Test atomic batch claiming with concurrent workers."""

import asyncio
from uuid import UUID

from supabase import acreate_client

from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import JobStatus
from rag_python.migration.supabase_client import SupabaseClient

logger = get_logger(__name__)


async def worker_claim_batches(
    worker_id: str, job_id: UUID, settings: MigrationSettings, max_claims: int = 5
) -> list[int]:
    """Simulate a worker claiming batches."""
    async_client = await acreate_client(settings.supabase_url, settings.supabase_key)
    client = SupabaseClient(async_client, settings)

    claimed_batch_numbers = []

    try:
        for _ in range(max_claims):
            batch = await client.claim_next_batch(job_id, worker_id)
            if batch:
                claimed_batch_numbers.append(batch.batch_number)
                logger.info(f"[{worker_id}] Claimed batch {batch.batch_number}")
                await asyncio.sleep(0.1)  # Simulate some work
            else:
                logger.info(f"[{worker_id}] No batches available")
                break

        logger.info(f"[{worker_id}] Finished - claimed {len(claimed_batch_numbers)} batches")
        return claimed_batch_numbers

    finally:
        # Note: AsyncClient doesn't need explicit close
        pass


async def test_concurrent_claiming():
    """Test that multiple workers don't claim the same batch."""
    setup_logging()
    settings = MigrationSettings()

    logger.info("Testing concurrent batch claiming...")

    # Setup: Create test job with 10 batches
    async_client = await acreate_client(settings.supabase_url, settings.supabase_key)
    client = SupabaseClient(async_client, settings)

    test_job = await client.create_job(total_batches=10, total_records=100)
    job_id = test_job.id
    logger.info(f"Created test job: {job_id}")

    # Create 10 batches
    batch_specs = [
        {
            "batch_number": i,
            "start_id": i * 10 + 1,
            "end_id": (i + 1) * 10,
            "record_ids": list(range(i * 10 + 1, (i + 1) * 10 + 1)),
        }
        for i in range(10)
    ]
    await client.create_batches(job_id, batch_specs)
    logger.info("Created 10 test batches")

    await client.update_job_status(job_id, JobStatus.RUNNING)

    try:
        # Spawn 3 workers concurrently
        logger.info("\n--- Spawning 3 concurrent workers ---")
        workers = [
            worker_claim_batches(f"worker-{i}", job_id, settings, max_claims=5)
            for i in range(3)
        ]

        results = await asyncio.gather(*workers)

        # Verify no duplicates
        all_claimed = [batch_num for worker_batches in results for batch_num in worker_batches]
        unique_claimed = set(all_claimed)

        logger.info(f"\n--- Results ---")
        logger.info(f"Total batches claimed: {len(all_claimed)}")
        logger.info(f"Unique batches claimed: {len(unique_claimed)}")

        for i, worker_batches in enumerate(results):
            logger.info(f"Worker {i}: claimed {len(worker_batches)} batches - {worker_batches}")

        # Test assertions
        if len(all_claimed) != len(unique_claimed):
            logger.error(
                f"✗ DUPLICATE CLAIMS DETECTED! "
                f"Expected {len(all_claimed)} unique batches, got {len(unique_claimed)}"
            )
            return False

        if len(unique_claimed) != 10:
            logger.warning(
                f"⚠ Expected 10 batches claimed, got {len(unique_claimed)} "
                f"(may be OK if workers finished early)"
            )

        logger.info("\n✓ No duplicate claims detected - atomic claiming works!")
        return True

    finally:
        # Cleanup
        try:
            await async_client.table("ingestion_job").delete().eq("id", str(job_id)).execute()
            logger.info(f"✓ Cleaned up test job {job_id}")
        except Exception as e:
            logger.warning(f"Failed to cleanup: {e}")


if __name__ == "__main__":
    success = asyncio.run(test_concurrent_claiming())
    exit(0 if success else 1)
