"""Supabase client wrapper for job tracking."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel
from supabase import AsyncClient

from rag_python.core.logging import get_logger
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import (
    BatchStatus,
    IngestionBatch,
    IngestionJob,
    JobStatus,
)

logger = get_logger(__name__)


class SupabaseClient:
    """Client for tracking migration progress in Supabase."""

    def __init__(self, async_client: AsyncClient, settings: MigrationSettings):
        self.settings = settings
        self.client: AsyncClient = async_client

    # ==================== Job Operations ====================

    async def get_active_jobs(self) -> list[IngestionJob]:
        """Get all jobs with status 'pending' or 'running'."""
        response = await (
            self.client.table("ingestion_job")
            .select("*")
            .in_("status", [JobStatus.PENDING.value, JobStatus.RUNNING.value])
            .execute()
        )
        return [IngestionJob(**row) for row in response.data]

    async def create_job(self, total_batches: int, total_records: int) -> IngestionJob:
        """Create a new ingestion job."""
        data = {
            "status": JobStatus.PENDING.value,
            "total_batches": total_batches,
            "total_records": total_records,
            "metadata": {
                "start_time": datetime.now(UTC).isoformat(),
            },
        }
        response = await self.client.table("ingestion_job").insert(data).execute()
        job = IngestionJob(**response.data[0])
        logger.info(f"Created job {job.id} with {total_batches} batches")
        return job

    async def _merge_metadata(self, job_id: UUID, extra: dict[str, Any]) -> dict[str, Any]:
        response = await (
            self.client.table("ingestion_job")
            .select("metadata")
            .eq("id", str(job_id))
            .single()
            .execute()
        )
        current = (response.data or {}).get("metadata") or {}
        current.update(extra)
        return current

    async def update_job_status(self, job_id: UUID, status: JobStatus) -> None:
        """Update job status."""
        data = {
            "status": status.value,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        if status == JobStatus.COMPLETED:
            data["metadata"] = await self._merge_metadata(
                job_id, {"end_time": datetime.now(UTC).isoformat()}
            )

        await self.client.table("ingestion_job").update(data).eq("id", str(job_id)).execute()
        logger.info(f"Updated job {job_id} status to {status.value}")

    async def get_job_stats(self, job_id: UUID) -> dict[str, Any]:
        """Get aggregated statistics for a job using PostgreSQL function."""
        # Call PostgreSQL function for efficient server-side aggregation
        response = await self.client.rpc(
            "get_ingestion_job_stats",
            {"p_job_id": str(job_id)},
        ).execute()

        # Function returns a single row with all stats
        if not response.data:
            # No batches yet, return zeros
            return {
                "completed_batches": 0,
                "failed_batches": 0,
                "pending_batches": 0,
                "processing_batches": 0,
                "processed_records": 0,
                "failed_records": 0,
            }

        # Return the stats dict directly
        return response.data[0]

    async def update_job_stats(self, job_id: UUID) -> None:
        """Update job statistics based on batch data."""
        stats = await self.get_job_stats(job_id)
        data = {
            "completed_batches": stats["completed_batches"],
            "failed_batches": stats["failed_batches"],
            "processed_records": stats["processed_records"],
            "failed_records": stats["failed_records"],
            "updated_at": datetime.now(UTC).isoformat(),
        }
        await self.client.table("ingestion_job").update(data).eq("id", str(job_id)).execute()

    # ==================== Batch Operations ====================

    async def create_batches_from_db(self, job_id: UUID, batch_size: int) -> tuple[int, int]:
        """Create batches directly in database without loading all IDs into memory.

        Uses PostgreSQL function with ROW_NUMBER() for efficient single-scan batching.
        Idempotent: can be called multiple times safely (uses ON CONFLICT DO NOTHING).

        Args:
            job_id: Parent job ID
            batch_size: Number of records per batch

        Returns:
            Tuple of (total_records, total_batches)
        """
        response = await self.client.rpc(
            "create_batches_from_summary_ids",
            {
                "p_job_id": str(job_id),
                "p_batch_size": batch_size,
            },
        ).execute()

        if not response.data:
            raise RuntimeError("Failed to create batches in database")

        assert isinstance(response.data, list)
        assert len(response.data) == 1
        result = response.data[0]

        class BatchResult(BaseModel):
            total_records: int
            total_batches: int
            inserted_batches: int

        result = BatchResult.model_validate(result)

        total_records = result.total_records
        total_batches = result.total_batches
        inserted_batches = result.inserted_batches

        if inserted_batches < total_batches:
            logger.warning(
                f"Created {inserted_batches:,} new batches, "
                f"{total_batches - inserted_batches:,} already existed "
                f"(total: {total_batches:,} batches for {total_records:,} records)"
            )
        else:
            logger.info(
                f"Created {total_batches:,} batches for {total_records:,} records "
                f"directly in database"
            )
        return total_records, total_batches

    async def create_batches(
        self, job_id: UUID, batch_specs: list[dict[str, Any]]
    ) -> list[IngestionBatch]:
        """Create multiple batch records (legacy method for compatibility).

        Args:
            job_id: Parent job ID
            batch_specs: List of dicts with keys: batch_number, start_id, end_id, record_ids
        """
        data = [
            {
                "job_id": str(job_id),
                "status": BatchStatus.PENDING.value,
                "batch_number": spec["batch_number"],
                "start_id": spec["start_id"],
                "end_id": spec["end_id"],
                "record_ids": spec["record_ids"],
            }
            for spec in batch_specs
        ]

        # Insert in chunks of 100 to avoid payload limits
        chunk_size = 100
        all_batches = []
        for i in range(0, len(data), chunk_size):
            chunk = data[i : i + chunk_size]
            response = await self.client.table("ingestion_batch").insert(chunk).execute()
            all_batches.extend([IngestionBatch(**row) for row in response.data])
            logger.info(f"Created batches {i} - {i + len(chunk)}")

        logger.info(f"Created {len(all_batches)} total batches for job {job_id}")
        return all_batches

    async def claim_next_batch(self, job_id: UUID, worker_id: str) -> IngestionBatch | None:
        """Atomically claim the next pending batch.

        Uses PostgreSQL function with FOR UPDATE SKIP LOCKED to prevent race conditions.

        Args:
            job_id: Job to claim batch from
            worker_id: Identifier for this worker

        Returns:
            Claimed batch or None if no batches available
        """
        # Call the PostgreSQL function via RPC for true atomic claiming
        response = await self.client.rpc(
            "claim_next_batch",
            {
                "p_job_id": str(job_id),
                "p_worker_id": worker_id,
            },
        ).execute()

        # If no batch available, the function returns empty array
        if not response.data:
            return None

        # Parse the first (and only) row returned by the function
        batch_data = response.data[0]
        batch = IngestionBatch(**batch_data)
        logger.info(f"Worker {worker_id} claimed batch {batch.batch_number}")
        return batch

    async def update_batch_progress(
        self,
        batch_id: UUID,
        worker_id: str,
        processed_delta: int = 0,
        failed_delta: int = 0,
    ) -> IngestionBatch | None:
        """Atomically increment batch progress counters using PostgreSQL function.

        Args:
            batch_id: Batch to update
            worker_id: Worker ID for single-writer guard
            processed_delta: Number of successfully processed records to add
            failed_delta: Number of failed records to add

        Returns:
            Updated batch if successful, None if batch not found or not owned by worker
        """
        response = await self.client.rpc(
            "bump_batch_progress",
            {
                "p_batch_id": str(batch_id),
                "p_worker_id": worker_id,
                "p_processed_delta": processed_delta,
                "p_failed_delta": failed_delta,
            },
        ).execute()

        if not response.data:
            logger.warning(
                f"Failed to update batch {batch_id} progress - "
                "batch not found, not owned by worker, or not in processing state"
            )
            return None

        return IngestionBatch(**response.data[0])

    async def mark_batch_completed(self, batch_id: UUID, worker_id: str) -> None:
        """Mark batch as completed."""
        data = {
            "status": BatchStatus.COMPLETED.value,
            "updated_at": datetime.now(UTC).isoformat(),
        }
        await (
            self.client.table("ingestion_batch")
            .update(data)
            .eq("id", str(batch_id))
            .eq("worker_id", worker_id)
            .eq("status", BatchStatus.PROCESSING.value)
            .execute()
        )
        logger.info(f"Marked batch {batch_id} as completed")

    async def mark_batch_failed(
        self,
        batch_id: UUID,
        worker_id: str,
        error_message: str,
        retry: bool = True,
    ) -> None:
        """Mark batch as failed and optionally retry."""
        # First get current retry count
        response = await (
            self.client.table("ingestion_batch")
            .select("retry_count")
            .eq("id", str(batch_id))
            .eq("worker_id", worker_id)
            .eq("status", BatchStatus.PROCESSING.value)
            .single()
            .execute()
        )
        current_retry = (response.data or {}).get("retry_count") or 0
        new_retry = current_retry + 1

        if retry and new_retry <= self.settings.max_retries:
            # Reset to pending for retry
            data = {
                "status": BatchStatus.PENDING.value,
                "retry_count": new_retry,
                "error_message": error_message,
                "worker_id": None,
                "claimed_at": None,
                "updated_at": datetime.now(UTC).isoformat(),
            }
            logger.warning(
                f"Batch {batch_id} failed, retry {new_retry}/{self.settings.max_retries}"
            )
        else:
            # Permanently failed
            data = {
                "status": BatchStatus.FAILED.value,
                "retry_count": new_retry,
                "error_message": error_message,
                "updated_at": datetime.now(UTC).isoformat(),
            }
            logger.error(f"Batch {batch_id} permanently failed after {new_retry} attempts")

        await self.client.table("ingestion_batch").update(data).eq("id", str(batch_id)).execute()

    async def reset_stuck_batches(self, job_id: UUID) -> int:
        """Reset batches stuck in 'processing' state using PostgreSQL function.

        Uses capped exponential backoff with jitter for retry scheduling.
        Security-hardened with SECURITY DEFINER and non-blocking SKIP LOCKED.

        Args:
            job_id: Job to reset stuck batches for

        Returns:
            Number of batches reset
        """
        # Call PostgreSQL function for atomic reset with capped exponential backoff
        response = await self.client.rpc(
            "reset_stuck_batches",
            {
                "p_job_id": str(job_id),
                "p_timeout_minutes": self.settings.batch_timeout_minutes,
                "p_max_retries": self.settings.max_retries,
                "p_base_delay_seconds": 30,  # 30 seconds base delay
                "p_backoff_cap_seconds": 1800,  # 30 minutes maximum delay cap
            },
        ).execute()

        # Function returns details about each reset batch
        reset_count = len(response.data)

        if reset_count > 0:
            # Log summary of reset batches
            pending_count = sum(1 for b in response.data if b["new_status"] == "pending")
            failed_count = sum(1 for b in response.data if b["new_status"] == "failed")

            logger.warning(
                f"Reset {reset_count} stuck batches: "
                f"{pending_count} pending for retry, {failed_count} permanently failed"
            )

            # Log details for debugging
            for batch in response.data:
                if batch["new_status"] == "failed":
                    logger.error(
                        f"Batch {batch['id']} permanently failed "
                        f"after {batch['retry_count']} attempts"
                    )
                else:
                    logger.info(
                        f"Batch {batch['id']} scheduled for retry "
                        f"at {batch['next_retry_at']} (attempt {batch['retry_count']})"
                    )

        return reset_count

    # ==================== Summary ID Operations ====================

    async def get_all_summary_ids(self) -> list[int]:
        """Get all summary IDs from exported_ip_summary_id table.

        Returns:
            List of summary IDs sorted in ascending order
        """
        logger.info("Fetching all summary IDs from Supabase...")

        # Fetch all records ordered by id
        all_ids = []
        page_size = 1000
        start = 0

        while True:
            response = await (
                self.client.table("exported_ip_summary_id")
                .select("summary_id")
                .order("id")
                .range(start, start + page_size - 1)
                .execute()
            )

            if not response.data:
                break

            # Extract summary_id from each row
            batch_ids = [row["summary_id"] for row in response.data]
            all_ids.extend(batch_ids)

            logger.info(f"Fetched {len(all_ids):,} summary IDs so far...")

            # Check if we got fewer records than requested (last page)
            if len(response.data) < page_size:
                break

            start += page_size

        logger.info(f"Fetched total of {len(all_ids):,} summary IDs from Supabase")
        return all_ids
