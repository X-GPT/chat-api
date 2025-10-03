"""Event schemas for SQS messages."""

from datetime import datetime
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field


class EventType(str, Enum):
    """Available event types."""

    HELLO = "hello"
    TASK_CREATED = "task.created"
    TASK_COMPLETED = "task.completed"
    # Add more event types as needed


class BaseEvent(BaseModel):
    """Base event schema that all events should inherit from."""

    event_type: EventType = Field(..., description="Type of the event")
    event_id: str = Field(..., description="Unique event identifier")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="Event timestamp")
    payload: dict[str, Any] = Field(default_factory=dict, description="Event payload data")

    model_config = {
        "json_schema_extra": {
            "examples": [
                {
                    "event_type": "hello",
                    "event_id": "evt_123456",
                    "timestamp": "2024-01-01T00:00:00Z",
                    "payload": {"message": "Hello from SQS"},
                }
            ]
        }
    }


class HelloEvent(BaseEvent):
    """Hello event for testing."""

    event_type: EventType = Field(default=EventType.HELLO, description="Event type")
    payload: dict[str, str] = Field(..., description="Hello message payload")


class SQSMessageMetadata(BaseModel):
    """Metadata about an SQS message."""

    message_id: str
    receipt_handle: str
    approximate_receive_count: int = 0
    sent_timestamp: datetime | None = None
