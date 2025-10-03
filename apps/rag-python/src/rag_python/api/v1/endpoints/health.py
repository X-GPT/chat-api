"""Health check endpoint."""

from fastapi import APIRouter

from rag_python.dependencies import SettingsDep
from rag_python.schemas.health import HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Health Check",
    description="Returns the health status of the API",
)
async def health_check(settings: SettingsDep) -> HealthResponse:
    """Check API health and return status.

    Args:
        settings: Injected application settings.

    Returns:
        HealthResponse: Health status information.
    """
    return HealthResponse(
        status="healthy",
        version=settings.app_version,
        environment=settings.environment,
    )
