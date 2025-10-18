"""Tests for checksum helpers."""

from rag_python.text_processing.checksum import compute_checksum


def test_checksum_consistency_after_normalization() -> None:
    """Different raw forms that normalize equally should hash identically."""
    assert compute_checksum("Hello  world") == compute_checksum("Hello world")
    assert compute_checksum("employ-\nment") == compute_checksum("employment")


def test_checksum_differs_for_unique_content() -> None:
    first = compute_checksum("First document")
    second = compute_checksum("Second document")
    assert first != second
