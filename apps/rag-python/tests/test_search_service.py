"""Tests for search service."""

from collections.abc import Sequence

import pytest
from llama_index.core import Document
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import TextNode
from llama_index.embeddings.openai.base import BaseEmbedding  # type: ignore
from llama_index.vector_stores.qdrant import QdrantVectorStore  # type: ignore
from qdrant_client import AsyncQdrantClient, QdrantClient

from rag_python.config import Settings
from rag_python.core.constants import CHILD_SPARSE_VEC, CHILD_VEC
from rag_python.repositories.vector_repository import VectorRepository
from rag_python.services.pipeline import IngestionPipeline
from rag_python.services.qdrant_service import QdrantService
from rag_python.services.search_service import SearchService

pytestmark = pytest.mark.asyncio


# ---------- Fake embedding so LlamaIndex never calls external APIs ----------
class _FakeEmbedding(BaseEmbedding):
    dim: int = 1536

    def _get_text_embedding(self, text: str):
        return [0.0] * self.dim

    async def _aget_text_embedding(self, text: str):
        return [0.0] * self.dim

    def _get_query_embedding(self, query: str):
        return [0.0] * self.dim

    async def _aget_query_embedding(self, query: str):
        return [0.0] * self.dim


class StubParentParser:
    """
    Deterministic "semantic" splitter for parent nodes (no embeddings).
    It splits on '\n\n' into TextNodes and supports async API.
    """

    async def aget_nodes_from_documents(self, docs: Sequence[Document]) -> list[TextNode]:
        nodes: list[TextNode] = []
        for doc in docs:
            parts = [p for p in doc.text.split("\n\n") if p.strip()]
            for chunk in parts:
                nodes.append(TextNode(text=chunk))
        return nodes


@pytest.fixture
def child_sentence_splitter():
    # Simple sentence splitter for child nodes
    return SentenceSplitter(chunk_size=80, chunk_overlap=0)


@pytest.fixture
def child_vector_store(
    client_local: QdrantClient,
    aclient_local: AsyncQdrantClient,
    test_settings: Settings,
):
    return QdrantVectorStore(
        client=client_local,
        aclient=aclient_local,
        collection_name=test_settings.qdrant_collection_name,
        dense_vector_name=CHILD_VEC,
        sparse_vector_name=CHILD_SPARSE_VEC,
        enable_hybrid=True,
        fastembed_sparse_model="Qdrant/bm25",
        batch_size=20,
    )


@pytest.fixture
def pipeline(
    qdrant_service: QdrantService,
    child_vector_store: QdrantVectorStore,
    child_sentence_splitter: SentenceSplitter,
) -> IngestionPipeline:
    # Wire a real VectorRepository (hitting embedded Qdrant)
    repo = VectorRepository(qdrant_service)
    parent_parser = StubParentParser()  # semantic branch (async)
    child_parser = child_sentence_splitter  # sentence-level child split
    return IngestionPipeline(
        vector_repository=repo,
        parent_parser=parent_parser,  # pyright: ignore[reportArgumentType]
        child_parser=child_parser,
        child_vector_store=child_vector_store,
    )


@pytest.fixture
def search_service(
    qdrant_service: QdrantService, child_vector_store: QdrantVectorStore
) -> SearchService:
    return SearchService(
        settings=Settings(qdrant_collection_name="test-unified"),
        qdrant_service=qdrant_service,
        embed_model=_FakeEmbedding(),  # pyright: ignore[reportAbstractUsage, reportArgumentType]
        child_vector_store=child_vector_store,
    )


async def test_search_by_member_code_returns_results(
    pipeline: IngestionPipeline,
    search_service: SearchService,
):
    # Ingest document under same summary
    # Note: Small content (<2500 tokens) will be kept as a single parent chunk
    content = "Alpha paragraph. More alpha.\n\nBeta paragraph. More beta."
    stats = await pipeline.ingest_document(
        summary_id=1001,
        member_code="tenant-A",
        original_content=content,
        collection_ids=[10, 20],
    )
    assert stats.parent_chunks == 1  # Small content is not split
    assert stats.child_chunks and stats.child_chunks >= 1

    # Search (hybrid)
    res = await search_service.search(
        query="alpha",
        member_code="tenant-A",
        limit=5,
        sparse_top_k=5,
    )
    assert res.total_results > 0
    # Ensure results keyed by summary_id
    assert "1001" in res.results
    sr = res.results["1001"]
    assert sr.summary_id == 1001
    assert sr.total_chunks >= 1
    # Children are present and sorted
    assert sr.chunks[0].matching_children
    assert sr.chunks[0].matching_children[0].score >= sr.chunks[0].matching_children[-1].score


async def test_search_filter_by_summary_id(
    pipeline: IngestionPipeline,
    search_service: SearchService,
):
    await pipeline.ingest_document(
        summary_id=2001,
        member_code="tenant-B",
        original_content="gamma words here. more gamma.",
        collection_ids=[99],
    )
    await pipeline.ingest_document(
        summary_id=2002,
        member_code="tenant-B",
        original_content="delta words here. more delta.",
        collection_ids=[99],
    )

    # Query that matches only summary_id=2002 content by filter
    res = await search_service.search(
        query="delta",
        member_code="tenant-B",
        summary_id=2002,
        limit=5,
        sparse_top_k=5,
    )
    assert res.total_results > 0
    assert "2002" in res.results
    assert "2001" not in res.results


async def test_search_filter_by_collection_id(
    pipeline: IngestionPipeline,
    search_service: SearchService,
):
    # Two docs, different collections
    await pipeline.ingest_document(
        summary_id=3001,
        member_code="tenant-C",
        original_content="epsilon term present.",
        collection_ids=[1],
    )
    await pipeline.ingest_document(
        summary_id=3002,
        member_code="tenant-C",
        original_content="zeta term present.",
        collection_ids=[2],
    )

    # Filter so only [2] survives
    res = await search_service.search(
        query="term",
        member_code="tenant-C",
        collection_id=2,
        limit=5,
        sparse_top_k=5,
    )
    assert res.total_results > 0
    assert "3002" in res.results
    assert "3001" not in res.results


async def test_search_no_results_returns_empty(search_service: SearchService):
    res = await search_service.search(
        query="no-such-token-xyz",
        member_code="tenant-Z",
        limit=3,
        sparse_top_k=3,
    )
    assert res.total_results == 0
    assert res.results == {}
