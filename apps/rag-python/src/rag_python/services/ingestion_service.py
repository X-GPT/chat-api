"""Document ingestion service with parent-child chunking."""

import asyncio
from collections.abc import Coroutine
from typing import Any

from llama_index.core import Document, StorageContext, VectorStoreIndex
from llama_index.core.node_parser import SemanticSplitterNodeParser, SentenceSplitter
from llama_index.core.schema import BaseNode
from llama_index.embeddings.openai import OpenAIEmbedding  # type: ignore
from pydantic import BaseModel

from rag_python.config import Settings
from rag_python.core.logging import get_logger
from rag_python.services.qdrant_service import QdrantService

logger = get_logger(__name__)


class IngestionStats(BaseModel):
    summary_id: int | None
    member_code: str | None
    parent_chunks: int | None
    child_chunks: int | None
    total_nodes: int | None
    operation: str | None


class IngestionService:
    """Service for document ingestion with hierarchical chunking."""

    def __init__(self, settings: Settings, qdrant_service: QdrantService):
        """Initialize ingestion service.

        Args:
            settings: Application settings.
            qdrant_service: Qdrant service instance.
        """
        self.settings = settings
        self.qdrant_service = qdrant_service

        # Initialize OpenAI embedding model
        self.embed_model = OpenAIEmbedding(
            api_key=settings.openai_api_key,
            model=settings.openai_embedding_model,
        )

        # Initialize parent chunker (semantic splitter for larger chunks)
        self.parent_parser = SemanticSplitterNodeParser(
            buffer_size=1,
            breakpoint_percentile_threshold=95,
            embed_model=self.embed_model,
        )

        # Initialize child chunker (sentence splitter for smaller chunks)
        self.child_parser = SentenceSplitter(
            chunk_size=settings.chunk_size,
            chunk_overlap=settings.chunk_overlap,
        )

        logger.info("Ingestion service initialized with parent-child chunking")

    async def ingest_document(
        self,
        summary_id: int,
        member_code: str,
        content: str,
        collection_ids: list[int] | None = None,
    ) -> IngestionStats:
        """Ingest a document with parent-child chunking.

        Args:
            summary_id: The summary ID.
            member_code: The member code for partitioning.
            content: The content to ingest.
            collection_ids: List of collection IDs this summary belongs to.

        Returns:
            Ingestion statistics.
        """
        try:
            logger.info(
                f"Starting ingestion for summary_id={summary_id}, "
                f"member_code={member_code}, content_length={len(content)}"
            )

            # Ensure collections exist with proper configuration and payload indexes
            await self.qdrant_service.ensure_collection_exists()

            # Create document
            document = Document(
                text=content,
                metadata={
                    "summary_id": summary_id,
                    "member_code": member_code,
                    "collection_ids": collection_ids or [],
                },
            )

            # Step 1: Create parent chunks using semantic splitter
            parent_nodes = await self.parent_parser.aget_nodes_from_documents([document])
            logger.info(f"Created {len(parent_nodes)} parent nodes")

            # Step 2: Create child chunks from each parent
            all_child_nodes: list[BaseNode] = []

            child_nodes_tasks: list[Coroutine[Any, Any, list[BaseNode]]] = [
                self.child_parser.aget_nodes_from_documents(
                    [
                        Document(
                            text=parent_node.get_content(),
                            metadata=parent_node.metadata,
                        )
                    ]
                )
                for parent_node in parent_nodes
            ]

            child_nodes_per_parent = await asyncio.gather(*child_nodes_tasks)

            for parent_idx, parent_node in enumerate(parent_nodes):
                # Create child chunks from this parent
                child_nodes = child_nodes_per_parent[parent_idx]
                if not child_nodes:
                    continue

                # Link children to parent
                for child_node in child_nodes:
                    child_node.metadata["parent_id"] = parent_node.id_
                    child_node.metadata["chunk_index"] = len(all_child_nodes)
                    child_node.metadata["summary_id"] = summary_id
                    child_node.metadata["member_code"] = member_code
                    child_node.metadata["collection_ids"] = collection_ids or []

                    all_child_nodes.append(child_node)

                # Store parent node for later storage
                parent_node.metadata["summary_id"] = summary_id
                parent_node.metadata["member_code"] = member_code
                parent_node.metadata["chunk_index"] = parent_idx
                parent_node.metadata["collection_ids"] = collection_ids or []

            logger.info(f"Created {len(all_child_nodes)} child nodes")

            # Step 3: Store child and parent nodes to separate collections
            # VectorStoreIndex will:
            # 1. Generate embeddings for all nodes using embed_model
            # 2. Store them via the vector store with appropriate indexing

            # Store child nodes to children collection (with hybrid indexing)
            children_storage_context = StorageContext.from_defaults(
                vector_store=self.qdrant_service.children_vector_store
            )
            _children_index = VectorStoreIndex(
                nodes=all_child_nodes,
                storage_context=children_storage_context,
                embed_model=self.embed_model,
                show_progress=True,
                use_async=True,
            )

            logger.info(
                f"Stored {len(all_child_nodes)} child nodes to "
                f"{self.qdrant_service.children_collection_name}"
            )

            # Store parent nodes to parents collection (dense embeddings only)
            parents_storage_context = StorageContext.from_defaults(
                vector_store=self.qdrant_service.parents_vector_store
            )
            _parents_index = VectorStoreIndex(
                nodes=parent_nodes,
                storage_context=parents_storage_context,
                embed_model=self.embed_model,
                show_progress=True,
                use_async=True,
            )

            logger.info(
                f"Stored {len(parent_nodes)} parent nodes to "
                f"{self.qdrant_service.parents_collection_name}"
            )

            stats = IngestionStats(
                summary_id=summary_id,
                member_code=member_code,
                parent_chunks=len(parent_nodes),
                child_chunks=len(all_child_nodes),
                total_nodes=len(all_child_nodes) + len(parent_nodes),
                operation=None,
            )

            logger.info(f"Ingestion completed: {stats}")
            return stats

        except Exception as e:
            logger.error(f"Error ingesting document: {e}", exc_info=True)
            raise

    async def update_document(
        self,
        summary_id: int,
        member_code: str,
        content: str,
        collection_ids: list[int] | None = None,
    ) -> IngestionStats:
        """Update an existing document.

        Args:
            summary_id: The summary ID.
            member_code: The member code for partitioning.
            content: The new content.
            collection_ids: List of collection IDs this summary belongs to.

        Returns:
            Ingestion statistics.
        """
        try:
            logger.info(f"Updating document for summary_id={summary_id}")

            collection_exists = await self.qdrant_service.collection_exists()
            # If collection exists, delete old version
            if collection_exists:
                logger.info("Collection exists, deleting old version")
                await self.delete_document(summary_id)

            # Ingest new version
            stats = await self.ingest_document(summary_id, member_code, content, collection_ids)
            stats.operation = "update"

            return stats

        except Exception as e:
            logger.error(f"Error updating document: {e}", exc_info=True)
            raise

    async def delete_document(self, summary_id: int) -> IngestionStats:
        """Delete a document and all its chunks.

        Args:
            summary_id: The summary ID to delete.

        Returns:
            Dictionary with deletion statistics.
        """
        try:
            logger.info(f"Deleting document for summary_id={summary_id}")

            await self.qdrant_service.delete_by_summary_id(summary_id)

            stats = IngestionStats(
                summary_id=summary_id,
                member_code=None,
                parent_chunks=None,
                child_chunks=None,
                total_nodes=None,
                operation="delete",
            )

            logger.info(f"Deletion completed: {stats}")
            return stats

        except Exception as e:
            logger.error(f"Error deleting document: {e}", exc_info=True)
            raise
