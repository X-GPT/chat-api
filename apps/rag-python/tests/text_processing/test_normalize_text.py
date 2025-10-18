"""Tests for text normalization utilities."""

import pytest

from rag_python.text_processing.normalize_text import normalize_text


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("café", "café"),
        ("cafe\u0301", "café"),  # Combining accent
        ("ｈｅｌｌｏ", "hello"),  # Full-width characters
    ],
)
def test_unicode_normalization(raw: str, expected: str) -> None:
    assert normalize_text(raw) == expected


def test_html_entities_decoded() -> None:
    assert normalize_text("M&amp;A strategy") == "M&A strategy"
    assert normalize_text("&lt;script&gt;") == "<script>"
    assert normalize_text("It&#39;s working") == "It's working"


def test_zero_width_characters_removed() -> None:
    assert normalize_text("hello\u200Bworld") == "helloworld"
    assert normalize_text("\uFEFFtext") == "text"


def test_hyphenation_fix() -> None:
    assert normalize_text("employ-\nment") == "employment"
    assert normalize_text("state-of-the-art") == "state-of-the-art"


def test_soft_line_breaks_joined() -> None:
    text = "This is a long paragraph\nthat spans multiple lines\nwithout proper punctuation"
    normalized = normalize_text(text)
    assert "\n" not in normalized
    assert normalized == "This is a long paragraph that spans multiple lines without proper punctuation"


def test_paragraph_spacing_preserved() -> None:
    text = "Para 1.\n\n\n\nPara 2."
    assert normalize_text(text) == "Para 1.\n\nPara 2."


def test_headers_removed() -> None:
    assert normalize_text("Page 42") == ""
    assert normalize_text("17 / 42") == ""
    assert normalize_text("Content\nPage 42\nMore content") == "Content\n\nMore content"


def test_line_endings_standardized() -> None:
    assert normalize_text("Line1\r\nLine2") == "Line1\nLine2"
    assert normalize_text("Line1\rLine2") == "Line1\nLine2"


def test_whitespace_collapsed() -> None:
    assert normalize_text("Hello    world") == "Hello world"
    assert normalize_text("Hello\t\tworld") == "Hello world"
