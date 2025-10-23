# conftest.py
import asyncio

import pytest
import pytest_asyncio
from llama_index.core import Settings as LlamaIndexSettings
from llama_index.core.embeddings.mock_embed_model import MockEmbedding
from qdrant_client import AsyncQdrantClient, QdrantClient

from rag_python.config import Settings
from rag_python.services.qdrant_service import QdrantService


# Set up mock embedding model globally for all tests
@pytest.fixture(scope="session", autouse=True)
def setup_mock_embedding():
    """Configure LlamaIndex to use mock embeddings for all tests."""
    LlamaIndexSettings.embed_model = MockEmbedding(embed_dim=1536)
    yield
    # Reset after tests
    LlamaIndexSettings.embed_model = None


@pytest.fixture(scope="session")
def event_loop():
    # pytest-asyncio default loop is function-scoped; we want session-scoped to speed tests.
    loop = asyncio.get_event_loop_policy().new_event_loop()
    yield loop
    loop.close()


@pytest.fixture
def client_local() -> QdrantClient:
    return QdrantClient(path=":memory:")


@pytest_asyncio.fixture
async def aclient_local():
    """In-memory embedded Qdrant for tests."""
    client = AsyncQdrantClient(path=":memory:")
    try:
        yield client
    finally:
        await client.close()


@pytest.fixture
def test_settings() -> Settings:
    # Minimal viable settings for your service; adjust as needed
    return Settings(
        qdrant_collection_name="test-unified",
        qdrant_url="http://unused-in-local-mode",
        qdrant_api_key=None,
        qdrant_prefer_grpc=False,
        # ... any other fields your Settings requires
    )


@pytest_asyncio.fixture
async def qdrant_service(
    client_local: QdrantClient,
    aclient_local: AsyncQdrantClient,
    test_settings: Settings,
):
    svc = QdrantService(settings=test_settings, client=client_local, aclient=aclient_local)
    await svc.ensure_schema()
    yield svc
    await svc.aclose()
