"""FastAPI dependency injection utilities."""

from typing import TYPE_CHECKING, Annotated

from fastapi import Depends

from rag_python.config import Settings, get_settings

if TYPE_CHECKING:
    from rag_python.services.qdrant_service import QdrantService
    from rag_python.services.search_service import SearchService

# Common dependencies that can be injected into route handlers
SettingsDep = Annotated[Settings, Depends(get_settings)]


def get_qdrant_service(settings: Annotated["Settings", Depends(get_settings)]) -> "QdrantService":
    """Get or create a cached QdrantService instance.

    Returns:
        QdrantService instance.
    """
    from rag_python.services.qdrant_service import QdrantService

    return QdrantService(settings)


def get_search_service(
    settings: Annotated["Settings", Depends(get_settings)],
    qdrant_service: Annotated["QdrantService", Depends(get_qdrant_service)],
) -> "SearchService":
    """Get a SearchService instance.

    Returns:
        SearchService instance.
    """
    from rag_python.services.search_service import SearchService

    return SearchService(settings, qdrant_service)


# Type aliases for dependency injection
QdrantServiceDep = Annotated["QdrantService", Depends(get_qdrant_service)]
SearchServiceDep = Annotated["SearchService", Depends(get_search_service)]
