"""Search service for hybrid semantic + keyword search."""

from collections import defaultdict
from typing import Any

from llama_index.core import VectorStoreIndex  # type: ignore
from llama_index.embeddings.openai import OpenAIEmbedding  # type: ignore
from llama_index.vector_stores.qdrant import QdrantVectorStore  # type: ignore
from qdrant_client import models as q

from rag_python.config import Settings
from rag_python.core.constants import (
    CHILD_SPARSE_VEC,
    CHILD_VEC,
    K_CHUNK_INDEX,
    K_COLLECTION_IDS,
    K_MEMBER_CODE,
    K_PARENT_ID,
    K_PARENT_IDX,
    K_PARENT_TEXT,
    K_SUMMARY_ID,
    K_TYPE,
    POINT_TYPE_CHILD,
)
from rag_python.core.logging import get_logger
from rag_python.schemas.search import (
    MatchingChild,
    SearchResponse,
    SearchResultItem,
    SummaryResults,
)
from rag_python.services.qdrant_service import QdrantService

logger = get_logger(__name__)


class SearchService:
    """Service for hybrid search operations."""

    def __init__(
        self,
        settings: Settings,
        qdrant_service: QdrantService,
        embed_model: OpenAIEmbedding | None = None,
        child_vector_store: QdrantVectorStore | None = None,
    ):
        """Initialize search service.

        Args:
            settings: Application settings.
            qdrant_service: Qdrant service instance.
            child_vector_store: Optional preconfigured Qdrant vector store (primarily for tests).
        """
        self.settings = settings
        self.qdrant_service = qdrant_service

        self.embed_model = embed_model or OpenAIEmbedding(
            api_key=settings.openai_api_key,
            model=settings.openai_embedding_model,
        )

        self.child_vector_store = child_vector_store or QdrantVectorStore(
            collection_name=self.qdrant_service.col,
            client=self.qdrant_service.client,
            aclient=self.qdrant_service.aclient,
            dense_vector_name=CHILD_VEC,
            sparse_vector_name=CHILD_SPARSE_VEC,
            enable_hybrid=True,
            fastembed_sparse_model="Qdrant/bm25",
        )

        self.child_index = VectorStoreIndex.from_vector_store(  # type: ignore[reportUnknownReturnType]
            self.child_vector_store,
            embed_model=self.embed_model,
        )

        logger.info("Search service initialized with hybrid child retriever")

    async def search(
        self,
        query: str,
        member_code: str | None = None,
        summary_id: int | None = None,
        collection_id: int | None = None,
        limit: int = 10,
        sparse_top_k: int = 10,
    ) -> SearchResponse:
        """Perform single-stage hybrid search and aggregate results by summary_id."""
        try:
            logger.info(
                "Single-stage search: query='%s', member_code=%s, summary_id=%s, collection_id=%s, limit=%s",
                query,
                member_code,
                summary_id,
                collection_id,
                limit,
            )

            must_filters: list[q.Condition] = [
                q.FieldCondition(
                    key=K_TYPE,
                    match=q.MatchValue(value=POINT_TYPE_CHILD),
                ),
            ]

            if member_code:
                must_filters.append(
                    q.FieldCondition(
                        key=K_MEMBER_CODE,
                        match=q.MatchValue(value=member_code),
                    )
                )

            if summary_id is not None:
                must_filters.append(
                    q.FieldCondition(
                        key=K_SUMMARY_ID,
                        match=q.MatchValue(value=summary_id),
                    )
                )

            if collection_id is not None:
                must_filters.append(
                    q.FieldCondition(
                        key=K_COLLECTION_IDS,
                        match=q.MatchValue(value=collection_id),
                    )
                )

            child_filters = q.Filter(must=must_filters)

            child_retriever = self.child_index.as_retriever(
                similarity_top_k=max(limit, sparse_top_k),
                sparse_top_k=sparse_top_k,
                hybrid_top_k=limit,
                vector_store_kwargs={"qdrant_filters": child_filters},
            )
            child_results = await child_retriever.aretrieve(query)

            logger.info("Child search returned %s matches", len(child_results))

            if not child_results:
                logger.info("No child chunks found, returning empty results")
                return SearchResponse(query=query, results={}, total_results=0)

            parent_groups: dict[str, list[Any]] = defaultdict(list)
            for child_result in child_results:
                parent_id = child_result.metadata.get(K_PARENT_ID)
                if not parent_id:
                    logger.warning("Child %s missing parent_id", child_result.node_id)
                    continue

                parent_groups[parent_id].append(child_result)

            logger.info("Grouped matches across %s parents", len(parent_groups))

            parent_ids = list(parent_groups.keys())
            parent_points = await self.qdrant_service.retrieve_by_ids(
                point_ids=parent_ids,
                with_payload=True,
                with_vectors=False,
            )

            parent_lookup: dict[str, dict[str, Any]] = {
                str(point.id): point.payload if point.payload else {} for point in parent_points
            }

            parent_results: list[tuple[SearchResultItem, int]] = []

            for parent_id, child_matches in parent_groups.items():
                parent_payload = parent_lookup.get(parent_id)
                if not parent_payload:
                    logger.warning("Parent %s not found", parent_id)
                    continue

                # Convert child matches into schema objects.
                matching_children: list[MatchingChild] = []
                for child in child_matches:
                    chunk_index = child.metadata.get(K_CHUNK_INDEX, 0)
                    score = child.score if child.score is not None else 0.0
                    matching_children.append(
                        MatchingChild(
                            id=str(child.node_id),
                            text=child.get_content(),
                            score=score,
                            chunk_index=chunk_index,
                        )
                    )

                if not matching_children:
                    continue

                matching_children.sort(key=lambda x: x.score, reverse=True)

                result_summary_id = parent_payload.get(K_SUMMARY_ID)
                if result_summary_id is None:
                    logger.warning("Parent %s missing summary_id", parent_id)
                    continue

                parent_item = SearchResultItem(
                    id=parent_id,
                    text=parent_payload.get(K_PARENT_TEXT, ""),
                    max_score=max(child.score for child in matching_children),
                    chunk_index=parent_payload.get(K_PARENT_IDX, 0),
                    matching_children=matching_children,
                )

                parent_results.append((parent_item, result_summary_id))

            logger.info("Created %s parent-based results", len(parent_results))

            aggregated: dict[int, list[SearchResultItem]] = defaultdict(list)
            for item, result_summary_id in parent_results:
                aggregated[result_summary_id].append(item)

            results_by_summary: dict[str, SummaryResults] = {}
            for sum_id, items in aggregated.items():
                items.sort(key=lambda x: x.max_score, reverse=True)

                member_code_value = "unknown"
                if items:
                    first_parent_payload = parent_lookup.get(items[0].id, {})
                    member_code_value = first_parent_payload.get(K_MEMBER_CODE, "unknown")

                summary_result = SummaryResults(
                    summary_id=sum_id,
                    member_code=member_code_value,
                    chunks=items,
                    total_chunks=len(items),
                    max_score=max(item.max_score for item in items) if items else 0.0,
                )
                results_by_summary[str(sum_id)] = summary_result

            total_results = sum(sr.total_chunks for sr in results_by_summary.values())

            logger.info(
                "Search completed: %s total results across %s summaries",
                total_results,
                len(results_by_summary),
            )

            return SearchResponse(
                query=query,
                results=results_by_summary,
                total_results=total_results,
            )

        except Exception as exc:
            logger.error("Error performing search: %s", exc, exc_info=True)
            raise
