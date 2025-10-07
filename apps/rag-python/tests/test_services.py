"""Tests for service layer."""

from rag_python.services.hello import HelloService


def test_hello_service_get_message():
    """Test HelloService returns correct message."""
    service = HelloService()
    message = service.get_hello_message()
    assert message == "Hello, World!"
    assert isinstance(message, str)
