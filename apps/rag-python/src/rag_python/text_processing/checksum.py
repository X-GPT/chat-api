"""Checksum helpers for normalized text."""

import hashlib

from rag_python.core.logging import get_logger

from .normalize_text import normalize_text

logger = get_logger(__name__)


def compute_checksum(value: str) -> str:
    """Compute SHA256 checksum of normalized text.

    Args:
        value: Raw text to hash (will be normalized first).

    Returns:
        Hex string representation of SHA256 hash.
    """
    normalized = normalize_text(value)
    checksum = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    logger.debug(
        "Computed checksum %s… for %d-char input (%d-char normalized)",
        checksum[:8],
        len(value),
        len(normalized),
    )
    return checksum
