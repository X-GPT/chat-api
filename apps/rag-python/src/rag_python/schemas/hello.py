"""Hello endpoint schemas."""

from pydantic import BaseModel, Field


class HelloWorldResponse(BaseModel):
    """Hello world response schema."""

    message: str = Field(..., description="The hello world message")

    model_config = {"json_schema_extra": {"examples": [{"message": "Hello, World!"}]}}
