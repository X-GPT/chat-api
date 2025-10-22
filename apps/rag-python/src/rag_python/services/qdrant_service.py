"""Minimal Qdrant service for managing the unified collection."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Final

from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client import models as q
from qdrant_client.conversions.common_types import PointId

from rag_python.config import Settings
from rag_python.core.constants import CHILD_SPARSE_VEC, CHILD_VEC
from rag_python.core.logging import get_logger

logger = get_logger(__name__)


@dataclass(slots=True)
class SearchResult:
    """Legacy search result container used by search service tests."""

    id: Any
    score: float
    payload: dict[str, Any] | None


class QdrantService:
    """Thin wrapper around Qdrant client for collection and point management."""

    _DENSE_VECTOR_SIZE: Final[int] = 1536

    def __init__(self, settings: Settings):
        self.settings = settings
        self.col = settings.qdrant_collection_name

        self.client = QdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            prefer_grpc=settings.qdrant_prefer_grpc,
        )
        self.aclient = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            prefer_grpc=settings.qdrant_prefer_grpc,
        )

        logger.info("QdrantService initialized for collection '%s'", self.col)

    @property
    def children_collection_name(self) -> str:
        """Backward compatible alias returning the unified collection name."""
        return self.col

    @property
    def parents_collection_name(self) -> str:
        """Backward compatible alias returning the unified collection name."""
        return self.col

    async def ensure_schema(self) -> None:
        """Ensure the single collection exists with required vectors and indexes."""
        if await self.collection_exists():
            logger.info("Collection '%s' already exists", self.col)
            await self._ensure_payload_indexes()
            return

        logger.info("Creating collection '%s' with named vectors", self.col)
        await self.aclient.create_collection(
            collection_name=self.col,
            vectors_config={
                CHILD_VEC: q.VectorParams(
                    size=self._DENSE_VECTOR_SIZE,
                    distance=q.Distance.COSINE,
                    on_disk=True,
                    quantization_config=q.BinaryQuantization(
                        binary=q.BinaryQuantizationConfig(
                            always_ram=True,
                        ),
                    ),
                    hnsw_config=q.HnswConfigDiff(m=16, ef_construct=256),
                ),
            },
            sparse_vectors_config={
                CHILD_SPARSE_VEC: q.SparseVectorParams(
                    index=q.SparseIndexParams(on_disk=True),
                    modifier=q.Modifier.IDF,
                )
            },
            on_disk_payload=True,
        )

        logger.info("Created collection '%s'", self.col)
        await self._ensure_payload_indexes()

    async def _ensure_payload_indexes(self) -> None:
        """Create payload indexes required for the new schema."""
        try:
            logger.info("Ensuring payload indexes for '%s'", self.col)

            await self.aclient.create_payload_index(
                collection_name=self.col,
                field_name="member_code",
                field_schema=q.KeywordIndexParams(
                    type=q.KeywordIndexType.KEYWORD,
                    is_tenant=True,
                ),
            )

            await self.aclient.create_payload_index(
                collection_name=self.col,
                field_name="summary_id",
                field_schema=q.PayloadSchemaType.INTEGER,
            )

            await self.aclient.create_payload_index(
                collection_name=self.col,
                field_name="collection_ids",
                field_schema=q.PayloadSchemaType.INTEGER,
            )

            await self.aclient.create_payload_index(
                collection_name=self.col,
                field_name="type",
                field_schema=q.PayloadSchemaType.KEYWORD,
            )

            await self.aclient.create_payload_index(
                collection_name=self.col,
                field_name="checksum",
                field_schema=q.PayloadSchemaType.KEYWORD,
            )
        except Exception as exc:  # pragma: no cover - defensive, depends on backend
            logger.warning("Failed to ensure payload indexes: %s", exc)

    async def collection_exists(self) -> bool:
        """Return True if the collection already exists."""
        return await self.aclient.collection_exists(self.col)

    async def ensure_collection_exists(self) -> None:
        """Backward compatible alias for ensure_schema()."""
        await self.ensure_schema()

    async def get_collection_info(
        self,
        collection_name: str | None = None,
    ) -> q.CollectionInfo:
        """Fetch collection information."""
        name = collection_name or self.col
        return await self.aclient.get_collection(name)

    async def upsert_points(
        self,
        points: Sequence[q.PointStruct],
        *,
        wait: bool = True,
    ) -> None:
        """Upsert raw points into the collection."""
        if not points:
            return

        await self.aclient.upsert(
            collection_name=self.col,
            points=list(points),
            wait=wait,
        )
        logger.debug("Upserted %d points into '%s'", len(points), self.col)

    async def retrieve_by_ids(
        self,
        point_ids: Sequence[str],
        *,
        with_payload: bool = True,
        with_vectors: bool = False,
    ) -> list[q.Record]:
        """Fetch records by their IDs."""
        if not point_ids:
            return []

        return await self.aclient.retrieve(
            collection_name=self.col,
            ids=list(point_ids),
            with_payload=with_payload,
            with_vectors=with_vectors,
        )

    async def retrieve_by_filter(
        self,
        filter_: q.Filter,
        *,
        limit: int,
        with_payload: bool = True,
        with_vectors: bool = False,
        offset: PointId | None = None,
    ) -> list[q.Record]:
        """Scroll through records matching a filter."""
        records, _ = await self.aclient.scroll(
            collection_name=self.col,
            scroll_filter=filter_,
            limit=limit,
            offset=offset,
            with_payload=with_payload,
            with_vectors=with_vectors,
        )
        return records

    async def scroll(
        self,
        *,
        limit: int,
        offset: PointId | None = None,
        filter_: q.Filter | None = None,
        with_payload: bool = True,
        with_vectors: bool = False,
    ) -> tuple[list[q.Record], PointId | None]:
        """Expose raw scroll for pagination use cases."""
        return await self.aclient.scroll(
            collection_name=self.col,
            scroll_filter=filter_,
            limit=limit,
            offset=offset,
            with_payload=with_payload,
            with_vectors=with_vectors,
        )

    async def delete(
        self,
        *,
        ids: Sequence[str] | None = None,
        filter_: q.Filter | None = None,
        wait: bool = True,
    ) -> None:
        """Delete points by IDs or filter."""
        points_selector: Any
        if ids is not None:
            points_selector = ids
        elif filter_ is not None:
            points_selector = filter_
        else:
            raise ValueError("Either ids or filter_ must be provided to delete points")

        await self.aclient.delete(
            collection_name=self.col,
            points_selector=points_selector,
            wait=wait,
        )

    async def set_payload(
        self,
        *,
        payload: dict[str, Any],
        ids: Sequence[str] | None = None,
        filter_: q.Filter | None = None,
    ) -> None:
        """Update payload values for selected points."""
        points_selector: Any
        if ids is not None:
            points_selector = ids
        elif filter_ is not None:
            points_selector = filter_
        else:
            raise ValueError("Either ids or filter_ must be provided to set_payload")

        await self.aclient.set_payload(
            collection_name=self.col,
            payload=payload,
            points=points_selector,
        )

    async def update_collection_ids(
        self,
        summary_id: int,
        collection_ids: Sequence[int],
    ) -> None:
        """Convenience helper to update collection_ids via payload mutation."""
        await self.set_payload(
            payload={"collection_ids": list(collection_ids)},
            filter_=q.Filter(
                must=[
                    q.FieldCondition(
                        key="summary_id",
                        match=q.MatchValue(value=summary_id),
                    )
                ]
            ),
        )

    async def delete_by_summary_id(self, summary_id: int) -> None:
        """Legacy helper to delete all points for a summary."""
        await self.delete(
            filter_=q.Filter(
                must=[
                    q.FieldCondition(
                        key="summary_id",
                        match=q.MatchValue(value=summary_id),
                    )
                ]
            )
        )

    async def delete_by_ids(
        self,
        point_ids: Sequence[str],
    ) -> None:
        """Legacy helper to delete points by IDs."""
        await self.delete(ids=point_ids)

    async def search(  # pragma: no cover - to be removed in task 3.1
        self,
        *args: Any,
        **kwargs: Any,
    ) -> list[SearchResult]:
        """Legacy entry point retained temporarily for compatibility.

        Search responsibilities are moving to services that orchestrate embeddings and result
        aggregation. Callers should migrate away from this method.
        """
        raise NotImplementedError(
            "QdrantService.search is no longer implemented. Use SearchService once updated."
        )

    async def get_node_by_id(  # pragma: no cover - to be removed in task 3.1
        self,
        point_id: str,
    ) -> Any:
        """Legacy method kept for compatibility while SearchService is refactored."""
        raise NotImplementedError(
            "QdrantService.get_node_by_id is no longer implemented under the new schema."
        )

    async def get_child_by_id(  # pragma: no cover - to be removed in task 3.1
        self,
        point_id: str,
    ) -> Any:
        """Legacy method kept for compatibility while SearchService is refactored."""
        raise NotImplementedError(
            "QdrantService.get_child_by_id is no longer implemented under the new schema."
        )


__all__ = ["QdrantService", "SearchResult"]
