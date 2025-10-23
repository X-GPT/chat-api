"""Domain models representing Qdrant point types."""

from dataclasses import dataclass, field


@dataclass(frozen=True)
class Parent:
    """Represents a parent chunk stored as payload-only in Qdrant."""

    id: str
    summary_id: int
    member_code: str
    parent_idx: int
    text: str
    checksum: str
    collection_ids: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class SparseVector:
    """Represents a sparse vector entry."""

    indices: list[int]
    values: list[float]


@dataclass(frozen=True)
class ChildVector:
    """Represents a child chunk vector entry."""

    id: str
    summary_id: int
    member_code: str
    parent_id: str
    parent_idx: int
    chunk_index: int
    text: str
    collection_ids: list[int] = field(default_factory=list)
    embedding: list[float] | None = None
    sparse_embedding: SparseVector | None = None
