"""Main API v1 router that combines all endpoint routers."""

from fastapi import APIRouter

from rag_python.api.v1.endpoints import health, hello, search

api_router = APIRouter()

# Include all endpoint routers
api_router.include_router(health.router)
api_router.include_router(hello.router)
api_router.include_router(search.router)
