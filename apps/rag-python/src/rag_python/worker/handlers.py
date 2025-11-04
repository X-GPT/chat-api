"""Event handlers for processing SQS messages."""

from typing import Protocol

from rag_python.core.logging import get_logger
from rag_python.schemas.events import (
    CollectionRelationshipMessage,
    SQSMessage,
    SummaryAction,
    SummaryEvent,
    SummaryLifecycleMessage,
)
from rag_python.services.ingestion_service import IngestionService
from rag_python.services.qdrant_service import QdrantService

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

    def __init__(self, ingestion_service: IngestionService):
        """Initialize handler with ingestion service.

        Args:
            ingestion_service: Ingestion service for document processing.
        """
        self.ingestion_service = ingestion_service

    async def handle(self, message: SQSMessage) -> bool:
        """Handle summary lifecycle message.

        Args:
            message: The summary lifecycle message.

        Returns:
            bool: True if successful.
        """
        if not isinstance(message, SummaryLifecycleMessage):
            logger.error(f"Invalid message type for SummaryLifecycleHandler: {type(message)}")
            return False

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
            event: The summary event with content fields.

        Returns:
            bool: True if successful.
        """
        logger.info(
            f"Summary created - ID: {event.id}, Member: {event.member_code}, "
            f"Team: {event.team_code}"
        )

        original_content = self._validate_event_content(event)
        if original_content is None:
            return False

        logger.info(
            "Content lengths - summary=%s, original=%s",
            len(original_content),
        )

        try:
            stats = await self.ingestion_service.ingest_document(
                summary_id=event.id,
                member_code=event.member_code,
                original_content=original_content,
                collection_ids=event.collection_ids,
            )
            logger.info("Successfully ingested document: %s", stats)
            return True
        except Exception as exc:
            logger.error("Failed to ingest document: %s", exc, exc_info=True)
            return False

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

        original_content = self._validate_event_content(event)
        if original_content is None:
            return False

        logger.info(
            "Updated content lengths - summary=%s, original=%s",
            len(original_content),
        )

        try:
            stats = await self.ingestion_service.update_document(
                summary_id=event.id,
                member_code=event.member_code,
                original_content=original_content,
                collection_ids=event.collection_ids,
            )
            logger.info("Successfully updated document: %s", stats)
            return True
        except Exception as exc:
            logger.error("Failed to update document: %s", exc, exc_info=True)
            return False

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

        # Delete document from vector database
        try:
            stats = await self.ingestion_service.delete_document(summary_id=event.id)
            logger.info(f"Successfully deleted document: {stats}")
        except Exception as e:
            logger.error(f"Failed to delete document: {e}", exc_info=True)
            return False

        return True

    @staticmethod
    def _validate_event_content(event: SummaryEvent) -> str | None:
        """Ensure the event contains both summary and original content."""
        original_content = event.parse_content

        if not original_content:
            logger.error(
                "Missing parse_content (original document) for summary_id=%s",
                event.id,
            )
            return None

        return original_content


class CollectionRelationshipHandler:
    """Handler for collection relationship events.

    Handles full-state updates to collection relationships. The Java backend sends
    the complete current state of collection IDs, which is the source of truth.
    We simply replace the existing relationships with the new state.
    """

    def __init__(self, qdrant_service: QdrantService):
        """Initialize handler with Qdrant service.

        Args:
            qdrant_service: Qdrant service for metadata updates.
        """
        self.qdrant_service = qdrant_service

    async def handle(self, message: SQSMessage) -> bool:
        """Handle collection relationship message with full state.

        The Java backend sends the complete current state of collection IDs.
        We replace the existing relationships with this new state.

        Args:
            message: The collection relationship message.

        Returns:
            bool: True if successful.
        """
        if not isinstance(message, CollectionRelationshipMessage):
            logger.error(f"Invalid message type for CollectionRelationshipHandler: {type(message)}")
            return False

        event = message.data
        logger.info(
            f"Processing collection relationship event: {event.action.value} "
            f"for summary ID {event.summary_id} - "
            f"Collection IDs: {event.collection_ids}, "
            f"Member: {event.member_code}, Team: {event.team_code}"
        )

        try:
            # Get current collection IDs for logging
            current_ids = await self.qdrant_service.get_collection_ids(event.summary_id)
            logger.debug(f"Current collection IDs for summary {event.summary_id}: {current_ids}")

            # Use the collection_ids from the event as the new state
            # If None, treat as empty list
            new_ids = sorted(event.collection_ids) if event.collection_ids else []

            # Update in Qdrant with the new state
            await self.qdrant_service.update_collection_ids(
                summary_id=event.summary_id,
                collection_ids=new_ids,
            )

            logger.info(
                f"Successfully updated collection IDs for summary {event.summary_id} "
                f"(action: {event.action.value}) - "
                f"Before: {sorted(current_ids)}, After: {new_ids}"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to update collection IDs: {e}", exc_info=True)
            return False


class MessageHandlerRegistry:
    """Registry for message handlers."""

    def __init__(self, ingestion_service: IngestionService, qdrant_service: QdrantService):
        """Initialize handler registry.

        Args:
            ingestion_service: Ingestion service for document processing.
            qdrant_service: Qdrant service for metadata updates.
        """
        self._handlers: dict[str, MessageHandler] = {
            "summary:lifecycle": SummaryLifecycleHandler(ingestion_service),
            "collection:relationship": CollectionRelationshipHandler(qdrant_service),
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
