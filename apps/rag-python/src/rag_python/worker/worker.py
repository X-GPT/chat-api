"""Main worker class for continuous SQS polling."""

import asyncio
import signal
from typing import Any

from rag_python.config import get_settings
from rag_python.core.logging import get_logger, setup_logging
from rag_python.worker.processor import MessageProcessor
from rag_python.worker.sqs_client import SQSClient

logger = get_logger(__name__)


class SQSWorker:
    """Worker for continuously polling and processing SQS messages."""

    def __init__(self):
        """Initialize the worker."""
        self.settings = get_settings()
        self.sqs_client = SQSClient(self.settings)
        self.processor = MessageProcessor(self.settings)
        self.running = False
        self.shutdown_event = asyncio.Event()

    def _setup_signal_handlers(self) -> None:
        """Setup signal handlers for graceful shutdown."""

        def signal_handler(sig: int, frame: Any) -> None:
            """Handle shutdown signals."""
            logger.info(f"Received signal {sig}, initiating graceful shutdown...")
            self.shutdown_event.set()

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

    async def _poll_and_process(self) -> None:
        """Poll SQS and process messages once."""
        try:
            # Receive messages from SQS
            messages = await self.sqs_client.receive_messages()

            if not messages:
                logger.debug("No messages received")
                return

            # Process messages
            success_count, failed_count = await self.processor.process_messages_batch(messages)

            logger.info(f"Batch complete: {success_count} succeeded, {failed_count} failed")

        except Exception as e:
            logger.error(f"Error in poll cycle: {e}", exc_info=True)

    async def start(self) -> None:
        """Start the worker and begin polling."""
        setup_logging()
        logger.info("Starting SQS Worker...")
        logger.info(f"Environment: {self.settings.environment}")
        logger.info(f"Queue URL: {self.settings.sqs_queue_url}")
        logger.info(f"AWS Region: {self.settings.aws_region}")

        if not self.settings.sqs_queue_url:
            logger.error("SQS_QUEUE_URL not configured. Exiting.")
            return

        self._setup_signal_handlers()
        self.running = True

        logger.info("Worker started. Polling for messages...")

        try:
            while self.running and not self.shutdown_event.is_set():
                await self._poll_and_process()

                # Optional: Add a small delay between polls
                if self.settings.worker_poll_interval > 0:
                    await asyncio.sleep(self.settings.worker_poll_interval)

        except asyncio.CancelledError:
            logger.info("Worker task cancelled")
        except Exception as e:
            logger.error(f"Fatal error in worker: {e}", exc_info=True)
        finally:
            await self.stop()

    async def stop(self) -> None:
        """Stop the worker gracefully."""
        logger.info("Stopping worker...")
        self.running = False

        # Wait for current processing to complete (with timeout)
        try:
            await asyncio.wait_for(
                asyncio.sleep(0.1),  # Small delay to let current tasks finish
                timeout=self.settings.worker_shutdown_timeout,
            )
        except TimeoutError:
            logger.warning("Shutdown timeout reached, forcing stop")

        logger.info("Worker stopped")

    async def health_check(self) -> dict[str, Any]:
        """Check worker health.

        Returns:
            dict[str, Any]: Health status information.
        """
        return {
            "status": "healthy" if self.running else "stopped",
            "queue_url": self.settings.sqs_queue_url,
            "region": self.settings.aws_region,
        }


async def main() -> None:
    """Main entry point for the worker."""
    worker = SQSWorker()
    await worker.start()


if __name__ == "__main__":
    asyncio.run(main())
