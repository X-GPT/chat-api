"""Central constants shared across the RAG ingestion/search stack."""

from typing import Final

# Named vectors configured in the unified Qdrant collection.
CHILD_VEC = "child"
CHILD_SPARSE_VEC = "child-sparse"

# Logical point types stored as payload metadata.
POINT_TYPE_PARENT = "parent"
POINT_TYPE_CHILD = "child"

# Payload keys.
K_MEMBER_CODE: Final[str] = "member_code"
K_SUMMARY_ID: Final[str] = "summary_id"
K_COLLECTION_IDS: Final[str] = "collection_ids"
K_CHECKSUM: Final[str] = "checksum"
K_TYPE: Final[str] = "type"
K_PARENT_TEXT: Final[str] = "parent_text"

# Child metadata keys.
K_PARENT_ID: Final[str] = "parent_id"
K_PARENT_IDX: Final[str] = "parent_idx"
K_CHUNK_INDEX: Final[str] = "chunk_index"
K_PARENT_TEXT_CHECKSUM: Final[str] = "parent_text_checksum"
K_TEXT: Final[str] = "text"
