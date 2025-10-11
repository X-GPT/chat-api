"""Qdrant vector database service."""

import json
from typing import Any, TypeGuard

from llama_index.core import Settings as LlamaIndexSettings
from llama_index.core import VectorStoreIndex
from llama_index.core.schema import BaseNode, TextNode
from llama_index.embeddings.openai import OpenAIEmbedding  # type: ignore
from llama_index.vector_stores.qdrant import QdrantVectorStore  # type: ignore
from pydantic import BaseModel
from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client.models import (
    CollectionStatus,
    ExtendedPointId,
    FieldCondition,
    Filter,
    MatchValue,
    Payload,
    PayloadSchemaType,
    PointIdsList,
)

from rag_python.config import Settings
from rag_python.core.logging import get_logger

logger = get_logger(__name__)


def is_list_of_ints(x: Any) -> TypeGuard[list[int]]:
    """Type guard to check if a value is a list of integers.

    Args:
        x: Value to check.

    Returns:
        True if x is a list containing only integers.
    """
    return isinstance(x, list) and all(isinstance(item, int) for item in x)  # pyright: ignore[reportUnknownVariableType]


class SearchResult(BaseModel):
    id: ExtendedPointId
    score: float
    payload: Payload | None


class CollectionInfo(BaseModel):
    name: str
    vectors_count: int | None
    points_count: int | None
    status: CollectionStatus


class QdrantService:
    """Service for managing Qdrant vector database operations."""

    def __init__(self, settings: Settings):
        """Initialize Qdrant service.

        Args:
            settings: Application settings.

        Raises:
            ValueError: If required Qdrant configuration is missing or invalid.
        """
        self.settings = settings
        self.children_collection_name = settings.qdrant_children_collection
        self.parents_collection_name = settings.qdrant_parents_collection
        self.vector_size = 1536  # text-embedding-3-small dimension

        # Validate required Qdrant configuration early
        self._validate_config()

        # Initialize both sync and async Qdrant clients
        # LlamaIndex QdrantVectorStore requires both for initialization
        self.client = QdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            prefer_grpc=settings.qdrant_prefer_grpc,
        )

        self.aclient = AsyncQdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            prefer_grpc=settings.qdrant_prefer_grpc,
        )

        # Initialize children vector store with hybrid search enabled
        self.children_vector_store = QdrantVectorStore(
            collection_name=self.children_collection_name,
            client=self.client,
            aclient=self.aclient,
            enable_hybrid=True,
            fastembed_sparse_model="Qdrant/bm25",
            batch_size=20,
        )

        # Initialize parents vector store (no hybrid, just dense embeddings)
        self.parents_vector_store = QdrantVectorStore(
            collection_name=self.parents_collection_name,
            client=self.client,
            aclient=self.aclient,
            enable_hybrid=False,
            batch_size=20,
        )

        self.embed_model = OpenAIEmbedding(
            api_key=self.settings.openai_api_key,
            model=self.settings.openai_embedding_model,
        )

        # Set global LlamaIndex settings once during initialization
        LlamaIndexSettings.embed_model = self.embed_model

        logger.info(
            f"Qdrant vector stores initialized: "
            f"children={self.children_collection_name} (hybrid search), "
            f"parents={self.parents_collection_name} (dense only)"
        )

    def _validate_config(self) -> None:
        """Validate Qdrant configuration.

        Raises:
            ValueError: If required configuration is missing or invalid.
        """
        errors: list[str] = []

        # Check QDRANT_URL
        if not self.settings.qdrant_url:
            errors.append("QDRANT_URL is not set")
        elif self.settings.qdrant_url == "https://your-cluster.qdrant.io":
            errors.append(
                "QDRANT_URL is set to the default placeholder value. "
                "Please set it to your actual Qdrant instance URL"
            )

        # Check QDRANT_API_KEY
        if not self.settings.qdrant_api_key:
            errors.append("QDRANT_API_KEY is not set")

        # Check collection prefix
        if not self.settings.qdrant_collection_prefix:
            errors.append("QDRANT_COLLECTION_PREFIX is not set")

        if errors:
            error_msg = "Qdrant configuration validation failed:\n" + "\n".join(
                f"  - {err}" for err in errors
            )
            logger.error(error_msg)
            raise ValueError(error_msg)

    async def collection_exists(self) -> bool:
        """Check if both collections exist."""
        children_exists = await self.aclient.collection_exists(
            collection_name=self.children_collection_name
        )
        parents_exists = await self.aclient.collection_exists(
            collection_name=self.parents_collection_name
        )
        return children_exists and parents_exists

    async def ensure_collection_exists(self) -> None:
        """Ensure both collections exist with proper configuration.

        QdrantVectorStore automatically creates collections with proper
        configuration when adding documents, so we just verify they're accessible.
        """
        try:
            # Check if collections exist
            collections = await self.aclient.get_collections()
            collection_names = [c.name for c in collections.collections]

            # Check children collection
            if self.children_collection_name in collection_names:
                logger.info(f"Collection {self.children_collection_name} already exists")
            else:
                logger.info(
                    f"Collection {self.children_collection_name} "
                    f"will be created on first document insert"
                )

            # Check parents collection
            if self.parents_collection_name in collection_names:
                logger.info(f"Collection {self.parents_collection_name} already exists")
            else:
                logger.info(
                    f"Collection {self.parents_collection_name} "
                    f"will be created on first document insert"
                )

        except Exception as e:
            logger.error(f"Error ensuring collections exist: {e}")
            raise

    async def ensure_payload_indexes(self) -> None:
        """Ensure payload indexes exist for filterable fields.

        Creates indexes for:
        - member_code (keyword) - for filtering by member
        - summary_id (integer) - for filtering by summary
        - collection_ids (integer array) - for filtering by collection membership
        """
        try:
            # Check if collections exist first
            collections = await self.aclient.get_collections()
            collection_names = [c.name for c in collections.collections]

            # Create indexes for children collection (where we do the filtering)
            if self.children_collection_name in collection_names:
                logger.info(f"Ensuring payload indexes for {self.children_collection_name}")

                # Create index for member_code (keyword filter)
                await self.aclient.create_payload_index(
                    collection_name=self.children_collection_name,
                    field_name="member_code",
                    field_schema=PayloadSchemaType.KEYWORD,
                )
                logger.info(
                    f"Created/verified member_code index on {self.children_collection_name}"
                )

                # Create index for summary_id (integer filter)
                await self.aclient.create_payload_index(
                    collection_name=self.children_collection_name,
                    field_name="summary_id",
                    field_schema=PayloadSchemaType.INTEGER,
                )
                logger.info(f"Created/verified summary_id index on {self.children_collection_name}")

                # Create index for collection_ids (integer array filter)
                await self.aclient.create_payload_index(
                    collection_name=self.children_collection_name,
                    field_name="collection_ids",
                    field_schema=PayloadSchemaType.INTEGER,
                )
                logger.info(
                    f"Created/verified collection_ids index on {self.children_collection_name}"
                )

            # Create indexes for parents collection (for consistency)
            if self.parents_collection_name in collection_names:
                logger.info(f"Ensuring payload indexes for {self.parents_collection_name}")

                await self.aclient.create_payload_index(
                    collection_name=self.parents_collection_name,
                    field_name="member_code",
                    field_schema=PayloadSchemaType.KEYWORD,
                )
                logger.info(f"Created/verified member_code index on {self.parents_collection_name}")

                await self.aclient.create_payload_index(
                    collection_name=self.parents_collection_name,
                    field_name="summary_id",
                    field_schema=PayloadSchemaType.INTEGER,
                )
                logger.info(f"Created/verified summary_id index on {self.parents_collection_name}")

                await self.aclient.create_payload_index(
                    collection_name=self.parents_collection_name,
                    field_name="collection_ids",
                    field_schema=PayloadSchemaType.INTEGER,
                )
                logger.info(
                    f"Created/verified collection_ids index on {self.parents_collection_name}"
                )

        except Exception as e:
            # Log but don't fail - indexes might already exist
            logger.warning(f"Warning while ensuring payload indexes: {e}")
            logger.info("Indexes will be created after collections are populated")

    async def delete_by_summary_id(self, summary_id: int) -> None:
        """Delete all points associated with a summary ID from both collections.

        Args:
            summary_id: The summary ID to filter by.
        """
        try:
            # Delete from children collection
            await self.aclient.delete(
                collection_name=self.children_collection_name,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key="summary_id",
                            match=MatchValue(value=summary_id),
                        )
                    ]
                ),
            )
            # Delete from parents collection
            await self.aclient.delete(
                collection_name=self.parents_collection_name,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key="summary_id",
                            match=MatchValue(value=summary_id),
                        )
                    ]
                ),
            )
            logger.info(f"Deleted all points for summary_id {summary_id} from both collections")
        except Exception as e:
            logger.error(f"Error deleting points for summary_id {summary_id}: {e}")
            raise

    async def get_collection_ids(self, summary_id: int) -> list[int]:
        """Get current collection_ids for a summary.

        Args:
            summary_id: The summary ID to query.

        Returns:
            List of collection IDs, or empty list if summary not found.
        """
        try:
            # Query one point from children collection to get current collection_ids
            scroll_result = await self.aclient.scroll(
                collection_name=self.children_collection_name,
                scroll_filter=Filter(
                    must=[
                        FieldCondition(
                            key="summary_id",
                            match=MatchValue(value=summary_id),
                        )
                    ]
                ),
                limit=1,
                with_payload=True,
                with_vectors=False,
            )

            points, _ = scroll_result  # scroll returns (points, next_offset)
            if not points:
                logger.info(f"No points found for summary_id={summary_id}, returning empty list")
                return []

            # Extract collection_ids from payload
            point_payload = points[0].payload
            if not point_payload:
                return []

            collection_ids_raw = point_payload.get("collection_ids")
            if not collection_ids_raw:
                return []

            # Type guard: check if it's a list of ints
            if is_list_of_ints(collection_ids_raw):
                # Type checker now knows this is list[int]
                return collection_ids_raw

            # If it's not a proper list[int], fail fast
            raise TypeError(
                f"collection_ids has invalid type: expected list[int], "
                f"got {type(collection_ids_raw).__name__}"
            )

        except Exception as e:
            logger.error(f"Error getting collection_ids for summary_id {summary_id}: {e}")
            # Return empty list on error rather than raising
            return []

    async def update_collection_ids(self, summary_id: int, collection_ids: list[int]) -> None:
        """Update collection_ids metadata for all points associated with a summary ID.

        Args:
            summary_id: The summary ID to filter by.
            collection_ids: The list of collection IDs to set.
        """
        try:
            # Update children collection
            await self.aclient.set_payload(
                collection_name=self.children_collection_name,
                payload={"collection_ids": collection_ids},
                points=Filter(
                    must=[
                        FieldCondition(
                            key="summary_id",
                            match=MatchValue(value=summary_id),
                        )
                    ]
                ),
            )
            logger.info(
                f"Updated collection_ids for summary_id={summary_id} "
                f"in {self.children_collection_name}"
            )

            # Update parents collection
            await self.aclient.set_payload(
                collection_name=self.parents_collection_name,
                payload={"collection_ids": collection_ids},
                points=Filter(
                    must=[
                        FieldCondition(
                            key="summary_id",
                            match=MatchValue(value=summary_id),
                        )
                    ]
                ),
            )
            logger.info(
                f"Updated collection_ids for summary_id={summary_id} "
                f"in {self.parents_collection_name}"
            )
        except Exception as e:
            logger.error(f"Error updating collection_ids for summary_id {summary_id}: {e}")
            raise

    async def delete_by_ids(
        self,
        point_ids: list[ExtendedPointId],
        collection: str = "both",
    ) -> None:
        """Delete points by their IDs from specified collection(s).

        Args:
            point_ids: List of point IDs to delete.
            collection: Which collection to delete from ("children", "parents", or "both").
        """
        try:
            if collection in ("children", "both"):
                await self.aclient.delete(
                    collection_name=self.children_collection_name,
                    points_selector=PointIdsList(points=point_ids),
                )
                logger.info(f"Deleted {len(point_ids)} points from {self.children_collection_name}")

            if collection in ("parents", "both"):
                await self.aclient.delete(
                    collection_name=self.parents_collection_name,
                    points_selector=PointIdsList(points=point_ids),
                )
                logger.info(f"Deleted {len(point_ids)} points from {self.parents_collection_name}")
        except Exception as e:
            logger.error(f"Error deleting points by IDs: {e}")
            raise

    async def search(
        self,
        query: str,
        member_code: str | None = None,
        collection_ids: list[int] | None = None,
        limit: int = 10,
        sparse_top_k: int = 10,
    ) -> list[SearchResult]:
        """Search for similar vectors using hybrid search on children collection.

        Args:
            query: The query string to search with.
            member_code: Optional member code to filter by.
            collection_ids: Optional list of collection IDs to filter by (ANY match).
            limit: Maximum number of results to return.
            sparse_top_k: Number of results from sparse (BM25) search.

        Returns:
            List of search results with scores and payloads.
        """
        try:
            # Build metadata filters for LlamaIndex
            from llama_index.core.vector_stores import (
                FilterCondition,
                FilterOperator,
                MetadataFilter,
                MetadataFilters,
            )

            filter_list: list[MetadataFilter | MetadataFilters] = []
            if member_code:
                filter_list.append(
                    MetadataFilter(
                        key="member_code",
                        value=member_code,
                        operator=FilterOperator.EQ,
                    )
                )

            # Filter by collection membership (ANY of the collection IDs)
            if collection_ids:
                # Use IN operator for array membership checking
                # This should translate to Qdrant's MatchAny condition
                # Matches if the document's collection_ids array contains ANY of the specified IDs
                filter_list.append(
                    MetadataFilter(
                        key="collection_ids",
                        value=collection_ids,
                        operator=FilterOperator.IN,
                    )
                )

            metadata_filters = (
                MetadataFilters(
                    filters=filter_list,
                    condition=FilterCondition.AND,
                )
                if filter_list
                else None
            )

            # Perform hybrid search on children collection
            index = VectorStoreIndex.from_vector_store(self.children_vector_store)  # pyright: ignore[reportUnknownMemberType]
            result = await index.as_retriever(
                filters=metadata_filters,
                sparse_top_k=sparse_top_k,
                similarity_top_k=limit,
                hybrid_top_k=limit,
            ).aretrieve(query)

            logger.info(
                f"Hybrid search on children collection found {len(result) if result else 0} results"
            )

            # Convert to SearchResult format
            search_results: list[SearchResult] = []
            if result:
                for node in result:
                    search_results.append(
                        SearchResult(
                            id=node.node_id,
                            score=node.score if node.score else 0.0,
                            payload=node.metadata,
                        )
                    )

            return search_results

        except Exception as e:
            logger.error(f"Error performing hybrid search: {e}")
            raise

    async def get_collection_info(self, collection: str = "children") -> CollectionInfo:
        """Get collection information.

        Args:
            collection: Which collection to get info for ("children" or "parents").

        Returns:
            Dictionary with collection information.
        """
        try:
            collection_name = (
                self.children_collection_name
                if collection == "children"
                else self.parents_collection_name
            )
            info = await self.aclient.get_collection(collection_name=collection_name)
            return CollectionInfo(
                name=collection_name,
                vectors_count=info.vectors_count,
                points_count=info.points_count,
                status=info.status,
            )
        except Exception as e:
            logger.error(f"Error getting collection info: {e}")
            raise

    async def get_node_by_id(self, node_id: str) -> BaseNode | None:
        """Retrieve a parent node by its ID.

        Args:
            node_id: The ID of the parent node to retrieve.

        Returns:
            The parent node if found, None otherwise.
        """
        try:
            points = await self.aclient.retrieve(
                collection_name=self.parents_collection_name,
                ids=[node_id],
            )

            if not points:
                return None

            point = points[0]
            # Reconstruct node from point payload
            payload = point.payload if point.payload else {}

            # LlamaIndex stores node content in the "_node_content" field as JSON
            # If not present, fall back to "text" or "content" fields
            text_content = ""
            if "_node_content" in payload:
                node_data = json.loads(payload["_node_content"])
                text_content = node_data.get("text", "")
            else:
                text_content = payload.get("text", payload.get("content", ""))

            # Extract metadata (excluding internal fields)
            metadata = {k: v for k, v in payload.items() if not k.startswith("_")}

            node = TextNode(
                id_=str(point.id),
                text=text_content,
                metadata=metadata,
            )
            return node
        except Exception as e:
            logger.error(f"Error retrieving parent node by ID: {e}", exc_info=True)
            raise

    async def get_child_by_id(self, node_id: str) -> BaseNode | None:
        """Retrieve a child node by its ID.

        Args:
            node_id: The ID of the child node to retrieve.

        Returns:
            The child node if found, None otherwise.
        """
        try:
            points = await self.aclient.retrieve(
                collection_name=self.children_collection_name,
                ids=[node_id],
            )

            if not points:
                return None

            point = points[0]
            # Reconstruct node from point payload
            payload = point.payload if point.payload else {}

            # LlamaIndex stores node content in the "_node_content" field as JSON
            # If not present, fall back to "text" or "content" fields
            text_content = ""
            if "_node_content" in payload:
                node_data = json.loads(payload["_node_content"])
                text_content = node_data.get("text", "")
            else:
                text_content = payload.get("text", payload.get("content", ""))

            # Extract metadata (excluding internal fields)
            metadata = {k: v for k, v in payload.items() if not k.startswith("_")}

            node = TextNode(
                id_=str(point.id),
                text=text_content,
                metadata=metadata,
            )
            return node
        except Exception as e:
            logger.error(f"Error retrieving child node by ID: {e}", exc_info=True)
            raise
