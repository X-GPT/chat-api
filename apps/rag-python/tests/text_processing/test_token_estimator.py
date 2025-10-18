"""Tests for token estimator heuristics."""

from rag_python.text_processing.token_estimator import estimate_tokens


def test_token_estimator_short_samples() -> None:
    assert estimate_tokens("") == 0
    assert estimate_tokens("abcd") == 1
    assert estimate_tokens("abcdefg") == 1  # Floor division


def test_token_estimator_longer_samples() -> None:
    text = "lorem ipsum " * 40
    expected = len(text) // 4
    assert estimate_tokens(text) == expected
