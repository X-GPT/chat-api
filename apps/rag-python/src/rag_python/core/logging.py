"""Logging configuration."""

import logging
import sys

from rag_python.config import get_settings


def setup_logging() -> None:
    """Configure application logging."""
    settings = get_settings()

    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


def get_logger(name: str) -> logging.Logger:
    """Get a logger instance.

    Args:
        name: Logger name (typically __name__ of the module).

    Returns:
        logging.Logger: Configured logger instance.
    """
    return logging.getLogger(name)
