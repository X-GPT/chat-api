"""Worker process for ingesting batches."""

import asyncio
import os
from uuid import UUID

from supabase import AsyncClient, acreate_client

from rag_python.config import get_settings
from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import IngestionBatch, SummaryRecord
from rag_python.migration.mysql_client import MySQLClient
from rag_python.migration.supabase_client import SupabaseClient
from rag_python.services.ingestion_service import IngestionService
from rag_python.services.qdrant_service import QdrantService

logger = get_logger(__name__)


class MigrationWorker:
    """Worker process that claims and processes batches."""

    def __init__(self, job_id: UUID, worker_index: int):
        self.job_id = job_id
        self.worker_index = worker_index
        self.worker_id = f"{os.uname().nodename}-{os.getpid()}-{worker_index}"

        # Settings
        self.migration_settings = MigrationSettings()
        self.app_settings = get_settings()

        # Clients
        self.mysql_client = MySQLClient(self.migration_settings)
        self.supabase_client: SupabaseClient | None = None
        self.async_supabase: AsyncClient | None = None
        self.qdrant_service: QdrantService | None = None
        self.ingestion_service: IngestionService | None = None

        self.shutdown_flag = False

    async def initialize(self) -> None:
        """Initialize worker resources."""
        logger.info(f"Initializing worker {self.worker_id}...")

        # Connect to MySQL
        await self.mysql_client.connect()

        # Create async Supabase client
        if not self.migration_settings.supabase_url or not self.migration_settings.supabase_key:
            raise ValueError("Supabase URL and key must be set")
        self.async_supabase = await acreate_client(
            self.migration_settings.supabase_url,
            self.migration_settings.supabase_key,
        )
        self.supabase_client = SupabaseClient(self.async_supabase, self.migration_settings)

        # Initialize Qdrant and ingestion service
        # NOTE: Collection already created by controller, so we don't call ensure_schema() here
        self.qdrant_service = QdrantService(self.app_settings)

        self.ingestion_service = IngestionService(
            self.app_settings,
            self.qdrant_service,
        )

        logger.info(f"Worker {self.worker_id} initialized")

    async def cleanup(self) -> None:
        """Clean up worker resources."""
        logger.info(f"Cleaning up worker {self.worker_id}...")
        await self.mysql_client.close()

        # Supabase AsyncClient doesn't have an explicit close method
        # Drop references to allow cleanup
        self.async_supabase = None
        self.supabase_client = None

        if self.qdrant_service:
            await self.qdrant_service.aclose()
        logger.info(f"Worker {self.worker_id} cleanup complete")

    async def process_record(self, record: SummaryRecord) -> bool:
        """Process a single record.

        Args:
            record: Summary record to ingest

        Returns:
            True if successful, False otherwise
        """
        try:
            if not record.parse_content or not record.parse_content.strip():
                logger.warning(f"Skipping record {record.id}: empty content")
                return False

            if not self.ingestion_service:
                logger.error("Ingestion service not initialized")
                return False

            stats = await self.ingestion_service.ingest_document(
                summary_id=record.id,
                member_code=record.member_code,
                original_content=record.parse_content,
                collection_ids=None,  # Set in separate job
            )

            logger.debug(f"Ingested record {record.id}: {stats.total_nodes} nodes")
            return True

        except Exception as e:
            logger.error(f"Failed to ingest record {record.id}: {e}")
            return False

    async def process_batch(self, batch: IngestionBatch) -> None:
        """Process a claimed batch.

        Args:
            batch: IngestionBatch to process
        """
        if not self.supabase_client:
            logger.error("Supabase client not initialized")
            return

        logger.info(
            f"Worker {self.worker_id} processing batch {batch.batch_number} "
            f"({len(batch.record_ids)} records, retry {batch.retry_count})"
        )

        try:
            # Fetch records from MySQL
            records = await self.mysql_client.get_records_by_ids(batch.record_ids)

            if not records:
                logger.warning(f"No valid records found for batch {batch.batch_number}")
                await self.supabase_client.mark_batch_completed(batch.id, self.worker_id)
                return

            # Process each record
            processed_count = 0
            failed_count = 0

            for i, record in enumerate(records):
                if self.shutdown_flag:
                    logger.warning("Shutdown requested, stopping batch processing")
                    raise InterruptedError("Worker shutdown")

                success = await self.process_record(record)
                if success:
                    processed_count += 1
                else:
                    failed_count += 1

                # Update progress every 10 records
                if (i + 1) % 10 == 0:
                    await self.supabase_client.update_batch_progress(
                        batch.id,
                        self.worker_id,
                        processed_delta=processed_count,
                        failed_delta=failed_count,
                    )
                    logger.debug(
                        f"Batch {batch.batch_number} progress: "
                        f"{processed_count}/{len(records)} processed"
                    )
                    # Reset counters after update (since we're using deltas)
                    processed_count = 0
                    failed_count = 0

            # Final progress update for remaining records
            if processed_count > 0 or failed_count > 0:
                await self.supabase_client.update_batch_progress(
                    batch.id,
                    self.worker_id,
                    processed_delta=processed_count,
                    failed_delta=failed_count,
                )

            # Mark batch as completed
            await self.supabase_client.mark_batch_completed(batch.id, self.worker_id)

            logger.info(
                f"Batch {batch.batch_number} completed: {len(records)} total records processed"
            )

        except Exception as e:
            logger.error(f"Batch {batch.batch_number} failed: {e}", exc_info=True)
            await self.supabase_client.mark_batch_failed(
                batch.id,
                self.worker_id,
                error_message=str(e),
                retry=True,
            )

    async def run(self) -> None:
        """Main worker loop."""
        try:
            await self.initialize()

            if not self.supabase_client:
                logger.error("Supabase client not initialized")
                return

            logger.info(f"Worker {self.worker_id} starting main loop...")

            consecutive_empty_polls = 0
            max_empty_polls = 10  # Exit after 10 consecutive empty polls

            while not self.shutdown_flag:
                # Try to claim a batch
                batch = await self.supabase_client.claim_next_batch(
                    self.job_id,
                    self.worker_id,
                )

                if batch:
                    consecutive_empty_polls = 0
                    await self.process_batch(batch)
                else:
                    # No batch available
                    consecutive_empty_polls += 1

                    if consecutive_empty_polls >= max_empty_polls:
                        logger.info(
                            f"No batches available after {max_empty_polls} polls, "
                            "assuming job is complete"
                        )
                        break

                    logger.debug(
                        f"No batch claimed, waiting {self.migration_settings.worker_poll_interval}s..."
                    )
                    await asyncio.sleep(self.migration_settings.worker_poll_interval)

            logger.info(f"Worker {self.worker_id} finished")

        except Exception as e:
            logger.error(f"Worker {self.worker_id} error: {e}", exc_info=True)
            raise
        finally:
            await self.cleanup()


def run_worker(job_id: UUID, worker_index: int) -> None:
    """Entry point for worker process.

    Args:
        job_id: Job ID to process
        worker_index: Index of this worker (0-4)
    """
    setup_logging()
    worker = MigrationWorker(job_id, worker_index)
    asyncio.run(worker.run())


if __name__ == "__main__":
    import sys

    if len(sys.argv) != 3:
        print("Usage: python worker.py <job_id> <worker_index>")
        sys.exit(1)

    job_id = UUID(sys.argv[1])
    worker_index = int(sys.argv[2])
    run_worker(job_id, worker_index)
