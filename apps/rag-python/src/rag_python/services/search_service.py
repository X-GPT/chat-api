"""Search service for hybrid semantic + keyword search."""

import asyncio
from collections import defaultdict

from llama_index.embeddings.openai import OpenAIEmbedding  # type: ignore

from rag_python.config import Settings
from rag_python.core.logging import get_logger
from rag_python.schemas.search import (
    MatchingChild,
    SearchResponse,
    SearchResultItem,
    SummaryResults,
)
from rag_python.services.qdrant_service import QdrantService, SearchResult

logger = get_logger(__name__)


class SearchService:
    """Service for hybrid search operations."""

    def __init__(self, settings: Settings, qdrant_service: QdrantService):
        """Initialize search service.

        Args:
            settings: Application settings.
            qdrant_service: Qdrant service instance.
        """
        self.settings = settings
        self.qdrant_service = qdrant_service

        # Initialize OpenAI embedding model
        self.embed_model = OpenAIEmbedding(
            api_key=settings.openai_api_key,
            model=settings.openai_embedding_model,
        )

        logger.info("Search service initialized")

    async def search(
        self,
        query: str,
        member_code: str | None = None,
        summary_id: int | None = None,
        limit: int = 10,
        sparse_top_k: int = 10,
    ) -> SearchResponse:
        """Perform hybrid search and aggregate results by summary_id.

        Args:
            query: Search query text.
            member_code: Optional member code to filter by.
            summary_id: Optional summary ID to filter by.
            limit: Maximum number of results to return.
            sparse_top_k: Number of results from sparse search.

        Returns:
            SearchResponse with results aggregated by summary_id.
        """
        try:
            logger.info(
                f"Performing search: query='{query}', member_code={member_code}, "
                f"summary_id={summary_id}, limit={limit}"
            )

            # Perform hybrid search using QdrantService (searches children collection)
            search_results = await self.qdrant_service.search(
                query=query,
                member_code=member_code,
                limit=limit,
                sparse_top_k=sparse_top_k,
            )

            logger.info(f"Found {len(search_results)} child chunk matches")

            # Step 1: Group results by parent_id
            parent_groups: dict[str, list[tuple[SearchResult, float]]] = defaultdict(list)

            for result in search_results:
                if result.payload is None:
                    continue

                parent_id = result.payload.get("parent_id")
                if not parent_id:
                    logger.warning(f"Child result {result.id} has no parent_id")
                    continue

                parent_groups[parent_id].append((result, result.score))

            logger.info(f"Grouped results into {len(parent_groups)} unique parents")

            # Step 2: Batch fetch all parent nodes
            parent_ids = list(parent_groups.keys())
            parent_nodes = await asyncio.gather(
                *[self.qdrant_service.get_node_by_id(pid) for pid in parent_ids]
            )

            # Step 3: Build deduplicated parent-based results
            parent_results: list[tuple[SearchResultItem, int]] = []

            for parent_id, parent_node in zip(parent_ids, parent_nodes):
                if not parent_node:
                    logger.warning(f"Parent node {parent_id} not found")
                    continue

                child_matches = parent_groups[parent_id]

                # Create MatchingChild objects
                matching_children = [
                    MatchingChild(
                        id=str(child_result.id),
                        text=(child_result.payload.get("text", "") if child_result.payload else ""),
                        score=child_score,
                        chunk_index=(
                            child_result.payload.get("chunk_index", 0)
                            if child_result.payload
                            else 0
                        ),
                    )
                    for child_result, child_score in child_matches
                ]

                # Sort matching children by score (best first)
                matching_children.sort(key=lambda x: x.score, reverse=True)

                # Get summary_id from parent metadata
                result_summary_id = parent_node.metadata.get("summary_id")
                if result_summary_id is None:
                    logger.warning(f"Parent {parent_id} has no summary_id")
                    continue

                # Apply summary_id filter if specified
                if summary_id is not None and result_summary_id != summary_id:
                    continue

                # Create parent-based SearchResultItem
                parent_item = SearchResultItem(
                    id=parent_id,
                    text=parent_node.get_content(),
                    max_score=max(c.score for c in matching_children),
                    chunk_index=parent_node.metadata.get("chunk_index", 0),
                    matching_children=matching_children,
                )

                parent_results.append((parent_item, result_summary_id))

            logger.info(f"Created {len(parent_results)} parent-based results")

            # Step 4: Aggregate by summary_id
            aggregated: dict[int, list[SearchResultItem]] = defaultdict(list)

            for item, result_summary_id in parent_results:
                aggregated[result_summary_id].append(item)

            # Step 5: Build final response with SummaryResults
            results_by_summary: dict[str, SummaryResults] = {}

            for sum_id, items in aggregated.items():
                # Sort by max_score descending
                items.sort(key=lambda x: x.max_score, reverse=True)

                # Get member_code from first parent's metadata
                member_code_value = "unknown"
                if items:
                    # Get from parent node metadata (already loaded)
                    for parent_node in parent_nodes:
                        if parent_node and parent_node.metadata.get("summary_id") == sum_id:
                            member_code_value = parent_node.metadata.get("member_code", "unknown")
                            break

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
                f"Search completed: {total_results} total results "
                f"across {len(results_by_summary)} summaries"
            )

            return SearchResponse(
                query=query,
                results=results_by_summary,
                total_results=total_results,
            )

        except Exception as e:
            logger.error(f"Error performing search: {e}", exc_info=True)
            raise
