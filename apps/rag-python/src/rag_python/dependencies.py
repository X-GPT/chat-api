"""FastAPI dependency injection utilities."""

from functools import lru_cache
from typing import TYPE_CHECKING, Annotated

from fastapi import Depends

from rag_python.config import Settings, get_settings

if TYPE_CHECKING:
    from rag_python.services.qdrant_service import QdrantService
    from rag_python.services.search_service import SearchService

# Common dependencies that can be injected into route handlers
SettingsDep = Annotated[Settings, Depends(get_settings)]


@lru_cache
def get_qdrant_service() -> "QdrantService":
    """Get or create a cached QdrantService instance.

    Returns:
        QdrantService instance.
    """
    from rag_python.services.qdrant_service import QdrantService

    settings = get_settings()
    return QdrantService(settings)


@lru_cache
def get_search_service() -> "SearchService":
    """Get a SearchService instance.

    Returns:
        SearchService instance.
    """
    from rag_python.services.search_service import SearchService

    settings = get_settings()
    qdrant_service = get_qdrant_service()
    return SearchService(settings, qdrant_service)


# Type aliases for dependency injection
QdrantServiceDep = Annotated["QdrantService", Depends(get_qdrant_service)]
SearchServiceDep = Annotated["SearchService", Depends(get_search_service)]
