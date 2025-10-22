"""Helpers for constructing LlamaIndex documents used during ingestion."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from llama_index.core.schema import BaseNode, Document

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
        parent_id = _require_metadata(metadata, "parent_id", node)
        parent_idx = _require_metadata(metadata, "parent_idx", node)
        chunk_index = _require_metadata(metadata, "chunk_index", node)

        doc_metadata: dict[str, Any] = {
            "type": "child",
            "summary_id": summary_id,
            "member_code": member_code,
            "parent_id": parent_id,
            "parent_idx": parent_idx,
            "chunk_index": chunk_index,
            "collection_ids": list(collection_ids_list),
            "checksum": checksum,
        }

        parent_meta = parent_lookup.get(parent_id)
        if parent_meta is not None:
            doc_metadata["parent_text_checksum"] = parent_meta.checksum

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
