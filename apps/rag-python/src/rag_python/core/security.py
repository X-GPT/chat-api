"""Security utilities and middleware."""

from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse


async def security_headers_middleware(request: Request, call_next: Any) -> JSONResponse:
    """Add security headers to responses.

    Args:
        request: The incoming request.
        call_next: The next middleware or route handler.

    Returns:
        Response: Response with security headers added.
    """
    response = await call_next(request)

    # Add security headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"

    return response
