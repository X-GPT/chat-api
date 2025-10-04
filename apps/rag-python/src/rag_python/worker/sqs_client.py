"""AWS SQS client wrapper with async support."""

import json
from typing import Any

import aioboto3
from botocore.exceptions import ClientError

from rag_python.config import Settings
from rag_python.core.logging import get_logger

logger = get_logger(__name__)


class SQSClient:
    """Async SQS client wrapper."""

    def __init__(self, settings: Settings):
        """Initialize SQS client.

        Args:
            settings: Application settings.
        """
        self.settings = settings
        self.session = aioboto3.Session(
            aws_access_key_id=settings.aws_access_key_id,
            aws_secret_access_key=settings.aws_secret_access_key,
            region_name=settings.aws_region,
        )

    async def receive_messages(
        self,
        max_messages: int | None = None,
        wait_time_seconds: int | None = None,
    ) -> list[dict[str, Any]]:
        """Receive messages from SQS queue.

        Args:
            max_messages: Maximum number of messages to receive (1-10).
            wait_time_seconds: Long polling wait time (0-20 seconds).

        Returns:
            list[dict[str, Any]]: List of received messages.
        """
        if not self.settings.sqs_queue_url:
            logger.error("SQS queue URL not configured")
            return []

        max_messages = max_messages or self.settings.sqs_max_messages
        wait_time_seconds = wait_time_seconds or self.settings.sqs_wait_time_seconds

        try:
            async with self.session.client("sqs") as sqs:  # type: ignore
                response = await sqs.receive_message(
                    QueueUrl=self.settings.sqs_queue_url,
                    MaxNumberOfMessages=max_messages,
                    WaitTimeSeconds=wait_time_seconds,
                    AttributeNames=["All"],
                    MessageAttributeNames=["All"],
                )

                messages = response.get("Messages", [])
                if messages:
                    logger.info(f"Received {len(messages)} messages from SQS")
                return messages  # type: ignore

        except ClientError as e:
            logger.error(f"Failed to receive messages from SQS: {e}")
            return []
        except Exception as e:
            logger.error(f"Unexpected error receiving messages: {e}", exc_info=True)
            return []

    async def delete_message(self, receipt_handle: str) -> bool:
        """Delete a message from the queue after successful processing.

        Args:
            receipt_handle: Receipt handle of the message to delete.

        Returns:
            bool: True if deletion was successful, False otherwise.
        """
        if not self.settings.sqs_queue_url:
            logger.error("SQS queue URL not configured")
            return False

        try:
            async with self.session.client("sqs") as sqs:  # type: ignore
                await sqs.delete_message(
                    QueueUrl=self.settings.sqs_queue_url,
                    ReceiptHandle=receipt_handle,
                )
            logger.debug(f"Successfully deleted message with receipt handle: {receipt_handle}")
            return True

        except ClientError as e:
            logger.error(f"Failed to delete message: {e}")
            return False
        except Exception as e:
            logger.error(f"Unexpected error deleting message: {e}", exc_info=True)
            return False

    async def delete_messages_batch(self, receipt_handles: list[str]) -> dict[str, Any]:
        """Delete multiple messages in a batch.

        Args:
            receipt_handles: List of receipt handles to delete.

        Returns:
            dict[str, Any]: Result of batch deletion with successful and failed entries.
        """
        if not self.settings.sqs_queue_url or not receipt_handles:
            return {"successful": [], "failed": []}

        try:
            async with self.session.client("sqs") as sqs:  # type: ignore
                entries = [
                    {"Id": str(idx), "ReceiptHandle": handle}
                    for idx, handle in enumerate(receipt_handles)
                ]

                response = await sqs.delete_message_batch(
                    QueueUrl=self.settings.sqs_queue_url,
                    Entries=entries,  # type: ignore
                )

                successful = response.get("Successful", [])
                failed = response.get("Failed", [])

                logger.info(f"Batch delete: {len(successful)} successful, {len(failed)} failed")

                return {"successful": successful, "failed": failed}

        except Exception as e:
            logger.error(f"Unexpected error in batch delete: {e}", exc_info=True)
            return {"successful": [], "failed": receipt_handles}

    async def change_message_visibility(self, receipt_handle: str, visibility_timeout: int) -> bool:
        """Change the visibility timeout of a message.

        Args:
            receipt_handle: Receipt handle of the message.
            visibility_timeout: New visibility timeout in seconds.

        Returns:
            bool: True if successful, False otherwise.
        """
        if not self.settings.sqs_queue_url:
            return False

        try:
            async with self.session.client("sqs") as sqs:  # type: ignore
                await sqs.change_message_visibility(
                    QueueUrl=self.settings.sqs_queue_url,
                    ReceiptHandle=receipt_handle,
                    VisibilityTimeout=visibility_timeout,
                )
            return True

        except Exception as e:
            logger.error(f"Failed to change message visibility: {e}")
            return False

    async def send_message(
        self, message_body: str | dict[str, Any], message_attributes: dict[str, Any] | None = None
    ) -> str | None:
        """Send a message to the queue.

        Args:
            message_body: Message body (string or dict to be JSON encoded).
            message_attributes: Optional message attributes.

        Returns:
            str | None: Message ID if successful, None otherwise.
        """
        if not self.settings.sqs_queue_url:
            return None

        try:
            if isinstance(message_body, dict):
                message_body = json.dumps(message_body)

            async with self.session.client("sqs") as sqs:  # type: ignore
                params: dict[str, Any] = {
                    "QueueUrl": self.settings.sqs_queue_url,
                    "MessageBody": message_body,
                }

                if message_attributes:
                    params["MessageAttributes"] = message_attributes

                response = await sqs.send_message(**params)
                message_id = response.get("MessageId")
                logger.debug(f"Sent message with ID: {message_id}")
                return message_id

        except Exception as e:
            logger.error(f"Failed to send message: {e}", exc_info=True)
            return None
