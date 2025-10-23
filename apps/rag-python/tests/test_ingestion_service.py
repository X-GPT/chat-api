"""Unit tests for the ingestion service facade."""

from __future__ import annotations

from collections.abc import Sequence

import pytest
from llama_index.core import Document
from llama_index.core.node_parser import SentenceSplitter
from llama_index.core.schema import TextNode
from llama_index.embeddings.openai.base import BaseEmbedding  # type: ignore
from llama_index.vector_stores.qdrant import QdrantVectorStore  # type: ignore
from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client import models as q

from rag_python.config import Settings
from rag_python.core.constants import (
    CHILD_SPARSE_VEC,
    CHILD_VEC,
    K_MEMBER_CODE,
    K_SUMMARY_ID,
    K_TYPE,
    POINT_TYPE_PARENT,
)
from rag_python.repositories.vector_repository import VectorRepository
from rag_python.services.ingestion_service import IngestionService
from rag_python.services.pipeline import IngestionPipeline
from rag_python.services.qdrant_service import QdrantService
from rag_python.text_processing.checksum import compute_checksum
from rag_python.text_processing.normalize_text import normalize_text


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


pytestmark = pytest.mark.asyncio


async def test_ingest_document(
    qdrant_service: QdrantService,
) -> None:
    """ingest_document should delegate to the pipeline without schema setup."""
    settings = Settings(
        qdrant_collection_name="test-unified",
        qdrant_url="http://unused-in-local-mode",
        qdrant_api_key=None,
        qdrant_prefer_grpc=False,
    )
    service = IngestionService(
        settings=settings,
        qdrant_service=qdrant_service,
        embed_model=_FakeEmbedding(),  # pyright: ignore[reportAbstractUsage, reportArgumentType]
    )

    result = await service.ingest_document(
        summary_id=101,
        member_code="tenant-a",
        content="Full original content",
        collection_ids=[1, 2],
    )

    assert result.operation == "create"
    assert result.summary_id == 101
    assert result.member_code == "tenant-a"
    assert result.parent_chunks == 1
    assert result.child_chunks == 1
    assert result.total_nodes == 2

    records = await qdrant_service.retrieve_by_filter(
        filter_=q.Filter(
            must=[
                q.FieldCondition(key=K_SUMMARY_ID, match=q.MatchValue(value=101)),
                q.FieldCondition(key=K_MEMBER_CODE, match=q.MatchValue(value="tenant-a")),
                q.FieldCondition(key=K_TYPE, match=q.MatchValue(value=POINT_TYPE_PARENT)),
            ],
        ),
        limit=2,
        with_payload=True,
        with_vectors=False,
    )
    assert len(records) == 1
    assert records[0].payload and records[0].payload["summary_id"] == 101
    assert records[0].payload and records[0].payload["member_code"] == "tenant-a"
    assert records[0].payload and records[0].payload["type"] == POINT_TYPE_PARENT
    assert records[0].payload and records[0].payload["collection_ids"] == [1, 2]
    assert records[0].payload and records[0].payload["checksum"] == compute_checksum(
        normalize_text("Full original content")
    )


async def test_update_document(
    qdrant_service: QdrantService,
) -> None:
    """update_document should delegate to the pipeline without schema setup."""
    settings = Settings(
        qdrant_collection_name="test-unified",
        qdrant_url="http://unused-in-local-mode",
        qdrant_api_key=None,
        qdrant_prefer_grpc=False,
    )
    service = IngestionService(
        settings=settings,
        qdrant_service=qdrant_service,
        embed_model=_FakeEmbedding(),  # pyright: ignore[reportAbstractUsage, reportArgumentType]
    )

    result = await service.update_document(
        summary_id=55,
        member_code="tenant-x",
        original_content="Updated body",
    )

    assert result.operation == "update"
    assert result.summary_id == 55
    assert result.member_code == "tenant-x"
    assert result.parent_chunks == 1
    assert result.child_chunks == 1
    assert result.total_nodes == 2


async def test_delete_document(
    qdrant_service: QdrantService,
) -> None:
    """delete_document should delegate to the pipeline without schema setup."""
    settings = Settings(
        qdrant_collection_name="test-unified",
        qdrant_url="http://unused-in-local-mode",
        qdrant_api_key=None,
        qdrant_prefer_grpc=False,
    )
    service = IngestionService(settings=settings, qdrant_service=qdrant_service)

    result = await service.delete_document(summary_id=321)

    assert result.operation == "delete"
    assert result.summary_id == 321
    assert result.member_code is None
    assert result.parent_chunks is None
    assert result.child_chunks is None
    assert result.total_nodes is None
