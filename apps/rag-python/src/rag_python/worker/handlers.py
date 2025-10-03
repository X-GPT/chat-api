"""Event handlers for processing SQS messages."""

from rag_python.core.logging import get_logger
from rag_python.schemas.events import BaseEvent, EventType

logger = get_logger(__name__)


class EventHandler:
    """Base event handler class."""

    async def handle(self, event: BaseEvent) -> bool:
        """Handle an event.

        Args:
            event: The event to handle.

        Returns:
            bool: True if handled successfully, False otherwise.
        """
        raise NotImplementedError


class HelloEventHandler(EventHandler):
    """Handler for hello events."""

    async def handle(self, event: BaseEvent) -> bool:
        """Handle hello event.

        Args:
            event: The hello event.

        Returns:
            bool: True if successful.
        """
        logger.info(f"Processing hello event: {event.event_id}")
        logger.info(f"Payload: {event.payload}")

        # Your business logic here
        message = event.payload.get("message", "No message")
        logger.info(f"Hello message: {message}")

        return True


class TaskCreatedHandler(EventHandler):
    """Handler for task created events."""

    async def handle(self, event: BaseEvent) -> bool:
        """Handle task created event.

        Args:
            event: The task created event.

        Returns:
            bool: True if successful.
        """
        logger.info(f"Processing task.created event: {event.event_id}")

        # Your business logic here
        # Example: Create a task, send notifications, etc.

        return True


class TaskCompletedHandler(EventHandler):
    """Handler for task completed events."""

    async def handle(self, event: BaseEvent) -> bool:
        """Handle task completed event.

        Args:
            event: The task completed event.

        Returns:
            bool: True if successful.
        """
        logger.info(f"Processing task.completed event: {event.event_id}")

        # Your business logic here
        # Example: Update status, send notifications, cleanup, etc.

        return True


class EventHandlerRegistry:
    """Registry for event handlers."""

    def __init__(self):
        """Initialize handler registry."""
        self._handlers: dict[EventType, EventHandler] = {
            EventType.HELLO: HelloEventHandler(),
            EventType.TASK_CREATED: TaskCreatedHandler(),
            EventType.TASK_COMPLETED: TaskCompletedHandler(),
        }

    def get_handler(self, event_type: EventType) -> EventHandler | None:
        """Get handler for an event type.

        Args:
            event_type: The event type.

        Returns:
            EventHandler | None: The handler or None if not found.
        """
        return self._handlers.get(event_type)

    def register_handler(self, event_type: EventType, handler: EventHandler) -> None:
        """Register a new handler.

        Args:
            event_type: The event type.
            handler: The handler instance.
        """
        self._handlers[event_type] = handler
        logger.info(f"Registered handler for event type: {event_type}")
