"""Unit tests for the ingestion service facade."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from rag_python.config import Settings
from rag_python.services.pipeline import IngestionStats
from rag_python.services.qdrant_service import QdrantService


@pytest.fixture
def settings() -> Settings:
    """Return settings configured for tests."""
    return Settings(
        openai_api_key="test-key",
        openai_embedding_model="text-embedding-3-small",
        qdrant_url="http://localhost:6333",
        qdrant_api_key="test-qdrant-key",
        qdrant_collection_name="test-collection",
        chunk_size=256,
        chunk_overlap=64,
    )


@pytest.fixture
def qdrant_service(settings: Settings) -> QdrantService:
    """Create a QdrantService with mocked clients."""
    with (
        patch("rag_python.services.qdrant_service.QdrantClient") as mock_client_cls,
        patch("rag_python.services.qdrant_service.AsyncQdrantClient") as mock_async_cls,
    ):
        mock_client_cls.return_value = MagicMock()
        mock_async = MagicMock()
        mock_async.collection_exists = AsyncMock(return_value=True)
        mock_async.create_collection = AsyncMock()
        mock_async.create_payload_index = AsyncMock()
        mock_async.upsert = AsyncMock()
        mock_async.delete = AsyncMock()
        mock_async.set_payload = AsyncMock()
        mock_async.retrieve = AsyncMock()
        mock_async.scroll = AsyncMock()
        mock_async_cls.return_value = mock_async

        service = QdrantService(settings)
        service.ensure_collection_exists = AsyncMock()
        return service


@pytest.fixture
def ingestion_service(
    settings: Settings,
    qdrant_service: QdrantService,
) -> tuple["IngestionService", MagicMock]:
    """Instantiate IngestionService with patched dependencies."""

    with (
        patch("rag_python.services.ingestion_service.LlamaIndexSettings") as mock_settings,
        patch("rag_python.services.ingestion_service.OpenAIEmbedding") as mock_embedding,
        patch("rag_python.services.ingestion_service.SemanticSplitterNodeParser") as mock_parent_parser,
        patch("rag_python.services.ingestion_service.SentenceSplitter") as mock_child_parser,
        patch("rag_python.services.ingestion_service.QdrantVectorStore") as mock_vector_store,
        patch("rag_python.services.ingestion_service.IngestionPipeline") as mock_pipeline_cls,
    ):
        mock_settings.embed_model = MagicMock()
        mock_embedding.return_value = MagicMock()
        mock_parent_parser.return_value = MagicMock()
        mock_child_parser.return_value = MagicMock()
        mock_vector_store.return_value = MagicMock()

        pipeline_instance = MagicMock()
        pipeline_instance.ingest_document = AsyncMock(
            return_value=IngestionStats(
                summary_id=42,
                member_code="tenant",
                parent_chunks=1,
                child_chunks=2,
                total_nodes=3,
                operation="create",
            )
        )
        pipeline_instance.update_document = AsyncMock(
            return_value=IngestionStats(
                summary_id=42,
                member_code="tenant",
                parent_chunks=2,
                child_chunks=4,
                total_nodes=6,
                operation="update",
            )
        )
        pipeline_instance.delete_document = AsyncMock(
            return_value=IngestionStats(
                summary_id=42,
                member_code=None,
                parent_chunks=None,
                child_chunks=None,
                total_nodes=None,
                operation="delete",
            )
        )

        mock_pipeline_cls.return_value = pipeline_instance

        from rag_python.services.ingestion_service import IngestionService

        service = IngestionService(settings, qdrant_service)
        return service, pipeline_instance


@pytest.mark.asyncio
async def test_ingest_document_delegates_to_pipeline(
    ingestion_service: tuple["IngestionService", MagicMock],
    qdrant_service: QdrantService,
) -> None:
    """ingest_document should delegate to the pipeline without schema setup."""
    service, pipeline = ingestion_service

    result = await service.ingest_document(
        summary_id=101,
        member_code="tenant-a",
        content="Full original content",
        collection_ids=[1, 2],
        summary_text="Short summary",
    )

    qdrant_service.ensure_collection_exists.assert_not_called()
    pipeline.ingest_document.assert_awaited_once_with(
        summary_id=101,
        member_code="tenant-a",
        summary_text="Short summary",
        original_content="Full original content",
        collection_ids=[1, 2],
    )
    assert result.operation == "create"


@pytest.mark.asyncio
async def test_ingest_document_uses_content_when_summary_missing(
    ingestion_service: tuple["IngestionService", MagicMock],
) -> None:
    """If summary_text not provided, the service should fall back to content."""
    service, pipeline = ingestion_service

    await service.ingest_document(
        summary_id=7,
        member_code="tenant-b",
        content="Original body",
    )

    args = pipeline.ingest_document.await_args_list[0].kwargs
    assert args["summary_text"] == "Original body"
    assert args["original_content"] == "Original body"


@pytest.mark.asyncio
async def test_ingest_document_requires_content(
    ingestion_service: tuple["IngestionService", MagicMock],
) -> None:
    """The service should raise if neither content nor original_content provided."""
    service, _ = ingestion_service

    with pytest.raises(ValueError):
        await service.ingest_document(
            summary_id=9,
            member_code="tenant-c",
            content=None,
            summary_text=None,
            original_content=None,
        )


@pytest.mark.asyncio
async def test_update_document_delegates_to_pipeline(
    ingestion_service: tuple["IngestionService", MagicMock],
    qdrant_service: QdrantService,
) -> None:
    """update_document should delegate to the pipeline without schema setup."""
    service, pipeline = ingestion_service

    result = await service.update_document(
        summary_id=55,
        member_code="tenant-x",
        original_content="Updated body",
        summary_text="Updated summary",
    )

    qdrant_service.ensure_collection_exists.assert_not_called()
    pipeline.update_document.assert_awaited_once_with(
        summary_id=55,
        member_code="tenant-x",
        summary_text="Updated summary",
        original_content="Updated body",
        collection_ids=None,
    )
    assert result.operation == "update"


@pytest.mark.asyncio
async def test_delete_document_delegates_to_pipeline(
    ingestion_service: tuple["IngestionService", MagicMock],
    qdrant_service: QdrantService,
) -> None:
    """delete_document should delegate to the pipeline without schema setup."""
    service, pipeline = ingestion_service

    result = await service.delete_document(summary_id=321)

    qdrant_service.ensure_collection_exists.assert_not_called()
    pipeline.delete_document.assert_awaited_once_with(321)
    assert result.operation == "delete"
