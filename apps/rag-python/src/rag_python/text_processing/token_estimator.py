"""Heuristic token estimation utilities."""


CHARS_PER_TOKEN = 4

def estimate_tokens(text: str) -> int:
    """Approximate token count assuming roughly 4 characters per token."""
    return max(0, len(text) // CHARS_PER_TOKEN)
