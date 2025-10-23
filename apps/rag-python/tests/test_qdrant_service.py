"""Tests for the minimal Qdrant service."""

from __future__ import annotations

import pytest
from qdrant_client import AsyncQdrantClient
from qdrant_client import models as q

from rag_python.config import Settings
from rag_python.core.constants import (
    CHILD_SPARSE_VEC,
    CHILD_VEC,
    POINT_TYPE_CHILD,
    POINT_TYPE_PARENT,
)
from rag_python.services.qdrant_service import QdrantService

pytestmark = pytest.mark.asyncio


def _v(n: int = 1536) -> list[float]:
    # Dense vector helper: deterministic but trivial
    return [0.0] * n


async def test_ensure_schema_creates_collection(
    aclient_local: AsyncQdrantClient,
) -> None:
    # Use a unique name for this test (so we don't reuse the one from qdrant_service fixture)
    test_settings = Settings(
        qdrant_collection_name="test-schema",
        qdrant_url="http://unused-in-local-mode",
        qdrant_api_key=None,
        qdrant_prefer_grpc=False,
    )

    svc = QdrantService(settings=test_settings, aclient=aclient_local)

    # 1️⃣ It should not exist yet
    assert not await svc.collection_exists()

    # 2️⃣ Create it
    await svc.ensure_schema()

    # 3️⃣ Now it should exist
    assert await svc.collection_exists()

    # 4️⃣ Validate schema details
    info = await svc.get_collection_info()
    params = info.config.params  # type: ignore[attr-defined]

    # Dense vector
    assert CHILD_VEC in params.vectors  # pyright: ignore[reportOperatorIssue]
    dense_cfg = params.vectors[CHILD_VEC]  # pyright: ignore[reportIndexIssue, reportOptionalSubscript, reportUnknownVariableType]
    assert dense_cfg.size == svc._DENSE_VECTOR_SIZE  # pyright: ignore[reportPrivateUsage, reportUnknownMemberType]
    assert dense_cfg.distance == q.Distance.COSINE  # pyright: ignore[reportUnknownMemberType]

    # Sparse vector
    assert CHILD_SPARSE_VEC in params.sparse_vectors  # type: ignore[attr-defined]

    # Payload indexes - note: local Qdrant doesn't populate payload_schema, so we skip this check
    # In production with a real Qdrant server, the payload indexes would be created
    # schema = info.payload_schema
    # expected_fields = {"member_code", "summary_id", "collection_ids", "type", "checksum"}
    # assert expected_fields.issubset(schema.keys())

    # 5️⃣ Idempotent: call again should not raise
    await svc.ensure_schema()

    await svc.aclose()


async def test_upsert_and_retrieve_by_ids(qdrant_service: QdrantService):
    pts = [
        q.PointStruct(
            id="00000000-0000-0000-0000-000000000001",
            vector={CHILD_VEC: _v()},
            payload={
                "summary_id": 1001,
                "type": POINT_TYPE_PARENT,
                "collection_ids": [1, 2],
                "member_code": "tenant-A",
                "checksum": "abc",
            },
        ),
        q.PointStruct(
            id="00000000-0000-0000-0000-000000000002",
            vector={CHILD_VEC: _v()},
            payload={
                "summary_id": 1002,
                "type": POINT_TYPE_PARENT,
                "collection_ids": [3],
                "member_code": "tenant-A",
                "checksum": "def",
            },
        ),
    ]

    await qdrant_service.upsert_points(pts)

    recs = await qdrant_service.retrieve_by_ids(
        ["00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"]
    )
    assert len(recs) == 2
    got = {r.id for r in recs}
    assert got == {"00000000-0000-0000-0000-000000000001", "00000000-0000-0000-0000-000000000002"}


async def test_update_and_get_collection_ids(qdrant_service: QdrantService):
    # Prepare a parent record
    pt = q.PointStruct(
        id="00000000-0000-0000-0000-000000004242",
        vector={CHILD_VEC: _v()},
        payload={
            "summary_id": 4242,
            "type": POINT_TYPE_PARENT,
            "collection_ids": [10],
            "member_code": "tenant-B",
            "checksum": "zzz",
        },
    )
    await qdrant_service.upsert_points([pt])

    # Update collection_ids by summary_id
    await qdrant_service.update_collection_ids(summary_id=4242, collection_ids=[10, 11, 12])

    # Read back using helper
    ids = await qdrant_service.get_collection_ids(4242)
    assert ids == [10, 11, 12]


async def test_delete_by_summary_id(qdrant_service: QdrantService):
    # Insert two points with the same summary_id
    pts = [
        q.PointStruct(
            id="00000000-0000-0000-0000-000000000777",
            vector={CHILD_VEC: _v()},
            payload={"summary_id": 777, "type": POINT_TYPE_PARENT},
        ),
        q.PointStruct(
            id="00000000-0000-0000-0000-000000000778",
            vector={CHILD_VEC: _v()},
            payload={"summary_id": 777, "type": POINT_TYPE_PARENT},
        ),
    ]
    await qdrant_service.upsert_points(pts)

    # Delete by summary_id
    await qdrant_service.delete_by_summary_id(777)

    # Verify gone
    recs = await qdrant_service.retrieve_by_ids(
        ["00000000-0000-0000-0000-000000000777", "00000000-0000-0000-0000-000000000778"]
    )
    assert recs == []


async def test_filter_by_payload(qdrant_service: QdrantService):
    """Test that payload filtering works in in-memory mode."""
    # Insert points with different member_codes and types
    pts = [
        q.PointStruct(
            id="00000000-0000-0000-0000-000000000901",
            vector={CHILD_VEC: _v()},
            payload={
                "summary_id": 901,
                "type": POINT_TYPE_PARENT,
                "member_code": "tenant-A",
                "collection_ids": [1, 2],
            },
        ),
        q.PointStruct(
            id="00000000-0000-0000-0000-000000000902",
            vector={CHILD_VEC: _v()},
            payload={
                "summary_id": 902,
                "type": POINT_TYPE_PARENT,
                "member_code": "tenant-B",
                "collection_ids": [3],
            },
        ),
        q.PointStruct(
            id="00000000-0000-0000-0000-000000000903",
            vector={CHILD_VEC: _v()},
            payload={
                "summary_id": 903,
                "type": POINT_TYPE_CHILD,
                "member_code": "tenant-A",
                "collection_ids": [1],
            },
        ),
    ]
    await qdrant_service.upsert_points(pts)

    # Test 1: Filter by member_code = "tenant-A"
    filter_tenant_a = q.Filter(
        must=[q.FieldCondition(key="member_code", match=q.MatchValue(value="tenant-A"))]
    )
    results = await qdrant_service.retrieve_by_filter(filter_tenant_a, limit=10)
    assert len(results) == 2
    tenant_a_ids = {r.id for r in results}
    assert tenant_a_ids == {
        "00000000-0000-0000-0000-000000000901",
        "00000000-0000-0000-0000-000000000903",
    }

    # Test 2: Filter by member_code = "tenant-A" AND type = POINT_TYPE_PARENT
    filter_combined = q.Filter(
        must=[
            q.FieldCondition(key="member_code", match=q.MatchValue(value="tenant-A")),
            q.FieldCondition(key="type", match=q.MatchValue(value=POINT_TYPE_PARENT)),
        ]
    )
    results = await qdrant_service.retrieve_by_filter(filter_combined, limit=10)
    assert len(results) == 1
    assert results[0].id == "00000000-0000-0000-0000-000000000901"
    assert results[0].payload["summary_id"] == 901  # type: ignore[index]

    # Test 3: Filter by summary_id = 902
    filter_summary = q.Filter(
        must=[q.FieldCondition(key="summary_id", match=q.MatchValue(value=902))]
    )
    results = await qdrant_service.retrieve_by_filter(filter_summary, limit=10)
    assert len(results) == 1
    assert results[0].id == "00000000-0000-0000-0000-000000000902"
    assert results[0].payload["member_code"] == "tenant-B"  # type: ignore[index]


async def test_scroll_pagination(qdrant_service: QdrantService):
    """Test scroll with pagination."""
    # Insert 5 points
    pts = [
        q.PointStruct(
            id=f"00000000-0000-0000-0000-00000000{i:04d}",
            vector={CHILD_VEC: _v()},
            payload={"index": i},
        )
        for i in range(5)
    ]
    await qdrant_service.upsert_points(pts)

    # Scroll first page
    records, next_offset = await qdrant_service.scroll(limit=2)
    assert len(records) == 2
    assert next_offset is not None

    # Scroll second page
    records2, next_offset2 = await qdrant_service.scroll(limit=2, offset=next_offset)
    assert len(records2) == 2
    assert next_offset2 is not None


async def test_delete_by_ids(qdrant_service: QdrantService):
    """Test delete by point IDs."""
    pts = [
        q.PointStruct(
            id="00000000-0000-0000-0000-000000001001",
            vector={CHILD_VEC: _v()},
            payload={"data": "a"},
        ),
        q.PointStruct(
            id="00000000-0000-0000-0000-000000001002",
            vector={CHILD_VEC: _v()},
            payload={"data": "b"},
        ),
    ]
    await qdrant_service.upsert_points(pts)

    # Delete one point
    await qdrant_service.delete(ids=["00000000-0000-0000-0000-000000001001"])

    # Verify only second point remains
    recs = await qdrant_service.retrieve_by_ids(
        [
            "00000000-0000-0000-0000-000000001001",
            "00000000-0000-0000-0000-000000001002",
        ]
    )
    assert len(recs) == 1
    assert recs[0].id == "00000000-0000-0000-0000-000000001002"


async def test_set_payload(qdrant_service: QdrantService):
    """Test updating payload via set_payload."""
    pt = q.PointStruct(
        id="00000000-0000-0000-0000-000000002001",
        vector={CHILD_VEC: _v()},
        payload={"status": "draft", "count": 1},
    )
    await qdrant_service.upsert_points([pt])

    # Update payload by ID
    await qdrant_service.set_payload(
        payload={"status": "published", "count": 2},
        ids=["00000000-0000-0000-0000-000000002001"],
    )

    # Retrieve and verify
    recs = await qdrant_service.retrieve_by_ids(["00000000-0000-0000-0000-000000002001"])
    assert len(recs) == 1
    assert recs[0].payload["status"] == "published"  # type: ignore[index]
    assert recs[0].payload["count"] == 2  # type: ignore[index]


async def test_delete_without_selector_raises_error(qdrant_service: QdrantService):
    """Test that delete without ids or filter raises ValueError."""
    with pytest.raises(ValueError, match="Either ids or filter_ must be provided"):
        await qdrant_service.delete()


async def test_set_payload_without_selector_raises_error(qdrant_service: QdrantService):
    """Test that set_payload without ids or filter raises ValueError."""
    with pytest.raises(ValueError, match="Either ids or filter_ must be provided"):
        await qdrant_service.set_payload(payload={"foo": "bar"})
