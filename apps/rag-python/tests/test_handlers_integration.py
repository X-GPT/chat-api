"""Integration tests for event handlers with RAG service."""

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock

import pytest

from rag_python.schemas.events import (
    CollectionRelationshipAction,
    CollectionRelationshipEvent,
    CollectionRelationshipMessage,
    SummaryAction,
    SummaryEvent,
    SummaryLifecycleMessage,
)
from rag_python.worker.handlers import CollectionRelationshipHandler, SummaryLifecycleHandler


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


# Tests for CollectionRelationshipHandler


@pytest.fixture
def mock_qdrant_service():
    """Create mock Qdrant service."""
    mock = MagicMock()
    mock.get_collection_ids = AsyncMock(return_value=[])
    mock.update_collection_ids = AsyncMock(return_value=None)
    return mock


@pytest.fixture
def collection_handler(mock_qdrant_service: MagicMock):
    """Create handler with mock Qdrant service."""
    return CollectionRelationshipHandler(mock_qdrant_service)


@pytest.mark.asyncio
async def test_handle_collection_added(
    collection_handler: CollectionRelationshipHandler, mock_qdrant_service: MagicMock
):
    """Test handling ADDED action for collection relationship."""
    # Mock that summary currently has no collections
    mock_qdrant_service.get_collection_ids = AsyncMock(return_value=[])

    # Create test event
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.ADDED,
        memberCode="user123",
        teamCode="team456",
        timestamp=datetime.now(),
        addedCollectionIds=[100, 200, 300],
    )
    message = CollectionRelationshipMessage(type="collection:relationship", data=event)

    # Handle message
    result = await collection_handler.handle(message)

    # Verify success
    assert result is True

    # Verify get was called
    mock_qdrant_service.get_collection_ids.assert_called_once_with(12345)

    # Verify update was called with the added IDs
    mock_qdrant_service.update_collection_ids.assert_called_once_with(
        summary_id=12345,
        collection_ids=[100, 200, 300],
    )


@pytest.mark.asyncio
async def test_handle_collection_removed(
    collection_handler: CollectionRelationshipHandler, mock_qdrant_service: MagicMock
):
    """Test handling REMOVED action for collection relationship."""
    # Mock that summary currently has collections [100, 200, 300]
    mock_qdrant_service.get_collection_ids = AsyncMock(return_value=[100, 200, 300])

    # Create test event - removing collections 200 and 300
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.REMOVED,
        memberCode="user123",
        teamCode="team456",
        timestamp=datetime.now(),
        removedCollectionIds=[200, 300],
    )
    message = CollectionRelationshipMessage(type="collection:relationship", data=event)

    # Handle message
    result = await collection_handler.handle(message)

    # Verify success
    assert result is True

    # Verify Qdrant service was called with only 100 remaining
    mock_qdrant_service.update_collection_ids.assert_called_once_with(
        summary_id=12345,
        collection_ids=[100],
    )


@pytest.mark.asyncio
async def test_handle_collection_updated(
    collection_handler: CollectionRelationshipHandler, mock_qdrant_service: MagicMock
):
    """Test handling UPDATED action for collection relationship."""
    # Mock that summary currently has collections [100, 200]
    mock_qdrant_service.get_collection_ids = AsyncMock(return_value=[100, 200])

    # Create test event - adding 300, 400 and removing 100
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.UPDATED,
        memberCode="user123",
        teamCode="team456",
        timestamp=datetime.now(),
        addedCollectionIds=[300, 400],
        removedCollectionIds=[100],
    )
    message = CollectionRelationshipMessage(type="collection:relationship", data=event)

    # Handle message
    result = await collection_handler.handle(message)

    # Verify success
    assert result is True

    # Verify Qdrant service was called with [200, 300, 400]
    mock_qdrant_service.update_collection_ids.assert_called_once_with(
        summary_id=12345,
        collection_ids=[200, 300, 400],
    )


@pytest.mark.asyncio
async def test_handle_collection_added_with_error(
    collection_handler: CollectionRelationshipHandler, mock_qdrant_service: MagicMock
):
    """Test error handling during ADDED action."""
    # Mock initial state
    mock_qdrant_service.get_collection_ids = AsyncMock(return_value=[])
    # Make Qdrant service raise an error during update
    mock_qdrant_service.update_collection_ids = AsyncMock(side_effect=Exception("Update error"))

    # Create test event
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.ADDED,
        memberCode="user123",
        teamCode="team456",
        timestamp=datetime.now(),
        addedCollectionIds=[100, 200],
    )
    message = CollectionRelationshipMessage(type="collection:relationship", data=event)

    # Handle message
    result = await collection_handler.handle(message)

    # Verify failure
    assert result is False


@pytest.mark.asyncio
async def test_handle_collection_empty_result(
    collection_handler: CollectionRelationshipHandler, mock_qdrant_service: MagicMock
):
    """Test handling when removing all collections leaves an empty list."""
    # Mock that summary currently has one collection [100]
    mock_qdrant_service.get_collection_ids = AsyncMock(return_value=[100])

    # Create test event - removing collection 100, leaving empty
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.REMOVED,
        memberCode="user123",
        teamCode=None,
        timestamp=datetime.now(),
        removedCollectionIds=[100],
    )
    message = CollectionRelationshipMessage(type="collection:relationship", data=event)

    # Handle message
    result = await collection_handler.handle(message)

    # Verify success
    assert result is True

    # Verify Qdrant service was called with empty list
    mock_qdrant_service.update_collection_ids.assert_called_once_with(
        summary_id=12345,
        collection_ids=[],
    )
