"""Search endpoint for hybrid semantic + keyword search."""

from fastapi import APIRouter, HTTPException, status

from rag_python.core.logging import get_logger
from rag_python.dependencies import SearchServiceDep
from rag_python.schemas.search import SearchRequest, SearchResponse

logger = get_logger(__name__)

router = APIRouter(tags=["search"])


@router.post(
    "/search",
    response_model=SearchResponse,
    summary="Hybrid Search",
    description="Performs hybrid semantic + keyword search on ingested documents",
    status_code=status.HTTP_200_OK,
)
async def search(
    request: SearchRequest,
    search_service: SearchServiceDep,
) -> SearchResponse:
    """Perform hybrid search on ingested documents.

    This endpoint performs a hybrid search combining:
    - Semantic search using vector embeddings
    - Keyword search using BM25

    Results are aggregated by summary_id and can be filtered by member_code
    and/or summary_id.

    Args:
        request: Search request with query and optional filters.
        search_service: Injected search service.

    Returns:
        SearchResponse: Aggregated search results by summary_id.

    Raises:
        HTTPException: If search fails.
    """
    try:
        logger.info(
            f"Search request: query='{request.query}', "
            f"member_code={request.member_code}, "
            f"summary_id={request.summary_id}, "
            f"collection_id={request.collection_id}, "
            f"limit={request.limit}"
        )

        response = await search_service.search(
            query=request.query,
            member_code=request.member_code,
            summary_id=request.summary_id,
            collection_id=request.collection_id,
            limit=request.limit,
            sparse_top_k=request.sparse_top_k,
        )

        logger.info(
            f"Search completed: {response.total_results} results "
            f"across {len(response.results)} summaries"
        )

        return response

    except Exception as e:
        logger.error(f"Search failed: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Search failed: {str(e)}",
        ) from e
