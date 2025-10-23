"""Tests for the vector repository."""

from __future__ import annotations

import pytest

from rag_python.core.models import Parent  # noqa: E402
from rag_python.repositories.vector_repository import VectorRepository  # noqa: E402
from rag_python.services.qdrant_service import QdrantService  # noqa: E402

pytestmark = pytest.mark.asyncio


@pytest.fixture
def repo(qdrant_service: QdrantService) -> VectorRepository:
    return VectorRepository(qdrant_service)


async def test_upsert_parents_and_get_parents(repo: VectorRepository) -> None:
    parents = [
        Parent(
            id="00000000-0000-0000-0000-000000000001",
            summary_id=101,
            parent_idx=0,
            text="Parent text-1",
            checksum="abc123",
            collection_ids=[1, 2],
            member_code="tenant-test",
        ),
        Parent(
            id="00000000-0000-0000-0000-000000000002",
            summary_id=102,
            parent_idx=0,
            text="Parent text-2",
            checksum="def456",
            collection_ids=[3, 4],
            member_code="tenant-test",
        ),
    ]

    await repo.upsert_parents(parents)

    # Act: fetch in reverse order to ensure order-restoration
    got = await repo.get_parents([
        "00000000-0000-0000-0000-000000000002",
        "00000000-0000-0000-0000-000000000001",
    ])

    # Assert: order and fields
    assert [g.id for g in got] == [
        "00000000-0000-0000-0000-000000000002",
        "00000000-0000-0000-0000-000000000001",
    ]
    assert got[0].summary_id == 102 and got[0].checksum == "def456"
    assert got[1].summary_id == 101 and got[1].checksum == "abc123"


async def test_get_existing_checksum(repo: VectorRepository) -> None:
    # Arrange
    p = Parent(
        id="00000000-0000-0000-0000-000000000003",
        summary_id=4242,
        parent_idx=0,
        text="text-4242",
        checksum="check-4242",
        collection_ids=[9],
        member_code="tenant-test",
    )
    await repo.upsert_parents([p])

    # Act
    ck = await repo.get_existing_checksum(4242)

    # Assert
    assert ck == "check-4242"


async def test_delete_summary_tree_filters_on_summary_id(
    repo: VectorRepository, qdrant_service: QdrantService
) -> None:
    # Arrange: two points under same summary_id
    pts: list[Parent] = [
        Parent(
            id="00000000-0000-0000-0000-000000000004",
            summary_id=777,
            parent_idx=0,
            text="text-777",
            checksum="d1",
            collection_ids=[1, 2],
            member_code="tenant-test",
        ),
        Parent(
            id="00000000-0000-0000-0000-000000000005",
            summary_id=777,
            parent_idx=0,
            text="text-777",
            checksum="d2",
            collection_ids=[3, 4],
            member_code="tenant-test",
        ),
    ]
    await repo.upsert_parents(pts)

    # Sanity: ensure they exist
    pre = await qdrant_service.retrieve_by_ids(
        ["00000000-0000-0000-0000-000000000004", "00000000-0000-0000-0000-000000000005"]
    )
    assert len(pre) == 2

    # Act
    await repo.delete_summary_tree(777)

    # Assert: gone
    post = await qdrant_service.retrieve_by_ids(
        ["00000000-0000-0000-0000-000000000004", "00000000-0000-0000-0000-000000000005"]
    )
    assert post == []


async def test_update_and_get_collection_ids(repo: VectorRepository) -> None:
    # Arrange
    p = Parent(
        id="00000000-0000-0000-0000-000000000006",
        summary_id=5555,
        parent_idx=0,
        text="text-5555",
        checksum="xx",
        collection_ids=[1],
        member_code="tenant-test",
    )
    await repo.upsert_parents([p])

    # Act: update membership
    await repo.update_collection_ids(summary_id=5555, collection_ids=[10, 11, 12])

    # Assert: delegate path returns normalized ints
    ids = await repo.get_collection_ids(5555)
    assert ids == [10, 11, 12]
