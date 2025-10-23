"""Helpers for constructing LlamaIndex documents used during ingestion."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from llama_index.core.schema import BaseNode, Document

from rag_python.core.constants import (
    K_CHECKSUM,
    K_CHUNK_INDEX,
    K_COLLECTION_IDS,
    K_MEMBER_CODE,
    K_PARENT_ID,
    K_PARENT_IDX,
    K_PARENT_TEXT_CHECKSUM,
    K_SUMMARY_ID,
    K_TYPE,
    POINT_TYPE_CHILD,
)
from rag_python.core.models import Parent


def build_child_docs(
    *,
    member_code: str,
    summary_id: int,
    parents: Sequence[Parent],
    child_nodes: Sequence[BaseNode],
    checksum: str,
    collection_ids: Sequence[int],
) -> list[Document]:
    """Create LlamaIndex documents for child chunks ready for vector storage."""
    parent_lookup = {parent.id: parent for parent in parents}
    collection_ids_list = list(collection_ids)

    docs: list[Document] = []
    for node in child_nodes:
        metadata = node.metadata
        parent_id = _require_metadata(metadata, K_PARENT_ID, node)
        parent_idx = _require_metadata(metadata, K_PARENT_IDX, node)
        chunk_index = _require_metadata(metadata, K_CHUNK_INDEX, node)

        doc_metadata: dict[str, Any] = {
            K_TYPE: POINT_TYPE_CHILD,
            K_SUMMARY_ID: summary_id,
            K_MEMBER_CODE: member_code,
            K_PARENT_ID: parent_id,
            K_PARENT_IDX: parent_idx,
            K_CHUNK_INDEX: chunk_index,
            K_COLLECTION_IDS: list(collection_ids_list),
            K_CHECKSUM: checksum,
        }

        parent_meta = parent_lookup.get(parent_id)
        if parent_meta is not None:
            doc_metadata[K_PARENT_TEXT_CHECKSUM] = parent_meta.checksum

        docs.append(
            Document(
                id_=node.id_,
                text=node.get_content(),
                metadata=doc_metadata,
            )
        )

    return docs


def _require_metadata(
    metadata: Mapping[str, Any],
    key: str,
    node: BaseNode,
) -> Any:
    if key not in metadata:
        raise ValueError(f"Child node {getattr(node, 'id_', None)!r} missing metadata key: {key}")
    return metadata[key]
