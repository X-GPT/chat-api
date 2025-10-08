"""Integration tests for event handlers with RAG service."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from rag_python.schemas.events import SummaryAction, SummaryEvent, SummaryLifecycleMessage
from rag_python.worker.handlers import SummaryLifecycleHandler


@pytest.fixture
def mock_rag_service():
    """Create mock RAG service."""
    mock = MagicMock()
    mock.ingest_document = AsyncMock(
        return_value={
            "summary_id": 123,
            "member_code": "user123",
            "parent_chunks": 2,
            "child_chunks": 5,
            "total_points": 7,
        }
    )
    mock.update_document = AsyncMock(
        return_value={
            "summary_id": 123,
            "member_code": "user123",
            "operation": "update",
            "parent_chunks": 2,
            "child_chunks": 5,
            "total_points": 7,
        }
    )
    mock.delete_document = AsyncMock(
        return_value={
            "summary_id": 123,
            "operation": "delete",
        }
    )
    return mock


@pytest.fixture
def handler(mock_rag_service: MagicMock):
    """Create handler with mock RAG service."""
    return SummaryLifecycleHandler(mock_rag_service)


@pytest.mark.asyncio
async def test_handle_created(handler: SummaryLifecycleHandler, mock_rag_service: MagicMock):
    """Test handling CREATED event."""
    # Create test event
    event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent="This is test content for ingestion.",
        action=SummaryAction.CREATED,
        timestamp=datetime.now(),
    )
    message = SummaryLifecycleMessage(type="summary:lifecycle", data=event)

    # Handle message
    result = await handler.handle(message)

    # Verify success
    assert result is True

    # Verify RAG service was called
    mock_rag_service.ingest_document.assert_called_once_with(
        summary_id=123,
        member_code="user123",
        content="This is test content for ingestion.",
    )


@pytest.mark.asyncio
async def test_handle_created_without_content(
    handler: SummaryLifecycleHandler, mock_rag_service: MagicMock
):
    """Test handling CREATED event without content."""
    # Create test event without content
    event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent=None,
        action=SummaryAction.CREATED,
        timestamp=datetime.now(),
    )
    message = SummaryLifecycleMessage(type="summary:lifecycle", data=event)

    # Handle message
    result = await handler.handle(message)

    # Verify success (but no ingestion)
    assert result is True

    # Verify RAG service was NOT called
    mock_rag_service.ingest_document.assert_not_called()


@pytest.mark.asyncio
async def test_handle_updated(handler: SummaryLifecycleHandler, mock_rag_service: MagicMock):
    """Test handling UPDATED event."""
    # Create test event
    event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent="Updated content for the summary.",
        action=SummaryAction.UPDATED,
        timestamp=datetime.now(),
    )
    message = SummaryLifecycleMessage(type="summary:lifecycle", data=event)

    # Handle message
    result = await handler.handle(message)

    # Verify success
    assert result is True

    # Verify RAG service was called
    mock_rag_service.update_document.assert_called_once_with(
        summary_id=123,
        member_code="user123",
        content="Updated content for the summary.",
    )


@pytest.mark.asyncio
async def test_handle_updated_without_content(
    handler: SummaryLifecycleHandler, mock_rag_service: MagicMock
):
    """Test handling UPDATED event without content."""
    # Create test event without content
    event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent=None,
        action=SummaryAction.UPDATED,
        timestamp=datetime.now(),
    )
    message = SummaryLifecycleMessage(type="summary:lifecycle", data=event)

    # Handle message
    result = await handler.handle(message)

    # Verify success (but no update)
    assert result is True

    # Verify RAG service was NOT called
    mock_rag_service.update_document.assert_not_called()


@pytest.mark.asyncio
async def test_handle_deleted(handler: SummaryLifecycleHandler, mock_rag_service: MagicMock):
    """Test handling DELETED event."""
    # Create test event
    event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent=None,
        action=SummaryAction.DELETED,
        timestamp=datetime.now(),
    )
    message = SummaryLifecycleMessage(type="summary:lifecycle", data=event)

    # Handle message
    result = await handler.handle(message)

    # Verify success
    assert result is True

    # Verify RAG service was called
    mock_rag_service.delete_document.assert_called_once_with(summary_id=123)


@pytest.mark.asyncio
async def test_handle_created_with_error(
    handler: SummaryLifecycleHandler, mock_rag_service: MagicMock
):
    """Test error handling during CREATED event."""
    # Make RAG service raise an error
    mock_rag_service.ingest_document = AsyncMock(side_effect=Exception("Ingestion error"))

    # Create test event
    event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent="Test content.",
        action=SummaryAction.CREATED,
        timestamp=datetime.now(),
    )
    message = SummaryLifecycleMessage(type="summary:lifecycle", data=event)

    # Handle message
    result = await handler.handle(message)

    # Verify failure
    assert result is False


@pytest.mark.asyncio
async def test_handle_updated_with_error(
    handler: SummaryLifecycleHandler, mock_rag_service: MagicMock
):
    """Test error handling during UPDATED event."""
    # Make RAG service raise an error
    mock_rag_service.update_document = AsyncMock(side_effect=Exception("Update error"))

    # Create test event
    event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent="Updated content.",
        action=SummaryAction.UPDATED,
        timestamp=datetime.now(),
    )
    message = SummaryLifecycleMessage(type="summary:lifecycle", data=event)

    # Handle message
    result = await handler.handle(message)

    # Verify failure
    assert result is False


@pytest.mark.asyncio
async def test_handle_deleted_with_error(
    handler: SummaryLifecycleHandler, mock_rag_service: MagicMock
):
    """Test error handling during DELETED event."""
    # Make RAG service raise an error
    mock_rag_service.delete_document = AsyncMock(side_effect=Exception("Delete error"))

    # Create test event
    event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent=None,
        action=SummaryAction.DELETED,
        timestamp=datetime.now(),
    )
    message = SummaryLifecycleMessage(type="summary:lifecycle", data=event)

    # Handle message
    result = await handler.handle(message)

    # Verify failure
    assert result is False


@pytest.mark.asyncio
async def test_handle_with_long_content(
    handler: SummaryLifecycleHandler, mock_rag_service: MagicMock
):
    """Test handling event with very long content."""
    # Create test event with long content
    long_content = "This is a very long content. " * 1000  # ~30KB
    event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent=long_content,
        action=SummaryAction.CREATED,
        timestamp=datetime.now(),
    )
    message = SummaryLifecycleMessage(type="summary:lifecycle", data=event)

    # Handle message
    result = await handler.handle(message)

    # Verify success
    assert result is True

    # Verify RAG service was called with full content
    mock_rag_service.ingest_document.assert_called_once()
    call_args = mock_rag_service.ingest_document.call_args[1]
    assert call_args["content"] == long_content


@pytest.mark.asyncio
async def test_multiple_events_sequence(
    handler: SummaryLifecycleHandler, mock_rag_service: MagicMock
):
    """Test handling sequence of events for the same document."""
    timestamp = datetime.now()

    # 1. Create document
    create_event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent="Initial content.",
        action=SummaryAction.CREATED,
        timestamp=timestamp,
    )
    create_message = SummaryLifecycleMessage(type="summary:lifecycle", data=create_event)
    result = await handler.handle(create_message)
    assert result is True

    # 2. Update document
    update_event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent="Updated content.",
        action=SummaryAction.UPDATED,
        timestamp=timestamp,
    )
    update_message = SummaryLifecycleMessage(type="summary:lifecycle", data=update_event)
    result = await handler.handle(update_message)
    assert result is True

    # 3. Delete document
    delete_event = SummaryEvent(
        id=123,
        memberCode="user123",
        teamCode="team456",
        parseContent=None,
        action=SummaryAction.DELETED,
        timestamp=timestamp,
    )
    delete_message = SummaryLifecycleMessage(type="summary:lifecycle", data=delete_event)
    result = await handler.handle(delete_message)
    assert result is True

    # Verify all operations were called
    mock_rag_service.ingest_document.assert_called_once()
    mock_rag_service.update_document.assert_called_once()
    mock_rag_service.delete_document.assert_called_once()
