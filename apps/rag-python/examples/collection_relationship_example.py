"""Example script demonstrating collection:relationship message handling.

This script shows how to create and validate collection relationship events.
"""

import json
from datetime import datetime

from rag_python.schemas.events import (
    CollectionRelationshipAction,
    CollectionRelationshipEvent,
    CollectionRelationshipMessage,
)


def example_added_event():
    """Example: Collections added to a summary."""
    print("\n=== Example 1: Collections ADDED to Summary ===")
    print("Summary now belongs to collections 100 and 200")

    # Create event with full state
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.ADDED,
        memberCode="user123",
        teamCode="team456",
        timestamp=datetime.now(),
        collectionIds=[100, 200],  # Full state: ALL collections summary belongs to
    )

    # Wrap in message
    message = CollectionRelationshipMessage(type="collection:relationship", data=event)

    # Convert to JSON (simulating SQS message)
    json_data = message.model_dump(mode="json", by_alias=True)
    print("Message JSON:")
    print(json.dumps(json_data, indent=2, default=str))

    return message


def example_removed_event():
    """Example: Collections removed from a summary."""
    print("\n=== Example 2: Collections REMOVED from Summary ===")
    print("Summary now belongs to collection 100 only (200 and 300 were removed)")

    # Create event with full state
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.REMOVED,
        memberCode="user123",
        teamCode="team456",
        timestamp=datetime.now(),
        collectionIds=[100],  # Full state: only 100 remains after removal
    )

    # Wrap in message
    message = CollectionRelationshipMessage(type="collection:relationship", data=event)

    # Convert to JSON
    json_data = message.model_dump(mode="json", by_alias=True)
    print("Message JSON:")
    print(json.dumps(json_data, indent=2, default=str))

    return message


def example_updated_event():
    """Example: Collections updated for a summary."""
    print("\n=== Example 3: Collections UPDATED for Summary ===")
    print("Summary now belongs to collections 200, 300, and 400")

    # Create event with full state
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.UPDATED,
        memberCode="user123",
        teamCode=None,  # Personal summary, no team
        timestamp=datetime.now(),
        collectionIds=[200, 300, 400],  # Full state after update
    )

    # Wrap in message
    message = CollectionRelationshipMessage(type="collection:relationship", data=event)

    # Convert to JSON
    json_data = message.model_dump(mode="json", by_alias=True)
    print("Message JSON:")
    print(json.dumps(json_data, indent=2, default=str))

    return message


def example_parse_from_json():
    """Example: Parse from JSON (simulating receiving SQS message)."""
    print("\n=== Example 4: Parse from JSON ===")

    # Simulated SQS message body (full-state format)
    sqs_body = {
        "type": "collection:relationship",
        "data": {
            "summaryId": 99999,
            "action": "UPDATED",
            "memberCode": "john_doe",
            "teamCode": "engineering",
            "timestamp": "2025-10-10T10:30:45.123Z",
            "collectionIds": [111, 222, 444],  # Full state: all collections
        },
    }

    print("Raw JSON:")
    print(json.dumps(sqs_body, indent=2))

    # Parse and validate
    message = CollectionRelationshipMessage(**sqs_body)

    print("\nParsed message:")
    print(f"  Type: {message.type}")
    print(f"  Summary ID: {message.data.summary_id}")
    print(f"  Action: {message.data.action.value}")
    print(f"  Collection IDs (full state): {message.data.collection_ids}")
    print(f"  Member: {message.data.member_code}")
    print(f"  Team: {message.data.team_code}")
    print(f"  Timestamp: {message.data.timestamp}")

    return message


if __name__ == "__main__":
    print("=" * 60)
    print("Collection Relationship Event Examples")
    print("=" * 60)

    # Run examples
    example_added_event()
    example_removed_event()
    example_updated_event()
    example_parse_from_json()

    print("\n" + "=" * 60)
    print("All examples completed successfully!")
    print("=" * 60)
