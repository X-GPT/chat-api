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
    print("Summary was added to collections 100 and 200")

    # Create event
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.ADDED,
        memberCode="user123",
        teamCode="team456",
        timestamp=datetime.now(),
        addedCollectionIds=[100, 200],
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
    print("Summary was removed from collections 200 and 300")

    # Create event
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.REMOVED,
        memberCode="user123",
        teamCode="team456",
        timestamp=datetime.now(),
        removedCollectionIds=[200, 300],
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
    print("Summary was added to collections 300, 400 and removed from collection 100")

    # Create event
    event = CollectionRelationshipEvent(
        summaryId=12345,
        action=CollectionRelationshipAction.UPDATED,
        memberCode="user123",
        teamCode=None,  # Personal summary, no team
        timestamp=datetime.now(),
        addedCollectionIds=[300, 400],
        removedCollectionIds=[100],
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

    # Simulated SQS message body
    sqs_body = {
        "type": "collection:relationship",
        "data": {
            "summaryId": 99999,
            "action": "UPDATED",
            "memberCode": "john_doe",
            "teamCode": "engineering",
            "timestamp": "2025-10-10T10:30:45.123Z",
            "addedCollectionIds": [111, 222],
            "removedCollectionIds": [333],
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
    print(f"  Added Collection IDs: {message.data.added_collection_ids}")
    print(f"  Removed Collection IDs: {message.data.removed_collection_ids}")
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
