"""Hello world endpoint."""

from fastapi import APIRouter

from rag_python.schemas.hello import HelloWorldResponse
from rag_python.services.hello import HelloService

router = APIRouter(tags=["hello"])


@router.get(
    "/hello-world",
    response_model=HelloWorldResponse,
    summary="Hello World",
    description="Returns a simple hello world message",
)
async def hello_world() -> HelloWorldResponse:
    """Return a hello world message.

    Returns:
        HelloWorldResponse: The hello world response.
    """
    service = HelloService()
    message = service.get_hello_message()
    return HelloWorldResponse(message=message)
