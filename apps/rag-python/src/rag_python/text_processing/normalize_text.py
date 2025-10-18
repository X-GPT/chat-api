"""Text normalization utilities for ingestion."""

from collections import deque
import html
import re
import unicodedata

from rag_python.core.logging import get_logger

logger = get_logger(__name__)

# Regex patterns compiled once for efficiency
_ZW_PATTERN = re.compile(r"[\u200B-\u200D\uFEFF]")  # Zero-width characters
_MULTISPACE_PATTERN = re.compile(r"[ ]{2,}")
_EOL_HYPHEN_PATTERN = re.compile(r"(\w)-\n(\w)")
_EOL_SOFT_PATTERN = re.compile(r"(?<=[a-z])\n(?=[a-z])")
_HEADER_FOOTER_PATTERN = re.compile(r"^\s*(Page\s+\d+|\d+\s*/\s*\d+)\s*$", re.I)


def _replace_control_chars(value: str) -> str:
    """Replace tabs with spaces and drop other control characters (except newline)."""
    buffer: deque[str] = deque()
    for ch in value:
        if ch == "\n":
            buffer.append(ch)
        elif ch == "\t":
            buffer.append(" ")
        elif ch >= " ":
            buffer.append(ch)
    return "".join(buffer)


def normalize_text(value: str) -> str:
    """Normalize text for consistent downstream processing.

    Steps:
        1. Unicode normalization (NFKC) and HTML entity decoding.
        2. Remove zero-width characters and control chars (except newline).
        3. Standardize line endings to LF and collapse multi-spaces.
        4. Drop simple page headers/footers (e.g., "Page 1" / "1 / 5").
        5. Fix hyphenation and soft line breaks.
        6. Collapse excess blank lines and trim.

    Args:
        value: Raw text.

    Returns:
        Normalized text preserving paragraph structure.
    """
    if value == "":
        return value

    # Unicode normalize and decode HTML entities
    text = unicodedata.normalize("NFKC", value)
    text = html.unescape(text)

    # Standardize line endings before removing control chars
    text = text.replace("\r\n", "\n").replace("\r", "\n")

    # Replace tabs, drop other control characters (except newline), and remove zero-width chars
    text = _replace_control_chars(text)
    text = _ZW_PATTERN.sub("", text)

    # Collapse multiple spaces (tabs already converted above)
    text = _MULTISPACE_PATTERN.sub(" ", text)

    # Remove simple headers/footers
    lines: list[str] = []
    for line in text.split("\n"):
        if _HEADER_FOOTER_PATTERN.match(line):
            if lines and lines[-1] != "":
                lines.append("")
            continue
        lines.append(line.rstrip())
    text = "\n".join(lines)

    # Fix hyphenation and soft line breaks
    text = _EOL_HYPHEN_PATTERN.sub(r"\1\2", text)
    text = _EOL_SOFT_PATTERN.sub(" ", text)

    # Collapse multiple blank lines and trailing spaces
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    text = _MULTISPACE_PATTERN.sub(" ", text)

    logger.debug("Normalized text length from %d to %d chars", len(value), len(text))
    return text
