"""FastAPI dependency injection utilities."""

from typing import TYPE_CHECKING, Annotated

from fastapi import Depends

from rag_python.config import Settings, get_settings

if TYPE_CHECKING:
    from rag_python.services.qdrant_service import QdrantService
    from rag_python.services.search_service import SearchService

# Common dependencies that can be injected into route handlers
SettingsDep = Annotated[Settings, Depends(get_settings)]


# Module-level cache for QdrantService singleton
_qdrant_service_cache: "QdrantService | None" = None


def get_qdrant_service(settings: Annotated["Settings", Depends(get_settings)]) -> "QdrantService":
    """Get or create a cached QdrantService instance.

    Returns:
        QdrantService instance.
    """
    global _qdrant_service_cache

    if _qdrant_service_cache is None:
        from rag_python.services.qdrant_service import QdrantService

        _qdrant_service_cache = QdrantService(settings)

    return _qdrant_service_cache


# Module-level cache for SearchService singleton
_search_service_cache: "SearchService | None" = None


def get_search_service(
    settings: Annotated["Settings", Depends(get_settings)],
    qdrant_service: Annotated["QdrantService", Depends(get_qdrant_service)],
) -> "SearchService":
    """Get a SearchService instance.

    Returns:
        SearchService instance.
    """
    global _search_service_cache

    if _search_service_cache is None:
        from rag_python.services.search_service import SearchService

        _search_service_cache = SearchService(settings, qdrant_service)

    return _search_service_cache


# Type aliases for dependency injection
QdrantServiceDep = Annotated["QdrantService", Depends(get_qdrant_service)]
SearchServiceDep = Annotated["SearchService", Depends(get_search_service)]
