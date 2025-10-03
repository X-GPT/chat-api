"""Hello service with business logic."""

from rag_python.core.logging import get_logger

logger = get_logger(__name__)


class HelloService:
    """Service for hello-related operations."""

    def get_hello_message(self) -> str:
        """Get a hello world message.

        Returns:
            str: The hello world message.
        """
        logger.debug("Generating hello world message")
        return "Hello, World!"
