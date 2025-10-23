"""Repository for interacting with Qdrant-stored parent vectors."""

from __future__ import annotations

from collections.abc import Sequence
from typing import cast

from qdrant_client import models as q

from rag_python.adapters import qdrant_mapper
from rag_python.core.constants import (
    K_CHECKSUM,
    K_COLLECTION_IDS,
    K_SUMMARY_ID,
    K_TYPE,
    POINT_TYPE_PARENT,
)
from rag_python.core.logging import get_logger
from rag_python.core.models import Parent
from rag_python.services.qdrant_service import QdrantService

logger = get_logger(__name__)


class VectorRepository:
    """Encapsulates parent persistence and metadata lookups."""

    def __init__(self, qdrant_service: QdrantService):
        self._qdrant = qdrant_service

    async def upsert_parents(self, parents: Sequence[Parent]) -> None:
        """Persist parent payload points into Qdrant."""
        if not parents:
            return
        points = [qdrant_mapper.parent_to_point(parent) for parent in parents]
        await self._qdrant.upsert_points(points)

    async def get_existing_checksum(self, summary_id: int) -> str | None:
        """Return the first checksum associated with a summary, if present."""
        records = await self._qdrant.retrieve_by_filter(
            filter_=q.Filter(
                must=[
                    q.FieldCondition(
                        key=K_SUMMARY_ID,
                        match=q.MatchValue(value=summary_id),
                    ),
                    q.FieldCondition(
                        key=K_TYPE,
                        match=q.MatchValue(value=POINT_TYPE_PARENT),
                    ),
                ]
            ),
            limit=1,
            with_vectors=False,
            with_payload=True,
        )
        if not records:
            return None

        if len(records) > 1:
            logger.warning("Multiple records found for summary_id=%s: %s", summary_id, records)

        payload = records[0].payload or {}
        checksum = payload.get(K_CHECKSUM)
        return cast(str | None, checksum) if isinstance(checksum, str) else None

    async def get_parents(self, parent_ids: Sequence[str]) -> list[Parent]:
        """Fetch parent payloads by their point IDs."""
        if not parent_ids:
            return []
        records = await self._qdrant.retrieve_by_ids(
            parent_ids,
            with_payload=True,
            with_vectors=False,
        )
        # If order matters, restore it:
        by_id = {r.id: r for r in records}
        ordered = [by_id[i] for i in parent_ids if i in by_id]
        return [qdrant_mapper.record_to_parent(record) for record in ordered]

    async def delete_summary_tree(self, summary_id: int) -> None:
        """Remove all points (parents + children) for a summary."""
        await self._qdrant.delete(
            filter_=q.Filter(
                must=[
                    q.FieldCondition(
                        key="summary_id",
                        match=q.MatchValue(value=summary_id),
                    )
                ]
            )
        )

    async def update_collection_ids(
        self,
        summary_id: int,
        collection_ids: Sequence[int],
    ) -> None:
        """Update collection membership payload across all summary points."""
        await self._qdrant.set_payload(
            payload={K_COLLECTION_IDS: list(collection_ids)},
            filter_=q.Filter(
                must=[
                    q.FieldCondition(
                        key=K_SUMMARY_ID,
                        match=q.MatchValue(value=summary_id),
                    )
                ]
            ),
        )

    async def get_collection_ids(self, summary_id: int) -> list[int]:
        """Retrieve collection IDs for the summary's parent payload."""
        return await self._qdrant.get_collection_ids(summary_id)
