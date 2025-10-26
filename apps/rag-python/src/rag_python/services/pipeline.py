"""Document ingestion pipeline built on top of LlamaIndex and Qdrant."""

from __future__ import annotations

import asyncio
from collections.abc import Coroutine, Sequence
from dataclasses import dataclass
from typing import Any

from llama_index.core import Document, StorageContext, VectorStoreIndex
from llama_index.core.node_parser import SemanticSplitterNodeParser, SentenceSplitter
from llama_index.core.schema import BaseNode
from llama_index.vector_stores.qdrant import QdrantVectorStore  # type: ignore

from rag_python.core.logging import get_logger
from rag_python.core.models import Parent
from rag_python.repositories.vector_repository import VectorRepository
from rag_python.services.document_builders import build_child_docs
from rag_python.services.point_ids import chunk_point_id, parent_point_id
from rag_python.text_processing.checksum import compute_checksum
from rag_python.text_processing.normalize_text import normalize_text
from rag_python.text_processing.token_estimator import estimate_tokens

logger = get_logger(__name__)

sem = asyncio.Semaphore(8)  # tune this (4–16 is a good start)


async def bounded(coro: Coroutine[Any, Any, Any]) -> Any:
    async with sem:
        return await coro


@dataclass(slots=True)
class IngestionStats:
    """High-level ingestion operation statistics."""

    summary_id: int | None
    member_code: str | None
    parent_chunks: int | None
    child_chunks: int | None
    total_nodes: int | None
    operation: str | None


class IngestionPipeline:
    """Pipeline responsible for normalizing, chunking, and persisting documents."""

    def __init__(
        self,
        *,
        vector_repository: VectorRepository,
        parent_parser: SemanticSplitterNodeParser,
        child_parser: SentenceSplitter,
        child_vector_store: QdrantVectorStore,
        max_tokens_before_split: int = 2500,
        warn_child_nodes_over: int = 60,
    ) -> None:
        self._vector_repository = vector_repository
        self._parent_parser = parent_parser
        self._child_parser = child_parser
        self._child_vector_store = child_vector_store
        self._max_tokens_before_split = max_tokens_before_split
        self._warn_child_nodes_over = warn_child_nodes_over

    async def ingest_document(
        self,
        *,
        summary_id: int,
        member_code: str,
        original_content: str,
        collection_ids: Sequence[int] | None = None,
    ) -> IngestionStats:
        """Ingest a document with parent-child chunking and idempotent writes."""
        try:
            collection_ids_list = list(collection_ids or [])

            logger.info(
                "Starting ingestion summary_id=%s member_code=%s content_length=%s",
                summary_id,
                member_code,
                len(original_content),
            )

            normalized_content = normalize_text(original_content)
            if not normalized_content.strip():
                logger.info(
                    "Empty content after normalization; skipping ingestion for summary_id=%s",
                    summary_id,
                )
                return IngestionStats(
                    summary_id=summary_id,
                    member_code=member_code,
                    parent_chunks=0,
                    child_chunks=0,
                    total_nodes=0,
                    operation="skipped",
                )

            checksum = compute_checksum(normalized_content)
            logger.info("Computed checksum for summary_id=%s: %s", summary_id, checksum)

            # TODO: Uncomment this when migration is complete
            # existing_checksum = await self._vector_repository.get_existing_checksum(summary_id)
            # if existing_checksum == checksum:
            #     logger.info(
            #         "Content unchanged for summary_id=%s (checksum=%s), skipping ingestion",
            #         summary_id,
            #         checksum[:8],
            #     )
            #     # ensure membership up to date
            #     if collection_ids_list:
            #         current = await self._vector_repository.get_collection_ids(summary_id)
            #         if sorted(current) != sorted(collection_ids_list):
            #             await self._vector_repository.update_collection_ids(
            #                 summary_id=summary_id,
            #                 collection_ids=collection_ids_list,
            #             )
            #     return IngestionStats(
            #         summary_id=summary_id,
            #         member_code=member_code,
            #         parent_chunks=0,
            #         child_chunks=0,
            #         total_nodes=0,
            #         operation="skipped",
            #     )

            estimated_tokens = estimate_tokens(normalized_content)
            logger.info("Estimated tokens for summary_id=%s: %s", summary_id, estimated_tokens)

            parents = await self._build_parents(
                summary_id=summary_id,
                member_code=member_code,
                normalized_content=normalized_content,
                checksum=checksum,
                collection_ids=collection_ids_list,
                estimated_tokens=estimated_tokens,
            )
            logger.info("Built %s parent chunks for summary_id=%s", len(parents), summary_id)

            child_nodes: list[BaseNode] = []
            for parent in parents:
                parent_doc = Document(text=parent.text, metadata={})
                nodes = await self._child_parser.aget_nodes_from_documents([parent_doc])

                if len(nodes) > self._warn_child_nodes_over:
                    logger.warning(
                        "Parent %s has %s child nodes (summary_id=%s, member_code=%s)",
                        parent.parent_idx,
                        len(nodes),
                        summary_id,
                        member_code,
                    )

                for child_idx, node in enumerate(nodes):
                    node.id_ = chunk_point_id(
                        member_code,
                        summary_id,
                        parent.parent_idx,
                        child_idx,
                    )
                    node.metadata = {
                        "type": "child",
                        "summary_id": summary_id,
                        "member_code": member_code,
                        "parent_id": parent.id,
                        "parent_idx": parent.parent_idx,
                        "chunk_index": child_idx,
                        "collection_ids": collection_ids_list,
                    }
                    child_nodes.append(node)

            logger.info("Created %s child nodes for summary_id=%s", len(child_nodes), summary_id)

            child_docs = build_child_docs(
                member_code=member_code,
                summary_id=summary_id,
                parents=parents,
                child_nodes=child_nodes,
                checksum=checksum,
                collection_ids=collection_ids_list,
            )
            logger.info(
                "Prepared %s child documents for summary_id=%s",
                len(child_docs),
                summary_id,
            )

            await self._vector_repository.upsert_parents(parents)
            logger.info("Persisted %s parents for summary_id=%s", len(parents), summary_id)

            storage_context = StorageContext.from_defaults(vector_store=self._child_vector_store)
            index = VectorStoreIndex.from_documents([], storage_context=storage_context)
            await asyncio.gather(*(bounded(index.ainsert(doc)) for doc in child_docs))

            logger.info(
                "Persisted %s child documents for summary_id=%s via LlamaIndex",
                len(child_docs),
                summary_id,
            )

            return IngestionStats(
                summary_id=summary_id,
                member_code=member_code,
                parent_chunks=len(parents),
                child_chunks=len(child_docs),
                total_nodes=len(parents) + len(child_docs),
                operation="create",
            )

        except Exception as exc:  # pragma: no cover - upstream logging & re-raise.
            logger.error(
                "Error ingesting document summary_id=%s member_code=%s: %s",
                summary_id,
                member_code,
                exc,
                exc_info=True,
            )
            raise

    async def update_document(
        self,
        *,
        summary_id: int,
        member_code: str,
        original_content: str,
        collection_ids: Sequence[int] | None = None,
    ) -> IngestionStats:
        """Update an existing document by re-ingesting its latest content."""
        await self._vector_repository.delete_summary_tree(summary_id)

        stats = await self.ingest_document(
            summary_id=summary_id,
            member_code=member_code,
            original_content=original_content,
            collection_ids=collection_ids,
        )
        stats.operation = "update"
        return stats

    async def delete_document(self, summary_id: int) -> IngestionStats:
        """Delete all persisted data for a summary."""
        await self._vector_repository.delete_summary_tree(summary_id)
        return IngestionStats(
            summary_id=summary_id,
            member_code=None,
            parent_chunks=None,
            child_chunks=None,
            total_nodes=None,
            operation="delete",
        )

    async def _build_parents(
        self,
        *,
        summary_id: int,
        member_code: str,
        normalized_content: str,
        checksum: str,
        collection_ids: Sequence[int],
        estimated_tokens: int,
    ) -> list[Parent]:
        """Build parent payload objects based on the normalized content."""
        if estimated_tokens <= self._max_tokens_before_split:
            return [
                Parent(
                    id=parent_point_id(member_code, summary_id, 0),
                    summary_id=summary_id,
                    member_code=member_code,
                    parent_idx=0,
                    text=normalized_content,
                    checksum=checksum,
                    collection_ids=list(collection_ids),
                )
            ]

        logger.info(
            "summary_id=%s exceeds token threshold (%s), using semantic splitter",
            summary_id,
            estimated_tokens,
        )
        document = Document(
            text=normalized_content,
            metadata={
                "summary_id": summary_id,
                "member_code": member_code,
                "collection_ids": list(collection_ids),
            },
        )
        parent_nodes = await self._parent_parser.aget_nodes_from_documents([document])
        logger.info(
            "Semantic split yielded %s parent nodes for summary_id=%s",
            len(parent_nodes),
            summary_id,
        )

        parents: list[Parent] = []
        for idx, node in enumerate(parent_nodes):
            parents.append(
                Parent(
                    id=parent_point_id(member_code, summary_id, idx),
                    summary_id=summary_id,
                    member_code=member_code,
                    parent_idx=idx,
                    text=node.get_content(),
                    checksum=checksum,
                    collection_ids=list(collection_ids),
                )
            )
        return parents
