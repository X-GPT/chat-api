"""Message processor for handling SQS messages."""

import asyncio
import json
from typing import Any

from pydantic import ValidationError

from rag_python.config import Settings
from rag_python.core.logging import get_logger
from rag_python.schemas.events import SQSMessage, SQSMessageMetadata
from rag_python.worker.handlers import MessageHandlerRegistry
from rag_python.worker.sqs_client import SQSClient

logger = get_logger(__name__)


class MessageProcessor:
    """Processor for SQS messages."""

    def __init__(self, settings: Settings):
        """Initialize message processor.

        Args:
            settings: Application settings.
        """
        self.settings = settings
        self.sqs_client = SQSClient(settings)
        self.handler_registry = MessageHandlerRegistry()

    def _parse_message_body(self, body: str) -> dict[str, Any] | None:
        """Parse message body JSON.

        Args:
            body: Message body string.

        Returns:
            dict[str, Any] | None: Parsed JSON or None if invalid.
        """
        try:
            return json.loads(body)
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse message body as JSON: {e}")
            return None

    def _extract_metadata(self, message: dict[str, Any]) -> SQSMessageMetadata:
        """Extract metadata from SQS message.

        Args:
            message: SQS message dictionary.

        Returns:
            SQSMessageMetadata: Message metadata.
        """
        attributes = message.get("Attributes", {})
        return SQSMessageMetadata(
            message_id=message.get("MessageId", "unknown"),
            receipt_handle=message.get("ReceiptHandle", ""),
            approximate_receive_count=int(attributes.get("ApproximateReceiveCount", 0)),
        )

    async def _validate_and_parse_message(self, body_data: dict[str, Any]) -> SQSMessage | None:
        """Validate and parse SQS message data.

        Args:
            body_data: Parsed message body data.

        Returns:
            SQSMessage | None: Validated message or None if invalid.
        """
        try:
            # Try to parse as SummaryLifecycleMessage (expand as more types are added)
            from rag_python.schemas.events import SummaryLifecycleMessage

            message = SummaryLifecycleMessage(**body_data)
            return message
        except ValidationError as e:
            logger.error(f"Failed to validate message: {e}")
            return None

    async def process_message(self, message: dict[str, Any]) -> tuple[bool, str]:
        """Process a single SQS message.

        Args:
            message: SQS message dictionary.

        Returns:
            tuple[bool, str]: (success, receipt_handle) tuple.
        """
        metadata = self._extract_metadata(message)
        receipt_handle = metadata.receipt_handle

        logger.info(
            f"Processing message {metadata.message_id} "
            f"(attempt {metadata.approximate_receive_count})"
        )

        # Parse message body
        body_data = self._parse_message_body(message.get("Body", ""))
        if not body_data:
            logger.error(f"Invalid message body for message {metadata.message_id}")
            return False, receipt_handle

        # Validate and parse message
        sqs_message = await self._validate_and_parse_message(body_data)
        if not sqs_message:
            logger.error(f"Invalid message format for message {metadata.message_id}")
            return False, receipt_handle

        # Get appropriate handler
        handler = self.handler_registry.get_handler(sqs_message.type)
        if not handler:
            logger.error(f"No handler found for message type: {sqs_message.type}")
            return False, receipt_handle

        # Process message with handler
        try:
            success = await handler.handle(sqs_message)
            if success:
                logger.info(
                    f"Successfully processed message {metadata.message_id} "
                    f"(type: {sqs_message.type})"
                )
                return True, receipt_handle
            else:
                logger.warning(
                    f"Handler returned False for message {metadata.message_id} "
                    f"(type: {sqs_message.type})"
                )
                return False, receipt_handle

        except Exception as e:
            logger.error(
                f"Error processing message {metadata.message_id} (type: {sqs_message.type}): {e}",
                exc_info=True,
            )
            return False, receipt_handle

    async def process_messages_batch(self, messages: list[dict[str, Any]]) -> tuple[int, int]:
        """Process a batch of messages.

        Args:
            messages: List of SQS messages.

        Returns:
            tuple[int, int]: (successful_count, failed_count).
        """
        if not messages:
            return 0, 0

        # Process all messages concurrently
        tasks = [self.process_message(msg) for msg in messages]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        # Separate successful and failed messages
        successful_receipts: list[str] = []
        failed_count = 0

        for result in results:
            if isinstance(result, Exception):
                logger.error(f"Exception during message processing: {result}")
                failed_count += 1
            else:
                if not isinstance(result, tuple):
                    logger.error(f"Invalid result type: {type(result)}")
                    failed_count += 1
                    continue

                success, receipt_handle = result
                if success:
                    successful_receipts.append(receipt_handle)
                else:
                    failed_count += 1

        # Delete successfully processed messages
        if successful_receipts:
            delete_result = await self.sqs_client.delete_messages_batch(successful_receipts)
            actual_deleted = len(delete_result["successful"])
            logger.info(f"Deleted {actual_deleted} messages from queue")

        return len(successful_receipts), failed_count
