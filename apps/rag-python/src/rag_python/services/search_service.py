"""Search service for hybrid semantic + keyword search."""

from collections import defaultdict

from llama_index.embeddings.openai import OpenAIEmbedding  # type: ignore

from rag_python.config import Settings
from rag_python.core.logging import get_logger
from rag_python.schemas.search import SearchResponse, SearchResultItem, SummaryResults
from rag_python.services.qdrant_service import QdrantService

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

            # Convert query to embedding
            query_embedding = await self.embed_model.aget_text_embedding(query)

            # Perform hybrid search using QdrantService
            search_results = await self.qdrant_service.search(
                query_vector=query_embedding,
                member_code=member_code,
                limit=limit,
                sparse_top_k=sparse_top_k,
                node_type="child",  # Only search child nodes
            )

            logger.info(f"Found {len(search_results)} raw search results")

            # Aggregate results by summary_id
            aggregated: dict[int, list[tuple[SearchResultItem, float]]] = defaultdict(list)

            for result in search_results:
                if result.payload is None:
                    continue

                result_summary_id = result.payload.get("summary_id")
                if result_summary_id is None:
                    continue

                # Apply summary_id filter if specified
                if summary_id is not None and result_summary_id != summary_id:
                    continue

                # Create SearchResultItem
                item = SearchResultItem(
                    id=str(result.id),
                    text=result.payload.get("text", ""),
                    score=result.score,
                    parent_id=result.payload.get("parent_id"),
                    chunk_index=result.payload.get("chunk_index", 0),
                )

                aggregated[result_summary_id].append((item, result.score))

            # Build final response with SummaryResults
            results_by_summary: dict[str, SummaryResults] = {}

            for sum_id, items_with_scores in aggregated.items():
                # Sort by score descending
                items_with_scores.sort(key=lambda x: x[1], reverse=True)

                # Extract items without scores
                items = [item for item, _ in items_with_scores]
                scores = [score for _, score in items_with_scores]

                # Get member_code from first item
                first_payload = next(
                    (
                        r.payload
                        for r in search_results
                        if r.payload and r.payload.get("summary_id") == sum_id
                    ),
                    None,
                )
                member_code_value = (
                    first_payload.get("member_code", "unknown") if first_payload else "unknown"
                )

                summary_result = SummaryResults(
                    summary_id=sum_id,
                    member_code=member_code_value,
                    chunks=items,
                    total_chunks=len(items),
                    max_score=max(scores) if scores else 0.0,
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
