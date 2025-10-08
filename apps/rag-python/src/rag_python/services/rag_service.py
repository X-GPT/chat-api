"""RAG ingestion service with parent-child chunking."""

import uuid
from typing import TypedDict

from llama_index.core import Document, StorageContext, VectorStoreIndex
from llama_index.core.node_parser import SemanticSplitterNodeParser, SentenceSplitter
from llama_index.core.schema import BaseNode
from llama_index.embeddings.openai import OpenAIEmbedding  # type: ignore
from pydantic import BaseModel

from rag_python.config import Settings
from rag_python.core.logging import get_logger
from rag_python.services.qdrant_service import QdrantService

logger = get_logger(__name__)

# Namespace UUID for generating deterministic UUIDs from string IDs
# Using DNS namespace as a base, but any consistent UUID would work
NAMESPACE_UUID = uuid.UUID("6ba7b810-9dad-11d1-80b4-00c04fd430c8")


def generate_uuid_from_string(string_id: str) -> str:
    """Generate a deterministic UUID from a string ID.

    Args:
        string_id: The string ID to convert to UUID.

    Returns:
        A UUID string that Qdrant will accept as a valid point ID.
    """
    return str(uuid.uuid5(NAMESPACE_UUID, string_id))


class IngestionStats(BaseModel):
    summary_id: int | None
    member_code: str | None
    parent_chunks: int | None
    child_chunks: int | None
    total_nodes: int | None
    operation: str | None


class RAGService:
    """Service for RAG document ingestion with hierarchical chunking."""

    def __init__(self, settings: Settings, qdrant_service: QdrantService):
        """Initialize RAG service.

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

        logger.info("RAG service initialized with parent-child chunking")

    async def ingest_document(
        self,
        summary_id: int,
        member_code: str,
        content: str,
    ) -> IngestionStats:
        """Ingest a document with parent-child chunking.

        Args:
            summary_id: The summary ID.
            member_code: The member code for partitioning.
            content: The content to ingest.

        Returns:
            Ingestion statistics.
        """
        try:
            logger.info(
                f"Starting ingestion for summary_id={summary_id}, "
                f"member_code={member_code}, content_length={len(content)}"
            )

            # Ensure collection exists
            await self.qdrant_service.ensure_collection_exists()

            # Create document
            document = Document(
                text=content,
                metadata={
                    "summary_id": summary_id,
                    "member_code": member_code,
                },
            )

            # Step 1: Create parent chunks using semantic splitter
            parent_nodes = self.parent_parser.get_nodes_from_documents([document])
            logger.info(f"Created {len(parent_nodes)} parent nodes")

            # Step 2: Create child chunks from each parent
            all_child_nodes: list[BaseNode] = []

            class ParentChildMap(TypedDict):
                parent: BaseNode
                children: list[BaseNode]

            parent_child_map: dict[str, ParentChildMap] = {}

            for parent_idx, parent_node in enumerate(parent_nodes):
                # Generate unique parent ID as UUID (Qdrant requires UUID or int)
                parent_string_id = f"{summary_id}_parent_{parent_idx}"
                parent_id = generate_uuid_from_string(parent_string_id)
                parent_node.id_ = parent_id

                # Create child chunks from this parent
                child_nodes = self.child_parser.get_nodes_from_documents(
                    [
                        Document(
                            text=parent_node.get_content(),
                            metadata=parent_node.metadata,
                        )
                    ]
                )

                # Link children to parent
                for child_idx, child_node in enumerate(child_nodes):
                    # Generate unique child ID as UUID (Qdrant requires UUID or int)
                    child_string_id = f"{summary_id}_child_{parent_idx}_{child_idx}"
                    child_id = generate_uuid_from_string(child_string_id)
                    child_node.id_ = child_id

                    # Store parent reference in child metadata (parent_id is a UUID string)
                    child_node.metadata["parent_id"] = parent_id
                    child_node.metadata["chunk_index"] = len(all_child_nodes)
                    child_node.metadata["summary_id"] = summary_id
                    child_node.metadata["member_code"] = member_code
                    child_node.metadata["node_type"] = "child"

                    all_child_nodes.append(child_node)

                # Store parent node for later storage
                parent_node.metadata["summary_id"] = summary_id
                parent_node.metadata["member_code"] = member_code
                parent_node.metadata["chunk_index"] = parent_idx
                parent_node.metadata["node_type"] = "parent"

                parent_child_map[parent_id] = {
                    "parent": parent_node,
                    "children": child_nodes,
                }

            logger.info(f"Created {len(all_child_nodes)} child nodes")

            # Step 3: Prepare parent nodes list
            # Parent nodes are stored with metadata but won't be used for direct search
            # They will be retrieved by ID when needed for context expansion
            parent_nodes_list: list[BaseNode] = []
            for parent_id, parent_data in parent_child_map.items():
                parent_nodes_list.append(parent_data["parent"])

            # Step 4: Store ALL nodes (children + parents) with automatic embedding generation
            # VectorStoreIndex will:
            # 1. Generate embeddings for all nodes using embed_model
            # 2. Store them via the vector store with hybrid indexing (dense + sparse BM25)
            all_nodes = all_child_nodes + parent_nodes_list

            storage_context = StorageContext.from_defaults(
                vector_store=self.qdrant_service.vector_store
            )

            # Create index - this automatically generates embeddings and stores to Qdrant
            _index = VectorStoreIndex(
                nodes=all_nodes,
                storage_context=storage_context,
                embed_model=self.embed_model,
                show_progress=True,
            )

            logger.info(
                f"Stored {len(all_nodes)} nodes to Qdrant "
                f"({len(all_child_nodes)} children + {len(parent_nodes_list)} parents)"
            )

            stats = IngestionStats(
                summary_id=summary_id,
                member_code=member_code,
                parent_chunks=len(parent_nodes_list),
                child_chunks=len(all_child_nodes),
                total_nodes=len(all_nodes),
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
    ) -> IngestionStats:
        """Update an existing document.

        Args:
            summary_id: The summary ID.
            member_code: The member code for partitioning.
            content: The new content.

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
            stats = await self.ingest_document(summary_id, member_code, content)
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
