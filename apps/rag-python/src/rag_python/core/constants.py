"""Central constants shared across the RAG ingestion/search stack."""

# Named vectors configured in the unified Qdrant collection.
SUMMARY_VEC = "summary"
CHILD_VEC = "child"
CHILD_SPARSE_VEC = "child-sparse"

# Logical point types stored as payload metadata.
POINT_TYPE_SUMMARY = "summary"
POINT_TYPE_PARENT = "parent"
POINT_TYPE_CHILD = "child"
