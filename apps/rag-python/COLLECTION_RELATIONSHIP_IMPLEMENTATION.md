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
- `collection_ids` (list[int] | None): **Complete current state** of all collection IDs this summary belongs to
- `action` (CollectionRelationshipAction): The action type (informational)
- `member_code` (str): The member who owns the summary
- `team_code` (str | None): The team code (nullable for personal summaries)
- `timestamp` (datetime): Event timestamp

**Important**: `collection_ids` contains the **full state** (complete list of all collections), not incremental changes.

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
Handles collection relationship events with full-state updates.

**Important Design Note**: The Java backend sends **full-state updates** (complete current state) rather than delta updates:
- `collectionIds`: The complete list of ALL collections the summary currently belongs to
- This is the source of truth for consumers to avoid ordering issues

The handler:
1. Retrieves the current `collection_ids` from Qdrant (for logging purposes)
2. Replaces the existing state with the new complete state from the event
3. Updates all points (both parent and child chunks) with the new list

This approach ensures:
- **Idempotency**: Replaying the same message produces the same result
- **Ordering tolerance**: Later messages with newer timestamps override earlier state
- **Simplicity**: No need to compute deltas or handle partial updates

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
    "collectionIds": [100, 200, 300]
  }
}
```
*Full state: Summary now belongs to collections 100, 200, and 300*

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
    "collectionIds": [100]
  }
}
```
*Full state: Summary now belongs only to collection 100 (200 and 300 were removed)*

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
    "collectionIds": [200, 300, 400]
  }
}
```
*Full state: Summary now belongs to collections 200, 300, and 400*

### Field Mapping

Java (camelCase) → Python (snake_case):
- `summaryId` → `summary_id`
- `collectionIds` → `collection_ids`
- `memberCode` → `member_code`
- `teamCode` → `team_code`

Pydantic automatically handles both naming conventions via aliases.

## Processing Flow

1. **Message Reception**: SQS message received by worker
2. **Parsing**: JSON body parsed and validated against schema
3. **Routing**: Message type discriminator routes to appropriate handler
4. **Get Current State**: Handler fetches current `collection_ids` from Qdrant (for logging comparison)
5. **Replace State**: Handler uses the complete `collection_ids` list from the event as the new state
6. **Update**: Qdrant updates `collection_ids` metadata for all chunks (both parent and child)
7. **Acknowledgement**: Successfully processed messages deleted from SQS

## Metadata Updates

When a collection relationship event is received, the following happens:

1. **Retrieve**: One child chunk is queried to get current `collection_ids` list (for logging)
2. **Extract State**: The complete `collection_ids` list from the event becomes the new state
3. **Update**: All child chunks get updated with the new `collection_ids` list
4. **Update**: All parent chunks get updated with the new `collection_ids` list
5. **Search**: Future searches can now filter by collection membership using Qdrant filters

The update is atomic per summary - all chunks for that summary get the same new list, which is the complete state from the event.

## Usage Notes

### Action Types and Full-State Updates

The Java backend sends **full-state updates** (complete current state):

- **ADDED**: Summary was added to one or more collections
  - Contains `collectionIds`: **complete list** of all collections the summary now belongs to
  - Example: Summary now belongs to collections [100, 200, 300]

- **REMOVED**: Summary was removed from one or more collections
  - Contains `collectionIds`: **complete list** of all remaining collections
  - Example: Summary now belongs to collections [100] (after removing 200, 300)

- **UPDATED**: The collection list was updated (some added, some removed)
  - Contains `collectionIds`: **complete list** of all collections after the update
  - Example: Summary now belongs to [200, 300, 400]

✅ **Important**: `collectionIds` always contains the **complete current state**, not incremental changes. The Python handler:
1. Fetches current collection IDs from Qdrant (for logging comparison only)
2. Replaces the entire state with the `collectionIds` from the event
3. Stores the complete new state

This approach provides:
- **Simplicity**: No delta computation needed
- **Consistency**: Event is the single source of truth
- **Idempotency**: Replaying the same event produces the same result
- **Ordering tolerance**: Use timestamp to determine which state is newer

### Empty Collection Lists

- If `collectionIds` is `null` or empty `[]`, the summary belongs to no collections
- This is a valid state (e.g., when a summary is removed from all collections)
- The handler will update Qdrant to reflect this empty state

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
    private List<Long> collectionIds;  // Full state: all collections summary belongs to
    private String action;              // ADDED, REMOVED, or UPDATED
    private String memberCode;
    private String teamCode;
    private Date timestamp;
}
```

The message format is fully compatible with the Java backend's SQS message producer.

**Important**: The Java backend must send the **complete list** of collection IDs in the `collectionIds` field, not delta updates. This is the source of truth that the Python consumer uses to update Qdrant.

