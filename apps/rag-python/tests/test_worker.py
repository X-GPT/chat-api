"""Tests for SQS worker functionality."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from rag_python.config import Settings
from rag_python.schemas.events import BaseEvent, EventType
from rag_python.worker.handlers import EventHandlerRegistry, HelloEventHandler
from rag_python.worker.processor import MessageProcessor
from rag_python.worker.sqs_client import SQSClient


@pytest.fixture
def mock_settings():
    """Create mock settings for testing."""
    return Settings(
        sqs_queue_url="https://sqs.us-east-1.amazonaws.com/123456789/test-queue",
        aws_region="us-east-1",
        sqs_max_messages=10,
        sqs_wait_time_seconds=20,
    )


@pytest.fixture
def sqs_client(mock_settings):
    """Create SQS client instance."""
    return SQSClient(mock_settings)


@pytest.fixture
def message_processor(mock_settings):
    """Create message processor instance."""
    return MessageProcessor(mock_settings)


def test_event_handler_registry():
    """Test event handler registry."""
    registry = EventHandlerRegistry()

    # Check that default handlers are registered
    assert registry.get_handler(EventType.HELLO) is not None
    assert registry.get_handler(EventType.TASK_CREATED) is not None
    assert registry.get_handler(EventType.TASK_COMPLETED) is not None


@pytest.mark.asyncio
async def test_hello_event_handler():
    """Test hello event handler."""
    handler = HelloEventHandler()

    event = BaseEvent(
        event_type=EventType.HELLO,
        event_id="test-123",
        timestamp=datetime.utcnow(),
        payload={"message": "Test message"},
    )

    result = await handler.handle(event)
    assert result is True


def test_sqs_client_initialization(sqs_client, mock_settings):
    """Test SQS client initialization."""
    assert sqs_client.settings == mock_settings
    assert sqs_client.session is not None


@pytest.mark.asyncio
async def test_message_processor_parse_message_body(message_processor):
    """Test message body parsing."""
    valid_json = '{"event_type": "hello", "event_id": "123"}'
    result = message_processor._parse_message_body(valid_json)
    assert result is not None
    assert result["event_type"] == "hello"

    invalid_json = "not a json"
    result = message_processor._parse_message_body(invalid_json)
    assert result is None


@pytest.mark.asyncio
async def test_message_processor_validate_event(message_processor):
    """Test event validation."""
    valid_event_data = {
        "event_type": "hello",
        "event_id": "test-123",
        "timestamp": datetime.utcnow().isoformat(),
        "payload": {"message": "test"},
    }

    event = await message_processor._validate_and_parse_event(valid_event_data)
    assert event is not None
    assert event.event_type == EventType.HELLO
    assert event.event_id == "test-123"


@pytest.mark.asyncio
async def test_message_processor_extract_metadata(message_processor):
    """Test metadata extraction."""
    sqs_message = {
        "MessageId": "msg-123",
        "ReceiptHandle": "receipt-456",
        "Attributes": {"ApproximateReceiveCount": "2"},
    }

    metadata = message_processor._extract_metadata(sqs_message)
    assert metadata.message_id == "msg-123"
    assert metadata.receipt_handle == "receipt-456"
    assert metadata.approximate_receive_count == 2


@pytest.mark.asyncio
@patch("rag_python.worker.sqs_client.aioboto3.Session")
async def test_sqs_receive_messages_empty(mock_session, sqs_client):
    """Test receiving messages when queue is empty."""
    mock_sqs = AsyncMock()
    mock_sqs.receive_message = AsyncMock(return_value={"Messages": []})

    mock_session_instance = MagicMock()
    mock_session_instance.client = MagicMock()
    mock_session_instance.client.return_value.__aenter__ = AsyncMock(return_value=mock_sqs)
    mock_session_instance.client.return_value.__aexit__ = AsyncMock(return_value=None)

    sqs_client.session = mock_session_instance

    messages = await sqs_client.receive_messages()
    assert messages == []
