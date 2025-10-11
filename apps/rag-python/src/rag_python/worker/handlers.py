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
from rag_python.services.qdrant_service import QdrantService
from rag_python.services.rag_service import RAGService

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

    def __init__(self, rag_service: RAGService):
        """Initialize handler with RAG service.

        Args:
            rag_service: RAG service for document ingestion.
        """
        self.rag_service = rag_service

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
            event: The summary event.

        Returns:
            bool: True if successful.
        """
        logger.info(
            f"Summary created - ID: {event.id}, Member: {event.member_code}, "
            f"Team: {event.team_code}"
        )

        # Ingest document into vector database
        if event.parse_content:
            logger.info(f"Content preview: {event.parse_content[:100]}...")

            try:
                stats = await self.rag_service.ingest_document(
                    summary_id=event.id,
                    member_code=event.member_code,
                    content=event.parse_content,
                )
                logger.info(f"Successfully ingested document: {stats}")
            except Exception as e:
                logger.error(f"Failed to ingest document: {e}", exc_info=True)
                return False

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

        # Update document in vector database
        if event.parse_content:
            logger.info(f"Updated content preview: {event.parse_content[:100]}...")

            try:
                stats = await self.rag_service.update_document(
                    summary_id=event.id,
                    member_code=event.member_code,
                    content=event.parse_content,
                )
                logger.info(f"Successfully updated document: {stats}")
            except Exception as e:
                logger.error(f"Failed to update document: {e}", exc_info=True)
                return False

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

        # Delete document from vector database
        try:
            stats = await self.rag_service.delete_document(summary_id=event.id)
            logger.info(f"Successfully deleted document: {stats}")
        except Exception as e:
            logger.error(f"Failed to delete document: {e}", exc_info=True)
            return False

        return True


class CollectionRelationshipHandler:
    """Handler for collection relationship events.

    Handles delta updates to collection relationships. The Java backend sends
    incremental changes (addedCollectionIds, removedCollectionIds) rather than
    the complete state, so we retrieve current state, apply changes, and update.
    """

    def __init__(self, qdrant_service: QdrantService):
        """Initialize handler with Qdrant service.

        Args:
            qdrant_service: Qdrant service for metadata updates.
        """
        self.qdrant_service = qdrant_service

    async def handle(self, message: SQSMessage) -> bool:
        """Handle collection relationship message with delta updates.

        The Java backend sends incremental changes (addedCollectionIds, removedCollectionIds)
        rather than the complete state. We retrieve the current state, apply the delta,
        and update all points with the new state.

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
            f"Added: {event.added_collection_ids}, Removed: {event.removed_collection_ids}, "
            f"Member: {event.member_code}, Team: {event.team_code}"
        )

        try:
            # Get current collection IDs
            current_ids = await self.qdrant_service.get_collection_ids(event.summary_id)
            logger.debug(f"Current collection IDs for summary {event.summary_id}: {current_ids}")

            # Apply delta updates
            new_ids = set(current_ids)

            # Add new collections
            if event.added_collection_ids:
                new_ids.update(event.added_collection_ids)
                logger.debug(f"Adding collection IDs: {event.added_collection_ids}")

            # Remove collections
            if event.removed_collection_ids:
                new_ids.difference_update(event.removed_collection_ids)
                logger.debug(f"Removing collection IDs: {event.removed_collection_ids}")

            # Convert back to sorted list
            final_ids = sorted(list(new_ids))

            # Update in Qdrant
            await self.qdrant_service.update_collection_ids(
                summary_id=event.summary_id,
                collection_ids=final_ids,
            )

            logger.info(
                f"Successfully updated collection IDs for summary {event.summary_id} "
                f"(action: {event.action.value}) - "
                f"Before: {sorted(current_ids)}, After: {final_ids}"
            )
            return True
        except Exception as e:
            logger.error(f"Failed to update collection IDs: {e}", exc_info=True)
            return False


class MessageHandlerRegistry:
    """Registry for message handlers."""

    def __init__(self, rag_service: RAGService, qdrant_service: QdrantService):
        """Initialize handler registry.

        Args:
            rag_service: RAG service for document ingestion.
            qdrant_service: Qdrant service for metadata updates.
        """
        self._handlers: dict[str, MessageHandler] = {
            "summary:lifecycle": SummaryLifecycleHandler(rag_service),
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
