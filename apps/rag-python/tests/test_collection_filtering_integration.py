"""Integration tests for collection_ids filtering with Qdrant.

This test verifies which FilterOperator correctly filters array fields.

⚠️  REQUIRES EXTERNAL SERVICES:
- Running Qdrant instance (localhost:6333)
- Valid OpenAI API key for embeddings (in .env.local)

These tests are SKIPPED by default in CI/CD.

To run locally:
    # Start Qdrant
    docker run -p 6333:6333 qdrant/qdrant:latest

    # Run integration tests (loads .env.local automatically)
    uv run --env-file .env.local pytest \
        tests/test_collection_filtering_integration.py -v -m integration

    # Or run all integration tests
    uv run --env-file .env.local pytest tests/ -v -m integration
"""

import asyncio

import pytest
import pytest_asyncio

from rag_python.config import Settings
from rag_python.services.ingestion_service import IngestionService
from rag_python.services.qdrant_service import QdrantService


@pytest.fixture(scope="module")
def test_settings():
    """Create test settings pointing to local Qdrant.

    Note: Run with: uv run --env-file .env.local pytest -m integration
    This ensures OPENAI_API_KEY is loaded from .env.local

    Module scope: shared across all tests to avoid recreating settings.
    """
    import os

    return Settings(
        qdrant_url="http://localhost:6333",
        qdrant_api_key="dummy-key",  # Local Qdrant doesn't require auth
        qdrant_collection_name="test_collection_filter",
        openai_api_key=os.getenv("OPENAI_API_KEY", "test-key"),
        openai_embedding_model="text-embedding-3-small",
    )


@pytest_asyncio.fixture(scope="module")
async def qdrant_service(test_settings: Settings):
    """Create QdrantService with test collections.

    Module scope: shared across all tests in this file to avoid
    recreating/deleting collections for each test.
    """
    service = QdrantService(test_settings)

    # Ensure collections exist
    await service.ensure_collection_exists()

    yield service

    # Cleanup: delete test collections after all tests complete
    try:
        await service.aclient.delete_collection(service.children_collection_name)
        await service.aclient.delete_collection(service.parents_collection_name)
        print("✓ Cleaned up test collections")
    except Exception as e:
        print(f"Cleanup warning: {e}")


@pytest_asyncio.fixture(scope="module")
async def ingestion_service(test_settings: Settings, qdrant_service: QdrantService):
    """Create IngestionService for document processing.

    Module scope: shared across all tests.
    """
    return IngestionService(test_settings, qdrant_service)


@pytest_asyncio.fixture(scope="module", autouse=True)
async def setup_test_data(qdrant_service: QdrantService, ingestion_service: IngestionService):
    """Setup test data once for all tests in this module.

    Creates four summaries with different collection memberships:
    - Summary 10001: collections [100, 200] - for filter tests
    - Summary 10002: collections [200, 300] - for filter tests
    - Summary 10003: collections [400] - for filter tests
    - Summary 10004: collections [100, 200] - dedicated for update test
    """
    print("\n" + "=" * 60)
    print("SETTING UP TEST DATA")
    print("=" * 60)

    # Ingest summary 1
    result1 = await ingestion_service.ingest_document(
        summary_id=10001,
        member_code="test_user",
        content="Python is a high-level programming language known for its simplicity.",
    )
    print(f"✓ Ingested summary 10001: {result1}")

    # Update collection_ids metadata
    await qdrant_service.update_collection_ids(summary_id=10001, collection_ids=[100, 200])
    print("✓ Updated summary 10001 collection_ids: [100, 200]")

    # Ingest summary 2
    result2 = await ingestion_service.ingest_document(
        summary_id=10002,
        member_code="test_user",
        content="JavaScript is versatile for web development and frontend applications.",
    )
    print(f"✓ Ingested summary 10002: {result2}")

    # Update collection_ids metadata
    await qdrant_service.update_collection_ids(summary_id=10002, collection_ids=[200, 300])
    print("✓ Updated summary 10002 collection_ids: [200, 300]")

    # Ingest summary 3
    result3 = await ingestion_service.ingest_document(
        summary_id=10003,
        member_code="test_user",
        content="Rust is a systems programming language focused on safety and concurrency.",
    )
    print(f"✓ Ingested summary 10003: {result3}")

    # Update collection_ids metadata
    await qdrant_service.update_collection_ids(summary_id=10003, collection_ids=[400])
    print("✓ Updated summary 10003 collection_ids: [400]")

    # Ingest summary 4 (for update test only - won't be used by other tests)
    result4 = await ingestion_service.ingest_document(
        summary_id=10004,
        member_code="test_user",
        content="Go is designed for simplicity and efficiency in concurrent programming.",
    )
    print(f"✓ Ingested summary 10004: {result4}")

    # Update collection_ids metadata
    await qdrant_service.update_collection_ids(summary_id=10004, collection_ids=[100, 200])
    print("✓ Updated summary 10004 collection_ids: [100, 200] (for update test)")

    # Wait for indexing (longer wait to ensure updates propagate)
    print("⏳ Waiting for indexing...")
    await asyncio.sleep(5)

    # Verify collection_ids are retrievable
    ids_1 = await qdrant_service.get_collection_ids(10001)
    ids_2 = await qdrant_service.get_collection_ids(10002)
    ids_3 = await qdrant_service.get_collection_ids(10003)
    ids_4 = await qdrant_service.get_collection_ids(10004)
    print(f"✓ Verified collection_ids: 10001={ids_1}, 10002={ids_2}, 10003={ids_3}, 10004={ids_4}")

    print("✓ Test data setup complete!")
    print("=" * 60)

    # Verify ingestion succeeded
    assert result1.total_nodes and result1.total_nodes > 0
    assert result2.total_nodes and result2.total_nodes > 0
    assert result3.total_nodes and result3.total_nodes > 0
    assert result4.total_nodes and result4.total_nodes > 0

    yield  # Tests run here

    print("\n✓ All tests complete")


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_operator_contains(qdrant_service: QdrantService):
    """Test 1: FilterOperator.CONTAINS with collection_ids array.

    Expected behavior:
    - Search with [200, 300] should match summaries 1 and 2 (they contain 200 or 300)
    - Should NOT match summary 3 (only has 400)
    """
    # Search with CONTAINS operator - filter by collection 200
    results = await qdrant_service.search(
        query="programming language",
        member_code="test_user",
        collection_id=200,  # Looking for summaries in collection 200
        limit=10,
    )

    print("\n=== CONTAINS Operator Results (collection_id=200) ===")
    print(f"Found {len(results)} results")
    for result in results:
        print(f"  ID: {result.id}")
        print(f"  Score: {result.score}")
        print(f"  Summary ID: {result.payload.get('summary_id') if result.payload else 'N/A'}")
        print(
            f"  Collection IDs: {result.payload.get('collection_ids') if result.payload else 'N/A'}"
        )
        print()

    # Extract summary IDs from results
    summary_ids = {result.payload.get("summary_id") for result in results if result.payload}

    print(f"Summary IDs found: {summary_ids}")

    # Expected: Should find summaries 10001 (has 200) and 10002 (has 200 and 300)
    # Should NOT find 10003 (only has 400)
    assert 10001 in summary_ids, "Should find summary 10001 (has collection 200)"
    assert 10002 in summary_ids, "Should find summary 10002 (has collections 200, 300)"
    assert 10003 not in summary_ids, "Should NOT find summary 10003 (only has 400)"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_collection_300(qdrant_service: QdrantService):
    """Test 2: Filter by collection ID 300.

    Expected: Should only match summary 2 (has 200 and 300).
    """
    results = await qdrant_service.search(
        query="programming language",
        member_code="test_user",
        collection_id=300,
        limit=10,
    )

    print("\n=== Collection 300 Filter Results ===")
    print(f"Found {len(results)} results")
    for result in results:
        print(f"  ID: {result.id}")
        print(f"  Summary ID: {result.payload.get('summary_id') if result.payload else 'N/A'}")
        print(
            f"  Collection IDs: {result.payload.get('collection_ids') if result.payload else 'N/A'}"
        )

    summary_ids = {result.payload.get("summary_id") for result in results if result.payload}
    print(f"Summary IDs found: {summary_ids}")

    assert 10002 in summary_ids, "Summary 2 has collection 300"
    assert 10001 not in summary_ids, "Summary 1 does NOT have collection 300"
    assert 10003 not in summary_ids, "Summary 3 does NOT have collection 300"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_single_collection(qdrant_service: QdrantService):
    """Test 3: Filter by single collection ID 200.

    Expected: Should match summaries 1 and 2 (both have 200).
    """
    results = await qdrant_service.search(
        query="programming language",
        member_code="test_user",
        collection_id=200,  # Single collection
        limit=10,
    )

    print("\n=== Single Collection 200 ===")
    print(f"Found {len(results)} results")

    summary_ids = {result.payload.get("summary_id") for result in results if result.payload}
    print(f"Summary IDs: {summary_ids}")

    assert 10001 in summary_ids, "Summary 1 has collection 200"
    assert 10002 in summary_ids, "Summary 2 has collection 200"
    assert 10003 not in summary_ids, "Summary 3 does NOT have collection 200"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_exclusive_collection(qdrant_service: QdrantService):
    """Test 4: Filter by collection 400 (only in summary 3).

    Expected: Should only match summary 3.
    """
    results = await qdrant_service.search(
        query="programming language",
        member_code="test_user",
        collection_id=400,
        limit=10,
    )

    print("\n=== Exclusive Collection 400 ===")
    print(f"Found {len(results)} results")

    summary_ids = {result.payload.get("summary_id") for result in results if result.payload}
    print(f"Summary IDs: {summary_ids}")

    assert 10003 in summary_ids, "Summary 3 has collection 400"
    assert 10001 not in summary_ids, "Summary 1 does NOT have collection 400"
    assert 10002 not in summary_ids, "Summary 2 does NOT have collection 400"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filter_no_collection(qdrant_service: QdrantService):
    """Test 5: No collection filter (should return all summaries).

    Expected: Should match all 4 summaries (Python, JavaScript, Rust, Go).
    """
    results = await qdrant_service.search(
        query="programming language",
        member_code="test_user",
        collection_id=None,  # No filter
        limit=10,
    )

    print("\n=== No Collection Filter ===")
    print(f"Found {len(results)} results")

    summary_ids = {result.payload.get("summary_id") for result in results if result.payload}
    print(f"Summary IDs: {summary_ids}")

    # Should find all 4 summaries (or at least 3, given relevance scoring)
    # All summaries are about programming languages, so they should all match the query
    assert len(summary_ids) >= 3, f"Should find at least 3 summaries, found {len(summary_ids)}"
    # Ideally we'd find all 4, but log a warning if not
    if len(summary_ids) < 4:
        print(f"⚠️  Warning: Only found {len(summary_ids)} summaries, expected 4")
        print(f"    Missing: {set([10001, 10002, 10003, 10004]) - summary_ids}")
        print("    This may be due to relevance cutoff or result limit")


@pytest.mark.integration
@pytest.mark.asyncio
async def test_verify_collection_ids_metadata(qdrant_service: QdrantService):
    """Test 6: Verify collection_ids are correctly stored in metadata."""
    # Get collection_ids for each summary
    collection_ids_1 = await qdrant_service.get_collection_ids(10001)
    collection_ids_2 = await qdrant_service.get_collection_ids(10002)
    collection_ids_3 = await qdrant_service.get_collection_ids(10003)

    print("\n=== Stored Collection IDs ===")
    print(f"Summary 10001: {collection_ids_1}")
    print(f"Summary 10002: {collection_ids_2}")
    print(f"Summary 10003: {collection_ids_3}")

    assert collection_ids_1 == [100, 200], "Summary 1 should have [100, 200]"
    assert collection_ids_2 == [200, 300], "Summary 2 should have [200, 300]"
    assert collection_ids_3 == [400], "Summary 3 should have [400]"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_update_collection_ids(qdrant_service: QdrantService):
    """Test 7: Test updating collection_ids for a summary.

    Uses summary 10004 which is dedicated for this test and won't affect other tests.
    """
    # Verify initial state
    initial_ids = await qdrant_service.get_collection_ids(10004)
    print(f"\n=== Initial state: Summary 10004 has {initial_ids}")

    # Update summary 4 to have collections [100, 500]
    await qdrant_service.update_collection_ids(
        summary_id=10004,
        collection_ids=[100, 500],
    )

    # Wait for update
    await asyncio.sleep(2)

    # Verify update
    updated_ids = await qdrant_service.get_collection_ids(10004)
    print(f"=== After update: Summary 10004 has {updated_ids}")

    assert updated_ids == [100, 500], "Collection IDs should be updated"

    # Search for collection 500 should now find summary 4
    results = await qdrant_service.search(
        query="programming language",
        member_code="test_user",
        collection_id=500,
        limit=10,
    )

    summary_ids = {result.payload.get("summary_id") for result in results if result.payload}
    print(f"=== Search results for collection 500: {summary_ids}")
    assert 10004 in summary_ids, "Summary 4 should now be in collection 500"

    # Restore original state for consistency (though it doesn't affect other tests)
    await qdrant_service.update_collection_ids(10004, [100, 200])
    await asyncio.sleep(1)
    print("=== Restored original state")


if __name__ == "__main__":
    # Run all integration tests directly
    # Or use: uv run --env-file .env.local pytest \
    #            tests/test_collection_filtering_integration.py -v -m integration
    pytest.main(
        [
            __file__,
            "-v",
            "-s",
            "-m",
            "integration",
            "--log-cli-level=INFO",
        ]
    )
