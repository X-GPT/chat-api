"""Controller script to orchestrate the migration."""

# --- CRITICAL: Set spawn method BEFORE any imports that may open sockets ---
import multiprocessing as mp

if mp.get_start_method(allow_none=True) != "spawn":
    mp.set_start_method("spawn", force=True)
# ---------------------------------------------------------------------------

import asyncio
import signal
import sys
from multiprocessing import Process
from typing import Any
from uuid import UUID

from supabase import AsyncClient, acreate_client

from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import JobStatus
from rag_python.migration.supabase_client import SupabaseClient
from rag_python.migration.worker import run_worker

logger = get_logger(__name__)


class MigrationController:
    """Orchestrates the migration process."""

    def __init__(self, settings: MigrationSettings):
        self.settings = settings
        # Defer creation of clients to explicit init methods
        self.async_supabase: AsyncClient | None = None
        self.supabase_client: SupabaseClient | None = None

        self.workers: list[Process] = []
        self.shutdown_flag = False
        self._workers_joined = False

    # ---------------- Connection management ----------------

    async def open_for_planning(self) -> None:
        """Open only what is needed to plan/create a job (Supabase only)."""
        logger.info("Opening connections for planning...")

        if not self.settings.supabase_url or not self.settings.supabase_key:
            raise ValueError("Supabase URL and key must be set")

        self.async_supabase = await acreate_client(
            self.settings.supabase_url, self.settings.supabase_key
        )
        self.supabase_client = SupabaseClient(self.async_supabase, self.settings)

    async def open_for_monitoring(self) -> None:
        """Open only what is needed to monitor the job (Supabase only)."""
        logger.info("Opening connections for monitoring...")
        if not self.settings.supabase_url or not self.settings.supabase_key:
            raise ValueError("Supabase URL and key must be set")
        self.async_supabase = await acreate_client(
            self.settings.supabase_url, self.settings.supabase_key
        )
        self.supabase_client = SupabaseClient(self.async_supabase, self.settings)

    async def close_all(self) -> None:
        """Close everything (used both between phases and on final cleanup)."""
        logger.info("Closing connections...")
        self.async_supabase = None
        self.supabase_client = None
        logger.info("All connections closed")

    # ---------------- Signals ----------------

    def register_signal_handlers(self) -> None:
        """Register handlers for graceful shutdown."""

        def signal_handler(signum: int, _frame: Any) -> None:
            logger.warning(f"Received signal {signum}, initiating shutdown...")
            self.shutdown_flag = True

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

    # ---------------- Planning helpers ----------------

    async def _ask_resume(self) -> bool:
        """Non-blocking, safe prompt with TTY fallback."""
        # Prefer explicit config override if provided
        resume_existing = getattr(self.settings, "resume_existing", None)
        if resume_existing is not None:
            return bool(resume_existing)

        if not sys.stdin.isatty():
            # Default to resume if non-interactive; adjust to your preference
            logger.info("Non-interactive mode: defaulting to resume existing job")
            return True

        try:
            ans = await asyncio.to_thread(input, "\nResume existing job? (Y/n): ")
        except EOFError:
            return True
        return ans.strip().lower() in ("", "y", "yes")

    async def get_or_create_job(self) -> UUID:
        """Get existing active job or create new one.

        Returns:
            Job ID to process
        """
        if not self.supabase_client:
            raise RuntimeError("Supabase client not initialized")

        # Check for existing jobs
        active_jobs = await self.supabase_client.get_active_jobs()

        if active_jobs:
            logger.warning(f"Found {len(active_jobs)} active job(s)")
            for job in active_jobs:
                logger.info(
                    f"  Job {job.id}: {job.status.value}, "
                    f"{job.completed_batches}/{job.total_batches} batches completed"
                )

            if await self._ask_resume():
                job = active_jobs[0]
                logger.info(f"Resuming job {job.id}")

                # Reset stuck batches
                reset_count = await self.supabase_client.reset_stuck_batches(job.id)
                if reset_count:
                    logger.info(f"Reset {reset_count} stuck batches")

                # Update status to running
                await self.supabase_client.update_job_status(job.id, JobStatus.RUNNING)
                return job.id

            # User chose not to resume: mark as failed
            logger.info("User declined to resume - marking existing jobs as failed")
            for job in active_jobs:
                await self.supabase_client.update_job_status(job.id, JobStatus.FAILED)

        # Create new job
        return await self.create_new_job()

    async def create_new_job(self) -> UUID:
        """Create a new migration job.

        Returns:
            New job ID
        """
        if not self.supabase_client:
            raise RuntimeError("Supabase client not initialized for planning")

        logger.info("Planning new migration job...")

        # Create job record with placeholder values (will be updated after batch creation)
        job = await self.supabase_client.create_job(0, 0)

        # Create batches directly in database without loading all IDs into memory
        # This is much more memory-efficient for large datasets
        total_records, total_batches = await self.supabase_client.create_batches_from_db(
            job.id, self.settings.batch_size
        )

        if total_records == 0:
            logger.error("No summary IDs found in Supabase table")
            sys.exit(1)

        logger.info(
            f"Split {total_records:,} records into {total_batches:,} batches "
            f"of ~{self.settings.batch_size} records each"
        )

        # Update job with actual totals
        await self.supabase_client.client.table("ingestion_job").update(
            {
                "total_batches": total_batches,
                "total_records": total_records,
            }
        ).eq("id", str(job.id)).execute()

        # Update job status
        await self.supabase_client.update_job_status(job.id, JobStatus.RUNNING)

        logger.info(f"Created job {job.id}")
        return job.id

    # ---------------- Worker management ----------------

    def spawn_workers(self, job_id: UUID) -> None:
        """Spawn worker processes.

        Args:
            job_id: Job ID for workers to process
        """
        logger.info(f"Spawning {self.settings.max_workers} worker processes...")
        self.workers = []

        for i in range(self.settings.max_workers):
            worker = Process(
                target=run_worker,
                args=(job_id, i),
                name=f"Worker-{i}",
                daemon=False,
            )
            worker.start()
            self.workers.append(worker)
            logger.info(f"Started worker {i} (PID: {worker.pid})")

    def join_workers(self) -> None:
        """Wait for all workers to complete."""
        if self._workers_joined:
            return
        logger.info("Waiting for workers to complete...")
        for worker in self.workers:
            worker.join()
        self._workers_joined = True
        logger.info("All workers have exited")

    def shutdown_workers(self) -> None:
        """Gracefully shutdown all workers."""
        logger.info("Shutting down workers...")

        for worker in self.workers:
            if worker.is_alive():
                logger.info(f"Terminating worker {worker.name} (PID: {worker.pid})")
                worker.terminate()
                worker.join(timeout=10)

                if worker.is_alive():
                    logger.warning(f"Force killing worker {worker.name}")
                    worker.kill()
                    worker.join()

        self._workers_joined = True
        logger.info("All workers stopped")

    # ---------------- Monitoring ----------------

    async def monitor_job(self, job_id: UUID) -> None:
        """Monitor job progress and update statistics.

        Args:
            job_id: Job ID to monitor
        """
        if not self.supabase_client:
            raise RuntimeError("Supabase client not initialized for monitoring")

        monitor_interval = getattr(self.settings, "monitor_interval_seconds", 5)
        logger.info("Monitoring job progress...")

        while not self.shutdown_flag:
            # Update statistics
            await self.supabase_client.update_job_stats(job_id)

            # Get current stats
            stats = await self.supabase_client.get_job_stats(job_id)

            completed = int(stats.get("completed_batches", 0))
            failed = int(stats.get("failed_batches", 0))
            pending = int(stats.get("pending_batches", 0))
            processing = int(stats.get("processing_batches", 0))
            total = completed + failed + pending + processing

            logger.info(
                f"Progress: {completed}/{total} batches completed, "
                f"{processing} processing, {pending} pending, {failed} failed | "
                f"Records: {int(stats.get('processed_records', 0)):,} processed, "
                f"{int(stats.get('failed_records', 0)):,} failed"
            )

            # Check if job is complete
            if pending == 0 and processing == 0:
                final_status = JobStatus.COMPLETED if failed == 0 else JobStatus.FAILED
                await self.supabase_client.update_job_status(job_id, final_status)
                logger.info(f"Job {job_id} finished with status: {final_status.value}")
                break

            # Wait before next check
            await asyncio.sleep(monitor_interval)

    # ---------------- Orchestration ----------------

    async def run(self) -> None:
        """Two-phase run to avoid forking with open connections.

        Phase 1: Planning (open → plan → close)
        Phase 2: Execution (spawn workers → reopen for monitoring)
        """
        try:
            self.register_signal_handlers()

            # Phase 1: Planning (open → plan → close)
            await self.open_for_planning()
            job_id = await self.get_or_create_job()
            await self.close_all()  # CRITICAL: close before forking!

            # Phase 2: Workers (spawn on clean state), then reopen for monitoring
            self.spawn_workers(job_id)
            await self.open_for_monitoring()
            await self.monitor_job(job_id)

            # If monitor loop completed without shutdown, join cleanly
            self.join_workers()
            logger.info("Migration complete!")

        except asyncio.CancelledError:
            logger.warning("Controller cancelled")
            raise
        except Exception as e:
            logger.error(f"Controller error: {e}", exc_info=True)
            raise
        finally:
            # Try to shut down workers if not already joined
            if not self._workers_joined:
                self.shutdown_workers()
            await self.close_all()


async def main():
    """Entry point."""
    setup_logging()
    settings = MigrationSettings()
    controller = MigrationController(settings)
    await controller.run()


if __name__ == "__main__":
    asyncio.run(main())
