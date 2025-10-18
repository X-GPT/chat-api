"""Heuristic token estimation utilities."""


def estimate_tokens(text: str) -> int:
    """Approximate token count assuming roughly 4 characters per token."""
    return max(0, len(text) // 4)
