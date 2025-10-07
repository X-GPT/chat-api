"""Event schemas for SQS messages."""

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


class SummaryAction(str, Enum):
    """Summary lifecycle actions."""

    CREATED = "CREATED"
    UPDATED = "UPDATED"
    DELETED = "DELETED"


class SummaryEvent(BaseModel):
    """Summary lifecycle event schema matching SummaryEventDTO from Java backend.

    Example event:
    ```json
    {
        "id": 12345,
        "memberCode": "user123",
        "teamCode": "team456",
        "parseContent": "This is the parsed summary content...",
        "action": "CREATED",
        "timestamp": "2025-10-01T12:30:45.123Z"
    }
    ```
    """

    id: int
    member_code: str = Field(..., alias="memberCode")
    team_code: str | None = Field(None, alias="teamCode")
    parse_content: str | None = Field(None, alias="parseContent")
    action: SummaryAction
    timestamp: datetime

    model_config = {
        "populate_by_name": True,  # Allow both alias and field name
        "json_schema_extra": {
            "examples": [
                {
                    "id": 12345,
                    "memberCode": "user123",
                    "teamCode": "team456",
                    "parseContent": "This is the parsed summary content...",
                    "action": "CREATED",
                    "timestamp": "2025-10-01T12:30:45.123Z",
                }
            ]
        },
    }


class SummaryLifecycleMessage(BaseModel):
    """SQS message wrapper for summary lifecycle events.

    Example SQS message body:
    ```json
    {
        "type": "summary:lifecycle",
        "data": {
            "id": 12345,
            "memberCode": "user123",
            "teamCode": "team456",
            "parseContent": "This is the parsed summary content...",
            "action": "CREATED",
            "timestamp": "2025-10-01T12:30:45.123Z"
        }
    }
    ```
    """

    type: Literal["summary:lifecycle"] = Field(..., description="Message type discriminator")
    data: SummaryEvent


# Add more message types here as needed
# class FileIngestMessage(BaseModel):
#     type: Literal["ingest:file"]
#     data: FileIngestEvent


# Union type for all SQS messages (discriminated by 'type' field)
# Will become Union[SummaryLifecycleMessage, ...] as more types are added
SQSMessage = SummaryLifecycleMessage


class SQSMessageMetadata(BaseModel):
    """Metadata about an SQS message."""

    message_id: str
    receipt_handle: str
    approximate_receive_count: int = 0
    sent_timestamp: datetime | None = None
