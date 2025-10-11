# Collection Relationship Event Implementation

## Overview

This document describes the implementation of the new `collection:relationship` message type in the RAG Python worker. This message type handles changes to summary-collection relationships.

## Changes Made

### 1. Event Schemas (`src/rag_python/schemas/events.py`)

Added three new classes to support collection relationship events:

#### `CollectionRelationshipAction` (Enum)
- `ADDED`: Collections were added to a summary
- `REMOVED`: Collections were removed from a summary
- `UPDATED`: The collection list for a summary was updated

#### `CollectionRelationshipEvent` (BaseModel)
Matches the Java `CollectionRelationshipEventDTO` with the following fields:
- `summary_id` (int): The summary ID
- `collection_ids` (list[int]): List of collection IDs
- `action` (CollectionRelationshipAction): The action type
- `member_code` (str): The member who owns the summary
- `team_code` (str | None): The team code (nullable for personal summaries)
- `timestamp` (datetime): Event timestamp

#### `CollectionRelationshipMessage` (BaseModel)
SQS message wrapper with:
- `type`: Literal type `"collection:relationship"`
- `data`: The `CollectionRelationshipEvent`

#### Updated `SQSMessage` Union Type
Changed from a single type to a union:
```python
SQSMessage = SummaryLifecycleMessage | CollectionRelationshipMessage
```

### 2. Qdrant Service (`src/rag_python/services/qdrant_service.py`)

Added two new methods:

#### `get_collection_ids(summary_id: int) -> list[int]`
Retrieves the current `collection_ids` for a summary from Qdrant.

**Implementation details:**
- Uses Qdrant's `scroll` method to fetch one point
- Queries the children collection (any chunk will have the same collection_ids)
- Extracts and validates the `collection_ids` field from payload
- Returns empty list if summary not found or on error
- Includes robust type checking and error handling

#### `update_collection_ids(summary_id: int, collection_ids: list[int])`
Updates the `collection_ids` metadata field for all points (both parent and child chunks) associated with a given summary ID in Qdrant.

**Implementation details:**
- Uses Qdrant's `set_payload` method with filters
- Updates both children and parents collections
- Uses `FieldCondition` to filter by `summary_id`
- Includes error handling and logging

#### Payload Indexes
Created indexes on `collection_ids` field (integer array) for efficient filtering:
- Index created on both children and parents collections
- Allows fast filtering of search results by collection membership
- Automatically created during collection initialization

### 3. Message Handlers (`src/rag_python/worker/handlers.py`)

#### `CollectionRelationshipHandler` (New Class)
Handles collection relationship events with delta updates.

**Important Design Note**: The Java backend sends **delta updates** (incremental changes) rather than the complete state:
- `addedCollectionIds`: Collections that were added
- `removedCollectionIds`: Collections that were removed

The handler:
1. Retrieves the current `collection_ids` from Qdrant
2. Applies the delta (adds and/or removes IDs)
3. Updates all points with the new complete list

This ensures consistency even if messages arrive out of order or duplicated.

#### Updated `MessageHandlerRegistry`
- Added `qdrant_service` parameter to constructor
- Registered the new handler: `"collection:relationship": CollectionRelationshipHandler(qdrant_service)`

### 4. Message Processor (`src/rag_python/worker/processor.py`)

#### Updated Constructor
- Now passes both `rag_service` and `qdrant_service` to `MessageHandlerRegistry`

#### Updated `_validate_and_parse_message()`
Enhanced to support multiple message types:
- Checks the `type` field in the message body
- Routes to appropriate message class based on type:
  - `"summary:lifecycle"` → `SummaryLifecycleMessage`
  - `"collection:relationship"` → `CollectionRelationshipMessage`
- Returns `None` for unknown message types

### 5. Tests (`tests/test_handlers_integration.py`)

Added comprehensive test coverage for the new handler:

- `test_handle_collection_added`: Tests ADDED action
- `test_handle_collection_removed`: Tests REMOVED action
- `test_handle_collection_updated`: Tests UPDATED action
- `test_handle_collection_added_with_error`: Tests error handling
- `test_handle_collection_empty_list`: Tests handling empty collection lists

All tests use mocked `QdrantService` to verify correct method calls.

### 6. Example Script (`examples/collection_relationship_example.py`)

Created a demonstration script showing:
- How to create collection relationship events
- JSON serialization (simulating SQS messages)
- JSON deserialization and validation
- All three action types (ADDED, REMOVED, UPDATED)

## Message Format

### Example SQS Message Bodies

#### ADDED Action
```json
{
  "type": "collection:relationship",
  "data": {
    "summaryId": 12345,
    "action": "ADDED",
    "memberCode": "user123",
    "teamCode": "team456",
    "timestamp": "2025-10-10T10:30:45.123Z",
    "addedCollectionIds": [100, 200]
  }
}
```

#### REMOVED Action
```json
{
  "type": "collection:relationship",
  "data": {
    "summaryId": 12345,
    "action": "REMOVED",
    "memberCode": "user123",
    "teamCode": "team456",
    "timestamp": "2025-10-10T10:30:45.123Z",
    "removedCollectionIds": [200, 300]
  }
}
```

#### UPDATED Action
```json
{
  "type": "collection:relationship",
  "data": {
    "summaryId": 12345,
    "action": "UPDATED",
    "memberCode": "user123",
    "teamCode": "team456",
    "timestamp": "2025-10-10T10:30:45.123Z",
    "addedCollectionIds": [300, 400],
    "removedCollectionIds": [100]
  }
}
```

### Field Mapping

Java (camelCase) → Python (snake_case):
- `summaryId` → `summary_id`
- `addedCollectionIds` → `added_collection_ids`
- `removedCollectionIds` → `removed_collection_ids`
- `memberCode` → `member_code`
- `teamCode` → `team_code`

Pydantic automatically handles both naming conventions via aliases.

## Processing Flow

1. **Message Reception**: SQS message received by worker
2. **Parsing**: JSON body parsed and validated against schema
3. **Routing**: Message type discriminator routes to appropriate handler
4. **Get Current State**: Handler fetches current `collection_ids` from Qdrant
5. **Apply Delta**: Handler applies additions and removals to create new state
6. **Update**: Qdrant updates `collection_ids` metadata for all chunks
7. **Acknowledgement**: Successfully processed messages deleted from SQS

## Metadata Updates

When a collection relationship changes, the following happens:

1. **Retrieve**: One child chunk is queried to get current `collection_ids` list
2. **Compute**: Delta changes are applied (set operations: add/remove)
3. **Update**: All parent chunks get updated with new `collection_ids` list
4. **Update**: All child chunks get updated with new `collection_ids` list
5. **Search**: Future searches can now filter by collection membership using Qdrant filters

The update is atomic per summary - all chunks for that summary get the same new list.

## Usage Notes

### Action Types and Delta Updates

The Java backend sends **delta updates** (incremental changes):

- **ADDED**: Summary was added to one or more collections
  - Contains `addedCollectionIds`: list of collection IDs the summary was added to
  - Example: Summary was added to collections [100, 200]

- **REMOVED**: Summary was removed from one or more collections
  - Contains `removedCollectionIds`: list of collection IDs the summary was removed from
  - Example: Summary was removed from collections [200, 300]

- **UPDATED**: Both additions and removals occurred
  - Contains both `addedCollectionIds` and `removedCollectionIds`
  - Example: Summary was added to [300, 400] and removed from [100]

⚠️ **Important**: These are **incremental changes**, not the complete state. The Python handler:
1. Fetches current collection IDs from Qdrant
2. Applies the delta (adds + removes)
3. Stores the complete new state

This approach handles:
- Out-of-order message delivery (delta operations are idempotent)
- Message replay/duplication (adding an already-added ID is safe)
- Partial failures (each message is self-contained)

### Empty Delta Fields

- If `addedCollectionIds` is `null` or empty, no collections are added
- If `removedCollectionIds` is `null` or empty, no collections are removed
- If both are `null`/empty, the operation is a no-op (but still logged)

### Personal vs Team Summaries

- Personal summaries: `teamCode` should be `null`
- Team summaries: `teamCode` should contain the team identifier

## Testing

Run tests with:
```bash
cd apps/rag-python
uv run pytest tests/test_handlers_integration.py -v
```

Run example script:
```bash
cd apps/rag-python
uv run examples/collection_relationship_example.py
```

## Related Files

- `src/rag_python/schemas/events.py` - Event schemas
- `src/rag_python/services/qdrant_service.py` - Qdrant database operations
- `src/rag_python/worker/handlers.py` - Message handlers
- `src/rag_python/worker/processor.py` - Message processing logic
- `tests/test_handlers_integration.py` - Integration tests
- `examples/collection_relationship_example.py` - Usage examples

## Usage: Filtering Searches by Collection

The `collection_ids` field can be used to filter search results by collection membership:

### QdrantService

```python
# Search within specific collections
results = await qdrant_service.search(
    query="machine learning",
    member_code="user123",
    collection_ids=[100, 200],  # Only return results from collections 100 or 200
    limit=10
)
```

### SearchService

```python
# Aggregate search with collection filtering
response = await search_service.search(
    query="machine learning",
    member_code="user123",
    collection_ids=[100, 200],  # Only return results from collections 100 or 200
    limit=10
)
```

### How It Works

- Uses `FilterOperator.CONTAINS` to match ANY of the specified collection IDs
- A summary belongs to multiple collections if its `collection_ids` array contains multiple values
- The filter matches if any collection ID in the array matches any ID in the filter list
- Combined with other filters (member_code, summary_id) using AND condition

### Example Scenarios

1. **Single Collection**: `collection_ids=[100]` - Returns summaries in collection 100
2. **Multiple Collections**: `collection_ids=[100, 200, 300]` - Returns summaries in any of these collections
3. **No Filter**: `collection_ids=None` - Returns all summaries (no collection filter)

## Future Enhancements

Potential improvements for consideration:

1. **Batch Updates**: If multiple collection relationship changes arrive, could batch the Qdrant updates
2. **Metrics**: Add metrics/monitoring for collection relationship updates
3. **Validation**: Add validation to ensure referenced summary actually exists in Qdrant
4. **Collection Exclusion**: Support filtering OUT specific collections (NOT IN operator)

## Java Backend Integration

This implementation is designed to work with the Java `CollectionRelationshipEventDTO`:

```java
public class CollectionRelationshipEventDTO {
    private Long summaryId;
    private List<Long> collectionIds;
    private String action;
    private String memberCode;
    private String teamCode;
    private Date timestamp;
}
```

The message format is fully compatible with the Java backend's SQS message producer.

