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


class CollectionRelationshipAction(str, Enum):
    """Collection relationship actions."""

    ADDED = "ADDED"
    REMOVED = "REMOVED"
    UPDATED = "UPDATED"


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


class CollectionRelationshipEvent(BaseModel):
    """Collection relationship event schema.

    Matches CollectionRelationshipEventDTO from Java backend.
    Uses delta updates (incremental changes) rather than full state.

    Example events:
    ```json
    // ADDED action
    {
        "summaryId": 12345,
        "action": "ADDED",
        "memberCode": "user123",
        "teamCode": "team456",
        "timestamp": "2025-10-10T10:30:45.123Z",
        "addedCollectionIds": [100, 200]
    }

    // REMOVED action
    {
        "summaryId": 12345,
        "action": "REMOVED",
        "memberCode": "user123",
        "teamCode": "team456",
        "timestamp": "2025-10-10T10:30:45.123Z",
        "removedCollectionIds": [100]
    }

    // UPDATED action
    {
        "summaryId": 12345,
        "action": "UPDATED",
        "memberCode": "user123",
        "teamCode": "team456",
        "timestamp": "2025-10-10T10:30:45.123Z",
        "addedCollectionIds": [300, 400],
        "removedCollectionIds": [100]
    }
    ```
    """

    summary_id: int = Field(..., alias="summaryId")
    action: CollectionRelationshipAction
    member_code: str = Field(..., alias="memberCode")
    team_code: str | None = Field(None, alias="teamCode")
    timestamp: datetime
    added_collection_ids: list[int] | None = Field(None, alias="addedCollectionIds")
    removed_collection_ids: list[int] | None = Field(None, alias="removedCollectionIds")

    model_config = {
        "populate_by_name": True,  # Allow both alias and field name
        "json_schema_extra": {
            "examples": [
                {
                    "summaryId": 12345,
                    "action": "ADDED",
                    "memberCode": "user123",
                    "teamCode": "team456",
                    "timestamp": "2025-10-10T10:30:45.123Z",
                    "addedCollectionIds": [100, 200],
                },
                {
                    "summaryId": 12345,
                    "action": "REMOVED",
                    "memberCode": "user123",
                    "teamCode": "team456",
                    "timestamp": "2025-10-10T10:30:45.123Z",
                    "removedCollectionIds": [100],
                },
                {
                    "summaryId": 12345,
                    "action": "UPDATED",
                    "memberCode": "user123",
                    "teamCode": "team456",
                    "timestamp": "2025-10-10T10:30:45.123Z",
                    "addedCollectionIds": [300, 400],
                    "removedCollectionIds": [100],
                },
            ]
        },
    }


class CollectionRelationshipMessage(BaseModel):
    """SQS message wrapper for collection relationship events.

    Example SQS message body:
    ```json
    {
        "type": "collection:relationship",
        "data": {
            "summaryId": 12345,
            "collectionIds": [100, 200, 300],
            "action": "ADDED",
            "memberCode": "user123",
            "teamCode": "team456",
            "timestamp": "2025-10-10T10:30:45.123Z"
        }
    }
    ```
    """

    type: Literal["collection:relationship"] = Field(..., description="Message type discriminator")
    data: CollectionRelationshipEvent


# Add more message types here as needed
# class FileIngestMessage(BaseModel):
#     type: Literal["ingest:file"]
#     data: FileIngestEvent


# Union type for all SQS messages (discriminated by 'type' field)
SQSMessage = SummaryLifecycleMessage | CollectionRelationshipMessage


class SQSMessageMetadata(BaseModel):
    """Metadata about an SQS message."""

    message_id: str
    receipt_handle: str
    approximate_receive_count: int = 0
    sent_timestamp: datetime | None = None
