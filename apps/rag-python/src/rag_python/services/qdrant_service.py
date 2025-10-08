"""Qdrant vector database service."""

from collections.abc import Sequence

from llama_index.core.schema import BaseNode, TextNode
from llama_index.core.vector_stores import VectorStoreQuery
from llama_index.core.vector_stores.types import VectorStoreQueryMode
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
    PointIdsList,
)

from rag_python.config import Settings
from rag_python.core.logging import get_logger

logger = get_logger(__name__)


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
        """
        self.settings = settings
        self.collection_name = settings.qdrant_collection_name
        self.vector_size = 1536  # text-embedding-3-small dimension

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

        # Initialize QdrantVectorStore with hybrid search enabled
        # Both client and aclient are needed for proper initialization
        self.vector_store = QdrantVectorStore(
            collection_name=self.collection_name,
            client=self.client,
            aclient=self.aclient,
            enable_hybrid=True,
            fastembed_sparse_model="Qdrant/bm25",
            batch_size=20,
        )

        logger.info(
            f"Qdrant vector store initialized with hybrid search "
            f"for collection: {self.collection_name}"
        )

    async def ensure_collection_exists(self) -> None:
        """Ensure the collection exists with proper configuration.

        QdrantVectorStore automatically creates the collection with hybrid search
        configuration when adding documents, so we just verify it's accessible.
        """
        try:
            # Check if collection exists
            collections = await self.aclient.get_collections()
            collection_names = [c.name for c in collections.collections]

            if self.collection_name in collection_names:
                logger.info(f"Collection {self.collection_name} already exists")
            else:
                logger.info(
                    f"Collection {self.collection_name} will be created on first document insert"
                )

        except Exception as e:
            logger.error(f"Error ensuring collection exists: {e}")
            raise

    async def add_nodes(
        self,
        nodes: Sequence[BaseNode],
    ) -> list[str]:
        """Add nodes to the vector store with hybrid indexing.

        Args:
            nodes: List of nodes to add.

        Returns:
            List of node IDs that were added.
        """
        try:
            node_ids = await self.vector_store.async_add(nodes=list(nodes))
            logger.info(f"Added {len(nodes)} nodes with hybrid indexing to {self.collection_name}")
            return node_ids
        except Exception as e:
            logger.error(f"Error adding nodes: {e}")
            raise

    async def delete_by_summary_id(self, summary_id: int) -> None:
        """Delete all points associated with a summary ID.

        Args:
            summary_id: The summary ID to filter by.
        """
        try:
            await self.aclient.delete(
                collection_name=self.collection_name,
                points_selector=Filter(
                    must=[
                        FieldCondition(
                            key="summary_id",
                            match=MatchValue(value=summary_id),
                        )
                    ]
                ),
            )
            logger.info(f"Deleted all points for summary_id: {summary_id}")
        except Exception as e:
            logger.error(f"Error deleting points for summary_id {summary_id}: {e}")
            raise

    async def delete_by_ids(self, point_ids: list[ExtendedPointId]) -> None:
        """Delete points by their IDs.

        Args:
            point_ids: List of point IDs to delete.
        """
        try:
            await self.aclient.delete(
                collection_name=self.collection_name,
                points_selector=PointIdsList(points=point_ids),
            )
            logger.info(f"Deleted {len(point_ids)} points from {self.collection_name}")
        except Exception as e:
            logger.error(f"Error deleting points by IDs: {e}")
            raise

    async def search(
        self,
        query_vector: list[float],
        member_code: str | None = None,
        limit: int = 10,
        sparse_top_k: int = 10,
        node_type: str = "child",
    ) -> list[SearchResult]:
        """Search for similar vectors using hybrid search.

        Args:
            query_vector: The query vector to search with.
            member_code: Optional member code to filter by.
            limit: Maximum number of results to return.
            sparse_top_k: Number of results from sparse (BM25) search.
            node_type: Type of node to search (default: "child").

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
            # Always filter by node_type for child nodes
            filter_list.append(
                MetadataFilter(
                    key="node_type",
                    value=node_type,
                    operator=FilterOperator.EQ,
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

            # Create vector store query for hybrid search
            query = VectorStoreQuery(
                query_embedding=query_vector,
                similarity_top_k=limit,
                mode=VectorStoreQueryMode.HYBRID,
                sparse_top_k=sparse_top_k,
                filters=metadata_filters,
            )

            # Perform hybrid search
            result = await self.vector_store.aquery(query)

            logger.info(f"Hybrid search found {len(result.nodes) if result.nodes else 0} results")

            # Convert to SearchResult format
            search_results: list[SearchResult] = []
            if result.nodes and result.similarities:
                for node, score in zip(result.nodes, result.similarities):
                    search_results.append(
                        SearchResult(
                            id=node.node_id,
                            score=score,
                            payload=node.metadata,
                        )
                    )

            return search_results

        except Exception as e:
            logger.error(f"Error performing hybrid search: {e}")
            raise

    async def get_collection_info(self) -> CollectionInfo:
        """Get collection information.

        Returns:
            Dictionary with collection information.
        """
        try:
            info = await self.aclient.get_collection(collection_name=self.collection_name)
            return CollectionInfo(
                name=self.collection_name,
                vectors_count=info.vectors_count,
                points_count=info.points_count,
                status=info.status,
            )
        except Exception as e:
            logger.error(f"Error getting collection info: {e}")
            raise

    async def get_node_by_id(self, node_id: str) -> BaseNode | None:
        """Retrieve a node by its ID (useful for fetching parent nodes).

        Args:
            node_id: The ID of the node to retrieve.

        Returns:
            The node if found, None otherwise.
        """
        try:
            points = await self.aclient.retrieve(
                collection_name=self.collection_name,
                ids=[node_id],
            )

            if not points:
                return None

            point = points[0]
            # Reconstruct node from point payload
            payload = point.payload if point.payload else {}
            node = TextNode(
                id_=str(point.id),
                text=payload.get("text", ""),
                metadata=payload,
            )
            return node
        except Exception as e:
            logger.error(f"Error retrieving node by ID: {e}")
            raise
