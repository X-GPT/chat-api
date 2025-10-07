"""Event handlers for processing SQS messages."""

from typing import Protocol

from rag_python.core.logging import get_logger
from rag_python.schemas.events import (
    SQSMessage,
    SummaryAction,
    SummaryEvent,
    SummaryLifecycleMessage,
)

logger = get_logger(__name__)


class MessageHandler(Protocol):
    """Protocol for message handlers."""

    async def handle(self, message: SQSMessage) -> bool:
        """Handle a message.

        Args:
            message: The message to handle.

        Returns:
            bool: True if handled successfully, False otherwise.
        """
        ...


class SummaryLifecycleHandler:
    """Handler for summary lifecycle events."""

    async def handle(self, message: SummaryLifecycleMessage) -> bool:
        """Handle summary lifecycle message.

        Args:
            message: The summary lifecycle message.

        Returns:
            bool: True if successful.
        """
        event = message.data
        logger.info(
            f"Processing summary lifecycle event: {event.action.value} for summary ID {event.id}"
        )

        # Handle different actions
        if event.action == SummaryAction.CREATED:
            return await self._handle_created(event)
        elif event.action == SummaryAction.UPDATED:
            return await self._handle_updated(event)
        elif event.action == SummaryAction.DELETED:
            return await self._handle_deleted(event)
        else:
            logger.warning(f"Unknown action: {event.action}")
            return False

    async def _handle_created(self, event: SummaryEvent) -> bool:
        """Handle CREATED action.

        Args:
            event: The summary event.

        Returns:
            bool: True if successful.
        """
        logger.info(
            f"Summary created - ID: {event.id}, Member: {event.member_code}, "
            f"Team: {event.team_code}"
        )

        # Your business logic here
        # Example: Index the summary content, create embeddings, etc.
        if event.parse_content:
            logger.info(f"Content preview: {event.parse_content[:100]}...")
            # TODO: Process the content (e.g., create embeddings, index in vector DB)

        return True

    async def _handle_updated(self, event: SummaryEvent) -> bool:
        """Handle UPDATED action.

        Args:
            event: The summary event.

        Returns:
            bool: True if successful.
        """
        logger.info(
            f"Summary updated - ID: {event.id}, Member: {event.member_code}, "
            f"Team: {event.team_code}"
        )

        # Your business logic here
        # Example: Update embeddings, re-index content, etc.
        if event.parse_content:
            logger.info(f"Updated content preview: {event.parse_content[:100]}...")
            # TODO: Update the content (e.g., update embeddings, re-index in vector DB)

        return True

    async def _handle_deleted(self, event: SummaryEvent) -> bool:
        """Handle DELETED action.

        Args:
            event: The summary event.

        Returns:
            bool: True if successful.
        """
        logger.info(
            f"Summary deleted - ID: {event.id}, Member: {event.member_code}, "
            f"Team: {event.team_code}"
        )

        # Your business logic here
        # Example: Remove from index, delete embeddings, cleanup, etc.
        # TODO: Delete from vector DB, remove index entries, etc.

        return True


class MessageHandlerRegistry:
    """Registry for message handlers."""

    def __init__(self):
        """Initialize handler registry."""
        self._handlers: dict[str, MessageHandler] = {
            "summary:lifecycle": SummaryLifecycleHandler(),
        }

    def get_handler(self, message_type: str) -> MessageHandler | None:
        """Get handler for a message type.

        Args:
            message_type: The message type (e.g., "summary:lifecycle").

        Returns:
            MessageHandler | None: The handler or None if not found.
        """
        return self._handlers.get(message_type)

    def register_handler(self, message_type: str, handler: MessageHandler) -> None:
        """Register a new handler.

        Args:
            message_type: The message type (e.g., "summary:lifecycle").
            handler: The handler instance.
        """
        self._handlers[message_type] = handler
        logger.info(f"Registered handler for message type: {message_type}")
