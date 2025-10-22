"""High-level ingestion service that wires dependencies into the ingestion pipeline."""

from __future__ import annotations

from llama_index.core import Settings as LlamaIndexSettings
from llama_index.core.node_parser import SemanticSplitterNodeParser, SentenceSplitter
from llama_index.embeddings.openai import OpenAIEmbedding  # type: ignore
from llama_index.vector_stores.qdrant import QdrantVectorStore  # type: ignore

from rag_python.config import Settings
from rag_python.core.constants import CHILD_SPARSE_VEC, CHILD_VEC
from rag_python.core.logging import get_logger
from rag_python.repositories.vector_repository import VectorRepository
from rag_python.services.pipeline import IngestionPipeline, IngestionStats
from rag_python.services.qdrant_service import QdrantService

logger = get_logger(__name__)


class IngestionService:
    """Facade over the ingestion pipeline that owns dependency construction."""

    def __init__(
        self,
        settings: Settings,
        qdrant_service: QdrantService,
    ):
        self.settings = settings
        self.qdrant_service = qdrant_service

        self.embed_model = OpenAIEmbedding(
            api_key=settings.openai_api_key,
            model=settings.openai_embedding_model,
        )
        LlamaIndexSettings.embed_model = self.embed_model

        self.parent_parser = SemanticSplitterNodeParser(
            buffer_size=1,
            breakpoint_percentile_threshold=95,
            embed_model=self.embed_model,
        )
        self.child_parser = SentenceSplitter(
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )

        self.child_vector_store = QdrantVectorStore(
            collection_name=self.qdrant_service.col,
            client=self.qdrant_service.client,
            aclient=self.qdrant_service.aclient,
            dense_vector_name=CHILD_VEC,
            sparse_vector_name=CHILD_SPARSE_VEC,
            enable_hybrid=True,
            fastembed_sparse_model="Qdrant/bm25",
            batch_size=20,
        )

        vector_repository = VectorRepository(qdrant_service)
        self.pipeline = IngestionPipeline(
            vector_repository=vector_repository,
            parent_parser=self.parent_parser,
            child_parser=self.child_parser,
            child_vector_store=self.child_vector_store,
        )

        logger.info("IngestionService initialized with new ingestion pipeline")

    async def ingest_document(
        self,
        summary_id: int,
        member_code: str,
        content: str | None = None,
        collection_ids: list[int] | None = None,
        *,
        summary_text: str | None = None,
        original_content: str | None = None,
    ) -> IngestionStats:
        """Ingest a new document or reingest with idempotency."""
        resolved_original = original_content if original_content is not None else content
        if resolved_original is None:
            raise ValueError("original_content or content must be provided for ingestion")
        resolved_summary = (
            summary_text
            if summary_text is not None
            else (content if content is not None else "")
        )

        return await self.pipeline.ingest_document(
            summary_id=summary_id,
            member_code=member_code,
            summary_text=resolved_summary,
            original_content=resolved_original,
            collection_ids=collection_ids,
        )

    async def update_document(
        self,
        summary_id: int,
        member_code: str,
        content: str | None = None,
        collection_ids: list[int] | None = None,
        *,
        summary_text: str | None = None,
        original_content: str | None = None,
    ) -> IngestionStats:
        """Update an existing document, forcing re-ingestion of new content."""
        resolved_original = original_content if original_content is not None else content
        if resolved_original is None:
            raise ValueError("original_content or content must be provided for update")
        resolved_summary = (
            summary_text
            if summary_text is not None
            else (content if content is not None else "")
        )

        return await self.pipeline.update_document(
            summary_id=summary_id,
            member_code=member_code,
            summary_text=resolved_summary,
            original_content=resolved_original,
            collection_ids=collection_ids,
        )

    async def delete_document(self, summary_id: int) -> IngestionStats:
        """Delete document, parents, and child chunks for a summary."""
        return await self.pipeline.delete_document(summary_id)
