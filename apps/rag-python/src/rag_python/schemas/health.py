"""Health check schemas."""

from pydantic import BaseModel, Field


class HealthResponse(BaseModel):
    """Health check response schema."""

    status: str = Field(..., description="Health status")
    version: str = Field(..., description="Application version")
    environment: str = Field(..., description="Environment name")

    model_config = {
        "json_schema_extra": {
            "examples": [{"status": "healthy", "version": "0.1.0", "environment": "development"}]
        }
    }
