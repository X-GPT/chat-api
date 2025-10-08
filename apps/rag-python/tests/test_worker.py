"""Tests for SQS worker functionality."""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from rag_python.config import Settings
from rag_python.schemas.events import (
    SummaryAction,
    SummaryEvent,
    SummaryLifecycleMessage,
)
from rag_python.worker.handlers import MessageHandlerRegistry, SummaryLifecycleHandler
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
        # Qdrant settings required for MessageProcessor initialization
        qdrant_url="http://localhost:6333",
        qdrant_api_key="test-key",
        qdrant_collection_prefix="test-collection",
        # OpenAI settings (optional but good to have)
        openai_api_key="test-openai-key",
        openai_embedding_model="text-embedding-3-small",
    )


@pytest.fixture
def sqs_client(mock_settings: Settings):
    """Create SQS client instance."""
    return SQSClient(mock_settings)


@pytest.fixture
def mock_qdrant_service():
    """Create mock Qdrant service."""
    mock_service = MagicMock()
    return mock_service


@pytest.fixture
def message_processor(mock_settings: Settings, mock_qdrant_service: MagicMock):
    """Create message processor instance with mocked QdrantService."""
    with patch("rag_python.worker.processor.QdrantService", return_value=mock_qdrant_service):
        processor = MessageProcessor(mock_settings)
        yield processor


def test_message_handler_registry():
    """Test message handler registry."""
    registry = MessageHandlerRegistry(rag_service=AsyncMock())

    # Check that default handlers are registered
    assert registry.get_handler("summary:lifecycle") is not None


@pytest.mark.asyncio
async def test_summary_lifecycle_handler():
    """Test summary lifecycle handler."""
    mock_rag_service = AsyncMock()
    mock_rag_service.ingest_document = AsyncMock(return_value={"chunks_created": 1})

    handler = SummaryLifecycleHandler(rag_service=mock_rag_service)

    message = SummaryLifecycleMessage(
        type="summary:lifecycle",
        data=SummaryEvent(
            id=12345,
            memberCode="user123",
            teamCode="team456",
            parseContent="This is a test summary content",
            action=SummaryAction.CREATED,
            timestamp=datetime.now(UTC),
        ),
    )

    result = await handler.handle(message)
    assert result is True

    # Verify ingest_document was called with correct arguments
    mock_rag_service.ingest_document.assert_called_once_with(
        summary_id=12345,
        member_code="user123",
        content="This is a test summary content",
    )


def test_sqs_client_initialization(sqs_client: SQSClient, mock_settings: Settings):
    """Test SQS client initialization."""
    assert sqs_client.settings == mock_settings
    assert sqs_client.session is not None


@pytest.mark.asyncio
async def test_message_processor_parse_message_body(message_processor: MessageProcessor):
    """Test message body parsing."""
    valid_json = '{"type": "summary:lifecycle", "data": {"id": 123}}'
    result = message_processor._parse_message_body(valid_json)  # pyright: ignore[reportPrivateUsage]
    assert result is not None
    assert result["type"] == "summary:lifecycle"

    invalid_json = "not a json"
    result = message_processor._parse_message_body(invalid_json)  # pyright: ignore[reportPrivateUsage]
    assert result is None


@pytest.mark.asyncio
async def test_message_processor_validate_message(message_processor: MessageProcessor):
    """Test message validation."""
    valid_message_data = {
        "type": "summary:lifecycle",
        "data": {
            "id": 12345,
            "memberCode": "user123",
            "teamCode": "team456",
            "parseContent": "Test content",
            "action": "CREATED",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    }

    message = await message_processor._validate_and_parse_message(valid_message_data)  # pyright: ignore[reportPrivateUsage]
    assert message is not None
    assert message.type == "summary:lifecycle"
    assert message.data.id == 12345
    assert message.data.member_code == "user123"


@pytest.mark.asyncio
async def test_message_processor_extract_metadata(message_processor: MessageProcessor):
    """Test metadata extraction."""
    sqs_message = {
        "MessageId": "msg-123",
        "ReceiptHandle": "receipt-456",
        "Attributes": {"ApproximateReceiveCount": "2"},
    }

    metadata = message_processor._extract_metadata(sqs_message)  # pyright: ignore[reportPrivateUsage]
    assert metadata.message_id == "msg-123"
    assert metadata.receipt_handle == "receipt-456"
    assert metadata.approximate_receive_count == 2


@pytest.mark.asyncio
@patch("rag_python.worker.sqs_client.aioboto3.Session")
async def test_sqs_receive_messages_empty(mock_session: MagicMock, sqs_client: SQSClient):
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
