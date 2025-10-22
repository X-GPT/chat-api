# Production Ingestion Flow - Implementation Plan

**Status:** Planning Phase
**Date:** 2025-10-16
**Architecture:** Migrate to single collection with named vectors

---

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Key Decisions](#key-decisions)
3. [Implementation Tasks](#implementation-tasks)
4. [Code Examples](#code-examples)
5. [Migration Strategy](#migration-strategy)
6. [Testing Checklist](#testing-checklist)
7. [Open Questions](#open-questions)

---

## TODO Tracker
- [x] Task 1.1 – Update Event Schema (`schemas/events.py`)
- [x] Task 1.2 – Create Point ID Generation Module (`services/point_ids.py`)
- [x] Task 1.3 – Create Text Processing Package (`text_processing/`)
- [x] Task 1.4 – Create Core Models (`core/models.py`)
- [x] Task 1.5 – Create Qdrant Mapper (`adapters/qdrant_mapper.py`)
- [x] Task 1.6 – Create Vector Repository (`repositories/vector_repository.py`)
- [x] Task 1.7 – Create LlamaIndex Document Builders (`services/document_builders.py`)
- [x] Task 1.8 – Create Constants Module (`core/constants.py`)
- [x] Task 1.9 – Refactor QdrantService (`services/qdrant_service.py`)
- [x] Task 2.1 – Update IngestionPipeline (`services/pipeline.py`)
- [ ] Task 3.1 – Update SearchService (`services/search_service.py`)
- [ ] Task 4.1 – Update Handlers (`worker/handlers.py`)
- [ ] Add / update unit tests (mapper, repository, document builders, ingestion pipeline, search service)
- [ ] Refresh integration tests (end-to-end ingestion, search, update flows)
- [ ] Execute migration strategy (dev/staging) and validate production plan

---

## Architecture Overview

### Current State (2 Collections)

```
Collection: summaries_children
  - Vectors: text-dense (1536), text-sparse-new (BM25)
  - Points: child chunks with embeddings
  - Hybrid search: dense + sparse

Collection: summaries_parents
  - Vectors: text-dense (1536)
  - Points: parent chunks with embeddings
  - Dense search only
```

### Target State (1 Collection with Named Vectors)

```
Collection: memos

  Named Vectors:
    - "child" (dense, 1536 dim, INT8 quantized, on_disk, HNSW m=16)
      → Chunk-level embeddings for direct search

    - "child-sparse" (sparse, BM25, on_disk)
      → Keyword/lexical search for hybrid retrieval

  Point Types:
    - parent::<summary_id>::<parent_idx>
      → Payload-only (NO vectors)
      → Stores parent text for context assembly
      → Payload: {type, summary_id, member_code, parent_idx, parent_text, checksum, collection_ids}

    - chunk::<summary_id>::<parent_idx>::<chunk_idx>
      → Has "child" vector + "child-sparse" vector
      → For direct chunk retrieval
      → Payload: {type, summary_id, member_code, parent_id, parent_idx, chunk_index, collection_ids}

  Payload Indexes:
    - member_code (keyword, is_tenant=True) - tenant isolation
    - summary_id (integer) - primary key
    - collection_ids (integer) - multi-collection filtering
    - type (keyword) - point type filtering
    - checksum (keyword) - idempotency checks
```

---

## Key Decisions

### ✅ Confirmed Decisions

1. **Collection name:** `memos` (simple, no prefix/suffix)
2. **Config rename:** `qdrant_collection_name` (was `qdrant_collection_prefix`)
3. **Keep sparse vectors** for hybrid search on children
4. **Search directly on chunks** (no dedicated summary vectors or multi-stage retrieval)
5. **Keep naming:** `member_code` (not `user_id`), `summary_id` (not `doc_id`)
6. **Use event.content** for summary text, **event.parse_content** for original document
7. **Text normalization:** Yes (improved version with HTML entities, zero-width chars, structure preservation)
8. **Checksumming:** Yes (SHA256 for idempotency)
9. **Parent size control:** If ≤2500 tokens → 1 parent, else semantic split
10. **Child cap:** Warn if >60 children per parent (don't block, just log)
11. **Overlap:** Keep 128 tokens (current setting)
12. **Skip:** Language detection, token estimation, section_path, page_range (for now)

### ⚠️ To Verify with Java Backend

1. Does `SummaryEvent` have both `content` (summary) and `parseContent` (original doc)?
2. Are both fields always populated for CREATED/UPDATED events?

---

## Implementation Tasks

Ordered by dependency. Estimated total: **8-12 hours**

### Phase 1: Core Infrastructure (3-4 hours)

#### Task 1.1: Update Event Schema (5 min)
**File:** `src/rag_python/schemas/events.py`

**Change:**
```python
class SummaryEvent(BaseModel):
    id: int
    member_code: str = Field(..., alias="memberCode")
    team_code: str | None = Field(None, alias="teamCode")

    # NEW: Summary text (short, 150-250 tokens)
    content: str | None = Field(None, alias="content")

    # Original document text (full content)
    parse_content: str | None = Field(None, alias="parseContent")

    action: SummaryAction
    timestamp: datetime
    collection_ids: list[int] | None = Field(None, alias="collectionIds")
```

**Action Required:** Verify with Java backend that `content` field exists and is populated.

---


#### Task 1.2: Create Point ID Generation Module (30 min)
**File:** `src/rag_python/services/point_ids.py` (NEW)

**Purpose:** Generate stable, deterministic UUIDs for Qdrant point IDs using UUID5.

**Why UUIDs?** Qdrant point IDs must be unsigned integers or UUIDs (not arbitrary strings). UUID5 provides:
- ✅ Deterministic - same inputs always produce same UUID (perfect idempotency)
- ✅ Stable across re-ingestion - re-ingesting same document produces same UUIDs
- ✅ Collision-resistant - uses SHA-1, virtually no collisions
- ✅ Qdrant-compatible - valid UUID format

**Implementation:**
```python
import uuid
from typing import Final

# Use URL namespace for UUID5 generation
NAMESPACE: Final = uuid.NAMESPACE_URL


def generate_point_id(
    point_type: str,
    member_code: str,
    summary_id: int,
    extra: str = "",
) -> str:
    """Generate a stable UUID5 for a Qdrant point."""
    seed = f"{point_type}:{member_code}:{summary_id}:{extra}"
    return str(uuid.uuid5(NAMESPACE, seed))


def parent_point_id(member_code: str, summary_id: int, parent_idx: int) -> str:
    """Generate point ID for a parent (payload-only) point."""
    return generate_point_id("parent", member_code, summary_id, str(parent_idx))


def chunk_point_id(
    member_code: str,
    summary_id: int,
    parent_idx: int,
    chunk_idx: int,
) -> str:
    """Generate point ID for a child chunk vector."""
    extra = f"{parent_idx}_{chunk_idx}"
    return generate_point_id("chunk", member_code, summary_id, extra)
```

**Tests to add:**
```python
def test_generate_point_id_deterministic():
    point_id_first = generate_point_id("chunk", "user123", 456, "0_5")
    point_id_second = generate_point_id("chunk", "user123", 456, "0_5")
    assert point_id_first == point_id_second


def test_point_id_format():
    point_id = parent_point_id("user123", 456, 0)
    assert len(point_id) == 36
    assert point_id.count('-') == 4
    import uuid
    uuid.UUID(point_id)


def test_chunk_uniqueness_within_parent():
    chunk1 = chunk_point_id("user123", 456, 0, 0)
    chunk2 = chunk_point_id("user123", 456, 0, 1)
    assert chunk1 != chunk2


def test_parent_uniqueness():
    parent1 = parent_point_id("user123", 456, 0)
    parent2 = parent_point_id("user123", 456, 1)
    assert parent1 != parent2


def test_cross_type_uniqueness():
    parent_id = parent_point_id("user123", 456, 0)
    chunk_id = chunk_point_id("user123", 456, 0, 0)
    assert parent_id != chunk_id


def test_idempotency_guarantees():
    first_run_parent = parent_point_id("user123", 456, 0)
    first_run_chunk = chunk_point_id("user123", 456, 0, 5)
    second_run_parent = parent_point_id("user123", 456, 0)
    second_run_chunk = chunk_point_id("user123", 456, 0, 5)
    assert first_run_parent == second_run_parent
    assert first_run_chunk == second_run_chunk
```

---

#### Task 1.3: Create Text Processing Package (1 hour)
**Folder:** `src/rag_python/text_processing/` (NEW)

**Modules:**
```python
# normalize_text.py
import html
import re
import unicodedata
from rag_python.core.logging import get_logger

logger = get_logger(__name__)

ZW = r"[\u200B-\u200D\uFEFF]"  # Zero-width characters
MULTISPACE = re.compile(r"[ 	]{2,}")
EOL_HYPHEN = re.compile(r"(\w)-\n(\w)")  # examp-\nle -> example
EOL_SOFT = re.compile(r"(?<![.!?])\n(?!\n)")  # join soft line breaks inside paragraphs
HEADER_FOOTER = re.compile(r"^\s*(Page\s+\d+|\d+\s*/\s*\d+)\s*$", re.I)


def normalize_text(s: str) -> str:
    """Normalize text for consistent processing."""
    s = unicodedata.normalize("NFKC", s)
    s = html.unescape(s)
    s = re.sub(ZW, "", s)
    s = "".join(ch for ch in s if ch == "\n" or ch >= " ")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    s = MULTISPACE.sub(" ", s)
    lines = []
    for line in s.split("\n"):
        if HEADER_FOOTER.match(line):
            continue
        lines.append(line.rstrip())
    s = "\n".join(lines)
    s = EOL_HYPHEN.sub(r"\1\2", s)
    s = EOL_SOFT.sub(" ", s)
    s = re.sub(r"\n{3,}", "\n\n", s).strip()
    s = MULTISPACE.sub(" ", s)
    return s
```

```python
# checksum.py
import hashlib
from rag_python.core.logging import get_logger
from rag_python.text_processing.normalize_text import normalize_text

logger = get_logger(__name__)


def compute_checksum(text: str) -> str:
    """Compute SHA256 checksum of normalized text."""
    normalized = normalize_text(text)
    checksum = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
    logger.debug(f"Computed checksum for {len(text)} chars: {checksum[:8]}...")
    return checksum
```

```python
# token_estimator.py
def estimate_tokens(text: str) -> int:
    """Rough estimate of token count (1 token ≈ 4 characters)."""
    return len(text) // 4
```

```python
# __init__.py
```

**Tests to add:**
- `tests/text_processing/test_normalize_text.py` — Unicode, HTML entities, zero-width characters, hyphenation, paragraph structure
- `tests/text_processing/test_checksum.py` — Normalization before hashing and checksum idempotency
- `tests/text_processing/test_token_estimator.py` — Approximate counts for short vs long samples

**Benefits of This Implementation:**

Compared to basic normalization, this improved version:

1. ✅ **Handles web content** - HTML entity decoding (`&amp;` → `&`)
2. ✅ **Removes invisible chars** - Zero-width Unicode characters that break checksums
3. ✅ **Defensive against corruption** - Strips control characters from malformed PDFs
4. ✅ **PDF-optimized** - Removes common headers/footers ("Page N", "N/M")
5. ✅ **Structure-aware** - Preserves paragraph boundaries for better semantic splitting
6. ✅ **Sentence-aware** - Only joins soft line breaks, keeps sentence breaks
7. ✅ **Better embeddings** - Preserved structure helps the model understand context

**Trade-offs:**
- Slightly more complex than basic normalization
- Preserves `\n\n` paragraph breaks (not fully flattened to single spaces)
- Header/footer pattern may need expansion based on your specific PDFs

**Real-world impact:**
- More stable checksums → better idempotency
- Better embeddings → improved search quality
- Fewer ingestion failures → more robust pipeline
- Cleaner text → less noise in results

---

#### Task 1.4: Create Core Models (30 min)
**File:** `src/rag_python/core/models.py` (NEW)

**Purpose:** Provide immutable data structures that represent the Qdrant point types (parents and children) plus shared sparse vector helpers. These models become the single source of truth for payload fields and help decouple business logic from storage adapters.

**Implementation:** `src/rag_python/core/models.py` (see repository for full definitions of `Parent`, `ChildVector`, `SparseVector`)

**Notes:**
- Keep models immutable (`frozen=True`) to make accidental mutation obvious.
- Having explicit models clarifies which fields belong in payloads versus vectors.
- Additional helper constructors (e.g., `Parent.from_document`) can live alongside these if needed.

---

#### Task 1.5: Create Qdrant Mapper (30 min)
**File:** `src/rag_python/adapters/qdrant_mapper.py` (NEW)

**Purpose:** Convert domain models to/from Qdrant `PointStruct`/`Record` objects. This isolates payload shape knowledge away from repositories and services.

**Implementation:**
```python
from collections.abc import Mapping
from typing import Any, cast

from qdrant_client import models as q

from rag_python.core.constants import (
    CHILD_SPARSE_VEC,
    CHILD_VEC,
    POINT_TYPE_CHILD,
    POINT_TYPE_PARENT,
)
from rag_python.core.models import ChildVector, Parent, SparseVector


def parent_to_point(parent: Parent) -> q.PointStruct:
    payload = {
        "type": POINT_TYPE_PARENT,
        "summary_id": parent.summary_id,
        "member_code": parent.member_code,
        "parent_idx": parent.parent_idx,
        "parent_text": parent.text,
        "collection_ids": list(parent.collection_ids),
        "checksum": parent.checksum,
    }
    return q.PointStruct(id=parent.id, payload=payload, vector={})


def child_to_point(child: ChildVector) -> q.PointStruct:
    payload = {
        "type": POINT_TYPE_CHILD,
        "summary_id": child.summary_id,
        "member_code": child.member_code,
        "parent_id": child.parent_id,
        "parent_idx": child.parent_idx,
        "chunk_index": child.chunk_index,
        "collection_ids": list(child.collection_ids),
        "text": child.text,
    }

    vectors: q.VectorStruct = {}
    if child.embedding is not None:
        vectors[CHILD_VEC] = child.embedding
    if child.sparse_embedding is not None:
        vectors[CHILD_SPARSE_VEC] = q.SparseVector(
            indices=child.sparse_embedding.indices,
            values=child.sparse_embedding.values,
        )

    return q.PointStruct(id=child.id, payload=payload, vector=vectors)


def record_to_parent(record: q.Record) -> Parent:
    payload = record.payload or {}
    return Parent(
        id=str(record.id),
        summary_id=cast(int, payload.get("summary_id")),
        member_code=cast(str | None, payload.get("member_code")) or "",
        parent_idx=cast(int, payload.get("parent_idx")),
        text=cast(str | None, payload.get("parent_text")) or "",
        checksum=cast(str | None, payload.get("checksum")) or "",
        collection_ids=[
            value for value in (payload.get("collection_ids") or []) if isinstance(value, int)
        ],
    )
```

**Notes:**
- Implement similar `record_to_parent` / `record_to_child` helpers as needed for retrieval use cases.
- Mapper is intentionally free of Qdrant client usage beyond model imports.

---

#### Task 1.6: Create Vector Repository (45 min)
**File:** `src/rag_python/repositories/vector_repository.py` (NEW)

**Purpose:** Encapsulate parent persistence plus shared metadata utilities (collection IDs, deletes, checksum lookups). Child vectors will be written through LlamaIndex vector stores instead of this repository.

**Implementation Outline:**
```python
from collections.abc import Sequence
from typing import cast

from qdrant_client import models as q

from rag_python.core.models import Parent
from rag_python.core.constants import (
    POINT_TYPE_PARENT,
    POINT_TYPE_CHILD,
)
from rag_python.adapters import qdrant_mapper
from rag_python.services.qdrant_service import QdrantService


class VectorRepository:
    def __init__(self, qdrant_service: QdrantService):
        self._qdrant = qdrant_service

    async def upsert_parents(self, parents: Sequence[Parent]) -> None:
        points = [qdrant_mapper.parent_to_point(parent) for parent in parents]
        await self._qdrant.upsert_points(points)

    async def get_existing_checksum(self, summary_id: int) -> str | None:
        records = await self._qdrant.retrieve_by_filter(
            filter_=q.Filter(
                must=[
                    q.FieldCondition(key="summary_id", match=q.MatchValue(value=summary_id)),
                    q.FieldCondition(key="type", match=q.MatchValue(value=POINT_TYPE_PARENT)),
                ]
            ),
            limit=1,
            with_vectors=False,
            with_payload=True,
        )
        if not records:
            return None
        payload = records[0].payload or {}
        checksum = payload.get("checksum")
        return cast(str | None, checksum) if isinstance(checksum, str) else None

    async def get_parents(self, parent_ids: Sequence[str]) -> list[Parent]:
        if not parent_ids:
            return []
        records = await self._qdrant.retrieve_by_ids(parent_ids)
        return [qdrant_mapper.record_to_parent(record) for record in records]

    async def delete_summary_tree(self, summary_id: int) -> None:
        await self._qdrant.delete(
            filter_=q.Filter(
                must=[
                    q.FieldCondition(
                        key="summary_id",
                        match=q.MatchValue(value=summary_id),
                    )
                ]
            )
        )

    async def update_collection_ids(
        self,
        summary_id: int,
        collection_ids: Sequence[int],
    ) -> None:
        await self._qdrant.set_payload(
            payload={"collection_ids": list(collection_ids)},
            filter_=q.Filter(
                must=[
                    q.FieldCondition(
                        key="summary_id",
                        match=q.MatchValue(value=summary_id),
                    )
                ]
            ),
        )

    async def get_collection_ids(self, summary_id: int) -> list[int]:
        records = await self._qdrant.retrieve_by_filter(
            filter_=q.Filter(
                must=[
                    q.FieldCondition(
                        key="summary_id",
                        match=q.MatchValue(value=summary_id),
                    ),
                    q.FieldCondition(key="type", match=q.MatchValue(value=POINT_TYPE_PARENT)),
                ]
            ),
            limit=1,
            with_payload=True,
            with_vectors=False,
        )
        if not records:
            return []
        payload = records[0].payload or {}
        value = payload.get("collection_ids", [])
        if isinstance(value, list) and all(isinstance(x, int) for x in value):
            return value
        return []
```

```

**Notes:**
- Add convenience helpers like `retrieve_by_summary_id` using `retrieve_by_filter` for children when needed by the ingestion/search layers.
- Repository owns delete/payload updates via generic QdrantService helpers, while child writes flow through LlamaIndex-managed vector stores.
- Repository becomes the unit under test for idempotency queries and parent orchestration.

---

#### Task 1.7: Create LlamaIndex Document Builders (20 min)
**File:** `src/rag_python/services/document_builders.py` (NEW)

**Purpose:** Centralize the transformation from normalized content and parsed nodes into `llama_index` `Document` objects. Keeping these helpers separate makes them easy to unit test and reuse.

**Implementation:**
```python
from collections.abc import Sequence
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
    parent_lookup = {parent.id: parent for parent in parents}
    docs: list[Document] = []
    for node in child_nodes:
        metadata = {
            "type": "child",
            "summary_id": summary_id,
            "member_code": member_code,
            "parent_id": node.metadata["parent_id"],
            "parent_idx": node.metadata["parent_idx"],
            "chunk_index": node.metadata["chunk_index"],
            "collection_ids": list(collection_ids),
            "checksum": checksum,
        }
        parent_meta = parent_lookup.get(node.metadata["parent_id"])
        if parent_meta:
            metadata["parent_text_checksum"] = parent_meta.checksum
        docs.append(
            Document(
                id_=node.id_,
                text=node.get_content(),
                metadata=metadata,
            )
        )
    return docs
```

**Notes:**
- Keep builders stateless so they are trivial to unit test.
- The pipeline can call these helpers directly while repository code remains unaware of LlamaIndex types.

---

#### Task 1.8: Create Constants Module (10 min)
**File:** `src/rag_python/core/constants.py` (NEW)

**Purpose:** Centralize vector names and point type constants for consistency across the codebase.

**Implementation:**
```python
"""Core constants for the RAG system."""

# Qdrant vector names (named vectors in single collection)
CHILD_VEC = "child"
CHILD_SPARSE_VEC = "child-sparse"

# Point types (for filtering by type field in payload)
POINT_TYPE_PARENT = "parent"
POINT_TYPE_CHILD = "child"
```

**Benefits:**
- Single source of truth for vector/type names
- Prevents typos and inconsistencies
- Easy to update naming conventions
- IDE autocomplete support

---

#### Task 1.9: Refactor QdrantService - Minimal Clean Approach (2-3 hours)
**File:** `src/rag_python/services/qdrant_service.py`

**Design Philosophy:**
- Minimal, clean wrapper around Qdrant client
- No LlamaIndex coupling at this layer (that's handled by ingestion/search services)
- Direct Qdrant client API usage for clarity
- Essential CRUD operations only

**Major Changes:**

**1. Update Config (do this first):**

In `src/rag_python/config.py`, rename:
```python
# OLD
qdrant_collection_prefix: str = "summaries"

# NEW
qdrant_collection_name: str = "memos"
```

**2. Minimal QdrantService Implementation:**

```python
"""Qdrant service for vector database operations."""

from collections.abc import Sequence

from qdrant_client import AsyncQdrantClient, QdrantClient
from qdrant_client import models as q

from rag_python.config import Settings
from rag_python.core.constants import CHILD_SPARSE_VEC, CHILD_VEC, POINT_TYPE_CHILD, POINT_TYPE_PARENT
from rag_python.core.logging import get_logger

logger = get_logger(__name__)


class QdrantService:
    """Minimal Qdrant service for managing the unified collection.

    Handles collection schema, point upserts, and retrieval operations.
    LlamaIndex integration happens in the ingestion/search layers.
    """

    def __init__(self, settings: Settings):
        """Initialize Qdrant service with sync and async clients.

        Args:
            settings: Application settings
        """
        self.settings = settings
        self.col = settings.qdrant_collection_name  # "memos"

        # Initialize both sync and async clients
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

        logger.info(f"QdrantService initialized for collection: {self.col}")

    async def ensure_schema(self) -> None:
        """Create collection with named vectors and payload indexes if not exists."""
        if await self.aclient.collection_exists(self.col):
            logger.info(f"Collection {self.col} already exists")
            return

        logger.info(f"Creating collection {self.col} with named vectors")

        # Create collection with named child vectors
        await self.aclient.create_collection(
            collection_name=self.col,
            vectors_config={
                # Child vector (dense, INT8 quantized, HNSW tuned)
                CHILD_VEC: q.VectorParams(
                    size=1536,
                    distance=q.Distance.COSINE,
                    on_disk=True,
                    quantization_config=q.ScalarQuantization(
                        type=q.ScalarType.INT8,
                        quantile=0.99,
                        always_ram=False,
                    ),
                    hnsw_config=q.HnswConfigDiff(
                        m=16,              # Connections per node
                        ef_construct=256,  # Construction quality
                    ),
                ),
            },
            sparse_vectors_config={
                # Child sparse vector (BM25)
                CHILD_SPARSE_VEC: q.SparseVectorParams(
                    index=q.SparseIndexParams(on_disk=True),
                    modifier=q.Modifier.IDF,
                ),
            },
            on_disk_payload=True,
        )

        logger.info(f"Created collection {self.col}")

        # Create payload indexes
        await self._ensure_payload_indexes()

    async def _ensure_payload_indexes(self) -> None:
        """Create payload indexes for efficient filtering."""
        try:
            logger.info("Creating payload indexes...")

            # member_code (tenant isolation)
            await self.aclient.create_payload_index(
                collection_name=self.col,
                field_name="member_code",
                field_schema=q.KeywordIndexParams(
                    type=q.KeywordIndexType.KEYWORD,
                    is_tenant=True,
                ),
            )

            # summary_id (primary key)
            await self.aclient.create_payload_index(
                collection_name=self.col,
                field_name="summary_id",
                field_schema=q.PayloadSchemaType.INTEGER,
            )

            # collection_ids (multi-collection filtering)
            await self.aclient.create_payload_index(
                collection_name=self.col,
                field_name="collection_ids",
                field_schema=q.PayloadSchemaType.INTEGER,
            )

            # type (point type filtering: parent/child)
            await self.aclient.create_payload_index(
                collection_name=self.col,
                field_name="type",
                field_schema=q.PayloadSchemaType.KEYWORD,
            )

            # checksum (idempotency checks)
            await self.aclient.create_payload_index(
                collection_name=self.col,
                field_name="checksum",
                field_schema=q.PayloadSchemaType.KEYWORD,
            )

            logger.info("Payload indexes created")

        except Exception as e:
            logger.warning(f"Warning creating payload indexes: {e}")

    async def upsert_points(
        self,
        points: list[q.PointStruct],
        wait: bool = True,
    ) -> None:
        """Upsert raw points into the collection."""
        if not points:
            return

        await self.aclient.upsert(
            collection_name=self.col,
            points=points,
            wait=wait,
        )

        logger.info(f"Upserted {len(points)} points")

    async def retrieve_by_ids(
        self,
        point_ids: Sequence[str],
        *,
        with_payload: bool = True,
        with_vectors: bool = False,
    ) -> list[q.Record]:
        """Fetch points by their IDs without embedding domain semantics."""
        if not point_ids:
            return []

        return await self.aclient.retrieve(
            collection_name=self.col,
            ids=list(point_ids),
            with_payload=with_payload,
            with_vectors=with_vectors,
        )

    async def retrieve_by_filter(
        self,
        filter_: q.Filter,
        *,
        limit: int,
        with_payload: bool = True,
        with_vectors: bool = False,
        offset: int | None = None,
    ) -> list[q.Record]:
        """Scroll points that match the provided filter."""
        records, _ = await self.aclient.scroll(
            collection_name=self.col,
            scroll_filter=filter_,
            offset=offset,
            limit=limit,
            with_payload=with_payload,
            with_vectors=with_vectors,
        )
        return records

    async def set_payload(
        self,
        *,
        payload: dict[str, object],
        filter_: q.Filter | None = None,
        ids: Sequence[str] | None = None,
    ) -> None:
        """Apply payload updates to points selected by IDs or filter."""
        await self.aclient.set_payload(
            collection_name=self.col,
            payload=payload,
            points_selector=ids or filter_,
        )

    async def delete(
        self,
        *,
        ids: Sequence[str] | None = None,
        filter_: q.Filter | None = None,
    ) -> None:
        """Delete points by IDs or filter."""
        await self.aclient.delete(
            collection_name=self.col,
            points_selector=ids or filter_,
        )

```

**Key Design Decisions:**

1. **No LlamaIndex coupling**: QdrantService is pure Qdrant client wrapper
2. **Minimal API surface**: Only essential CRUD operations
3. **Clear naming**: `self.col` instead of verbose property methods
4. **Both sync/async**: Support both client types for flexibility
5. **Constants imported**: Uses `CHILD_VEC`, `CHILD_SPARSE_VEC` from `core.constants`
6. **UUID-ready**: Methods accept UUID strings for point IDs
7. **Error handling**: Logs errors but doesn't suppress them
8. **Repository-friendly:** Provides generic helpers (`upsert_points`, `retrieve_by_ids`, `retrieve_by_filter`, `set_payload`, `delete`) so higher layers own business logic

**LlamaIndex Integration Note:**

LlamaIndex `QdrantVectorStore` integration happens in the **ingestion/search layers**, not here:

```python
# In IngestionPipeline or SearchService:
from llama_index.vector_stores.qdrant import QdrantVectorStore

# Create vector store pointing to the child/parent collection
child_vector_store = QdrantVectorStore(
    collection_name=qdrant_service.col,
    client=qdrant_service.client,
    aclient=qdrant_service.aclient,
    dense_vector_name="child",
    sparse_vector_name="child-sparse",
    enable_hybrid=True,
    fastembed_sparse_model="Qdrant/bm25",
)
```

This separation keeps QdrantService clean and focused on direct Qdrant operations.

---

### Phase 2: Ingestion Pipeline Refactor (3-4 hours)

#### Task 2.1: Update IngestionPipeline
**File:** `src/rag_python/services/pipeline.py`

**New method signature:**
```python
async def ingest_document(
    self,
    summary_id: int,
    member_code: str,
    summary_text: str,           # NEW: From event.content (doc summary)
    original_content: str,        # From event.parse_content (full doc)
    collection_ids: list[int] | None = None,
) -> IngestionStats:
    """Ingest a document with parent-child chunking and direct chunk vectors.

    Prerequisites: Qdrant collection and payload indexes are provisioned externally.

    Flow:
    1. Normalize & checksum original content (summary text already normalized markdown)
    2. Check idempotency (skip if checksum unchanged)
    3. Build parent chunks (1 parent if ≤2500 tokens, else semantic split)
    4. Build child chunks from each parent (cap warning at 60 children)
    5. Build LlamaIndex documents for children
    6. Persist parents, then write child vectors via LlamaIndex

    Args:
        summary_id: The summary ID
        member_code: The member code for partitioning
        summary_text: Summary text (150-250 tokens) used for metadata and parent context
        original_content: Full original document text for chunking
        collection_ids: List of collection IDs

    Returns:
        Ingestion statistics
    """
```

**Full implementation:**
```python
from llama_index.core import StorageContext, VectorStoreIndex
from llama_index.core.schema import BaseNode, Document

from rag_python.text_processing.normalize_text import normalize_text
from rag_python.text_processing.checksum import compute_checksum
from rag_python.text_processing.token_estimator import estimate_tokens
from rag_python.services.point_ids import parent_point_id, chunk_point_id
from rag_python.services.document_builders import build_child_docs
from rag_python.core.models import Parent

async def ingest_document(
    self,
    summary_id: int,
    member_code: str,
    summary_text: str,
    original_content: str,
    collection_ids: list[int] | None = None,
) -> IngestionStats:
    try:
        logger.info(
            f"Starting ingestion for summary_id={summary_id}, "
            f"member_code={member_code}, "
            f"summary_length={len(summary_text)}, "
            f"content_length={len(original_content)}"
        )

        # Qdrant collection setup occurs outside the pipeline.

        # ============================================================
        # STEP 1: Normalize & Checksum (Idempotency)
        # ============================================================
        normalized_content = normalize_text(original_content)
        checksum = compute_checksum(normalized_content)

        logger.info(f"Content checksum: {checksum}")

        # Check if content already ingested with same checksum
        existing_checksum = await self.vector_repository.get_existing_checksum(summary_id)
        if existing_checksum == checksum:
            logger.info(
                f"Content unchanged for summary_id={summary_id} "
                f"(checksum={checksum[:8]}...), skipping ingestion"
            )
            return IngestionStats(
                summary_id=summary_id,
                member_code=member_code,
                parent_chunks=0,
                child_chunks=0,
                total_nodes=0,
                operation="skipped",
            )

        logger.info("Content changed or new, proceeding with ingestion")

        # ============================================================
        # STEP 2: Build Parent Chunks (with size control)
        # ============================================================
        estimated_tokens = estimate_tokens(normalized_content)
        logger.info(f"Estimated tokens: {estimated_tokens}")

        parents = await self._build_parents(
            summary_id=summary_id,
            member_code=member_code,
            normalized_content=normalized_content,
            checksum=checksum,
            collection_ids=collection_ids or [],
            estimated_tokens=estimated_tokens,
        )
        logger.info(f"Created {len(parents)} parent records")

        # ============================================================
        # STEP 3: Build Child Chunks (with 60-child cap warning)
        # ============================================================
        all_child_nodes: list[BaseNode] = []

        for parent in parents:
            parent_idx = parent.parent_idx
            # Create child chunks from this parent
            parent_doc = Document(text=parent.text, metadata={})

            child_nodes_result = await self.child_parser.aget_nodes_from_documents([parent_doc])

            if len(child_nodes_result) > 60:
                logger.warning(
                    f"⚠️  Parent {parent_idx} has {len(child_nodes_result)} children "
                    f"(exceeds recommended limit of 60). "
                    f"Consider increasing chunk size or re-splitting parent. "
                    f"summary_id={summary_id}, parent_idx={parent_idx}"
                )

            for child_idx, child_node in enumerate(child_nodes_result):
                child_node.id_ = chunk_point_id(
                    member_code,
                    summary_id,
                    parent_idx,
                    child_idx,
                )
                child_node.metadata = {
                    "type": "child",
                    "summary_id": summary_id,
                    "member_code": member_code,
                    "parent_id": parent.id,
                    "parent_idx": parent_idx,
                    "chunk_index": child_idx,
                    "collection_ids": collection_ids or [],
                }

                all_child_nodes.append(child_node)

        logger.info(f"Created {len(all_child_nodes)} child nodes")

        # ============================================================
        # STEP 4: Build LlamaIndex Documents
        # ============================================================

        child_docs = build_child_docs(
            member_code=member_code,
            summary_id=summary_id,
            parents=parents,
            child_nodes=all_child_nodes,
            checksum=checksum,
            collection_ids=collection_ids or [],
        )

        logger.info(f"Prepared {len(child_docs)} child docs for LlamaIndex")

        # LlamaIndex handles embedding generation internally when `VectorStoreIndex.from_documents`
        # is invoked, so there is no direct dependency on `self.embed_model` for child vectors.
        # The `build_child_docs` helper lives in `services/document_builders.py`
        # and can be unit tested independently.

        # ============================================================
        # STEP 5: Persist (Parents via Repository, Vectors via LlamaIndex)
        # ============================================================

        logger.info(f"Upserting {len(parents)} parent points...")
        await self.vector_repository.upsert_parents(parents)

        logger.info(f"Writing {len(child_docs)} child docs through LlamaIndex...")
        child_storage = StorageContext.from_defaults(vector_store=self.child_vector_store)
        VectorStoreIndex.from_documents(
            child_docs,
            storage_context=child_storage,
            show_progress=False,
            use_async=True,
        )

        logger.info(
            f"✅ Ingestion completed for summary_id={summary_id}: "
            f"{len(parents)} parents, {len(child_docs)} children"
        )

        return IngestionStats(
            summary_id=summary_id,
            member_code=member_code,
            parent_chunks=len(parents),
            child_chunks=len(child_docs),
            total_nodes=len(parents) + 1 + len(child_docs),
            operation="create",
        )

    except Exception as e:
        logger.error(f"Error ingesting document: {e}", exc_info=True)
        raise
```

```python
    async def _build_parents(
        self,
        *,
        summary_id: int,
        member_code: str,
        normalized_content: str,
        checksum: str,
        collection_ids: list[int],
        estimated_tokens: int,
    ) -> list[Parent]:
        """Construct parent nodes from normalized content."""
        if estimated_tokens <= 2500:
            logger.info("Document ≤2500 tokens, using single parent")
            return [
                Parent(
                    id=parent_point_id(member_code, summary_id, 0),
                    summary_id=summary_id,
                    member_code=member_code,
                    parent_idx=0,
                    text=normalized_content,
                    checksum=checksum,
                    collection_ids=collection_ids,
                )
            ]

        logger.info("Document >2500 tokens, using semantic splitter")
        document = Document(
            text=normalized_content,
            metadata={
                "summary_id": summary_id,
                "member_code": member_code,
                "collection_ids": collection_ids,
            },
        )
        parent_nodes = await self.parent_parser.aget_nodes_from_documents([document])
        logger.info(f"Created {len(parent_nodes)} parent nodes via semantic split")

        return [
            Parent(
                id=parent_point_id(member_code, summary_id, idx),
                summary_id=summary_id,
                member_code=member_code,
                parent_idx=idx,
                text=node.get_content(),
                checksum=checksum,
                collection_ids=collection_ids,
            )
            for idx, node in enumerate(parent_nodes)
        ]

```

**Repository integration:** Inject `VectorRepository` and `child_vector_store` (and optionally `QdrantMapper`) via the pipeline constructor so the ingestion flow remains testable and storage-agnostic.

**Update update_document method:**
```python
async def update_document(
    self,
    summary_id: int,
    member_code: str,
    summary_text: str,
    original_content: str,
    collection_ids: list[int] | None = None,
) -> IngestionStats:
    """Update an existing document.

    Idempotency is handled by checksum in ingest_document.
    If checksum unchanged, ingestion is skipped automatically.
    If changed, old version is deleted and new version ingested.
    """
    try:
        logger.info(f"Updating document for summary_id={summary_id}")

        # Delete old version (all points for this summary_id)
        logger.info("Deleting old version")
        await self.vector_repository.delete_summary_tree(summary_id)

        # Ingest new version (with checksum check)
        stats = await self.ingest_document(
            summary_id=summary_id,
            member_code=member_code,
            summary_text=summary_text,
            original_content=original_content,
            collection_ids=collection_ids,
        )
        stats.operation = "update"

        return stats

    except Exception as e:
        logger.error(f"Error updating document: {e}", exc_info=True)
        raise
```

**Delete method delegates to VectorRepository:**
```python
async def delete_document(self, summary_id: int) -> IngestionStats:
    """Delete a document and all its chunks."""
    try:
        logger.info(f"Deleting document for summary_id={summary_id}")

        await self.vector_repository.delete_summary_tree(summary_id)

        return IngestionStats(
            summary_id=summary_id,
            member_code=None,
            parent_chunks=None,
            child_chunks=None,
            total_nodes=None,
            operation="delete",
        )

    except Exception as e:
        logger.error(f"Error deleting document: {e}", exc_info=True)
        raise
```

---

### Phase 3: Search Service - Single-Stage Retrieval (2-3 hours)

#### Task 3.1: Update SearchService
**File:** `src/rag_python/services/search_service.py`

**New single-stage search implementation:**

```python
async def search(
    self,
    query: str,
    member_code: str | None = None,
    summary_id: int | None = None,
    collection_id: int | None = None,
    limit: int = 10,
    sparse_top_k: int = 10,
) -> SearchResponse:
    """Perform single-stage hybrid search across child chunks.

    Args:
        query: Search query text
        member_code: Optional member code filter
        summary_id: Optional summary ID filter
        collection_id: Optional collection ID filter
        limit: Maximum number of final results
        sparse_top_k: Number of results from sparse (BM25) search

    Returns:
        SearchResponse with results aggregated by summary_id
    """
    try:
        logger.info(
            f"Single-stage search: query='{query}', member_code={member_code}, "
            f"summary_id={summary_id}, collection_id={collection_id}, limit={limit}"
        )

        # Build base filters (applied directly to child vectors)
        must_filters = [
            FieldCondition(key="type", match=MatchValue(value="child")),
        ]
        if member_code:
            must_filters.append(
                FieldCondition(key="member_code", match=MatchValue(value=member_code))
            )
        if summary_id is not None:
            must_filters.append(
                FieldCondition(key="summary_id", match=MatchValue(value=summary_id))
            )
        if collection_id:
            must_filters.append(
                FieldCondition(key="collection_ids", match=MatchValue(value=collection_id))
            )

        child_filters = Filter(must=must_filters)

        logger.info("Searching child vectors (hybrid)...")
        child_index = VectorStoreIndex.from_vector_store(
            self.qdrant_service.child_vector_store
        )
        child_retriever = child_index.as_retriever(
            similarity_top_k=limit,
            sparse_top_k=sparse_top_k,
            hybrid_top_k=limit,
            vector_store_kwargs={"qdrant_filters": child_filters},
        )
        child_results = await child_retriever.aretrieve(query)

        logger.info(f"Child search returned {len(child_results)} matches")

        if not child_results:
            logger.info("No child chunks found, returning empty results")
            return SearchResponse(query=query, results={}, total_results=0)

        # Group children by parent_id
        parent_groups: dict[str, list] = defaultdict(list)
        for child_result in child_results:
            parent_id = child_result.metadata.get("parent_id")
            if parent_id:
                parent_groups[parent_id].append(child_result)

        logger.info(f"Grouped matches across {len(parent_groups)} parents")

        # Fetch all parent payloads (batch)
        parent_ids = list(parent_groups.keys())
        parent_points = await self.qdrant_service.aclient.retrieve(
            collection_name=self.qdrant_service.col,
            ids=parent_ids,
            with_payload=True,
            with_vectors=False,
        )

        # Build parent lookup
        parent_lookup: dict[str, dict] = {
            str(point.id): dict(point.payload) if point.payload else {}
            for point in parent_points
        }

        # ============================================================
        # Assemble Results
        # ============================================================

        # Build parent-based results
        parent_results: list[tuple[SearchResultItem, int]] = []

        for parent_id, child_matches in parent_groups.items():
            parent_payload = parent_lookup.get(parent_id)
            if not parent_payload:
                logger.warning(f"Parent {parent_id} not found")
                continue

            # Create MatchingChild objects
            matching_children = [
                MatchingChild(
                    id=str(child.node_id),
                    text=child.get_content(),
                    score=child.score if child.score else 0.0,
                    chunk_index=child.metadata.get("chunk_index", 0),
                )
                for child in child_matches
            ]

            # Sort by score (best first)
            matching_children.sort(key=lambda x: x.score, reverse=True)

            # Get summary_id from parent
            result_summary_id = parent_payload.get("summary_id")
            if result_summary_id is None:
                logger.warning(f"Parent {parent_id} has no summary_id")
                continue

            # Create parent-based SearchResultItem
            parent_item = SearchResultItem(
                id=parent_id,
                text=parent_payload.get("parent_text", ""),
                max_score=max(c.score for c in matching_children),
                chunk_index=parent_payload.get("parent_idx", 0),
                matching_children=matching_children,
            )

            parent_results.append((parent_item, result_summary_id))

        logger.info(f"Created {len(parent_results)} parent-based results")

        aggregated: dict[int, list[SearchResultItem]] = defaultdict(list)
        for item, result_summary_id in parent_results:
            aggregated[result_summary_id].append(item)

        results_by_summary: dict[str, SummaryResults] = {}

        for sum_id, items in aggregated.items():
            # Sort by max_score descending
            items.sort(key=lambda x: x.max_score, reverse=True)

            # Get member_code from first parent
            member_code_value = "unknown"
            if items:
                first_parent_id = items[0].id
                first_parent = parent_lookup.get(first_parent_id, {})
                member_code_value = first_parent.get("member_code", "unknown")

            summary_result = SummaryResults(
                summary_id=sum_id,
                member_code=member_code_value,
                chunks=items,
                total_chunks=len(items),
                max_score=max(item.max_score for item in items) if items else 0.0,
            )

            results_by_summary[str(sum_id)] = summary_result

        total_results = sum(sr.total_chunks for sr in results_by_summary.values())

        logger.info(
            f"✅ Search completed: {total_results} total results "
            f"across {len(results_by_summary)} summaries"
        )

        return SearchResponse(
            query=query,
            results=results_by_summary,
            total_results=total_results,
        )

    except Exception as e:
        logger.error(f"Error performing search: {e}", exc_info=True)
        raise
```

---

### Phase 4: Handler Updates (30 min)

#### Task 4.1: Update SummaryLifecycleHandler
**File:** `src/rag_python/worker/handlers.py`

**Update handlers to pass both content fields:**

```python
async def _handle_created(self, event: SummaryEvent) -> bool:
    """Handle CREATED action.

    Args:
        event: The summary event with content (summary) and parse_content (original doc)

    Returns:
        bool: True if successful
    """
    logger.info(
        f"Summary created - ID: {event.id}, Member: {event.member_code}, "
        f"Team: {event.team_code}"
    )

    # Validate required fields
    if not event.content:
        logger.error(f"Missing content (summary text) for summary_id={event.id}")
        return False

    if not event.parse_content:
        logger.error(f"Missing parse_content (original doc) for summary_id={event.id}")
        return False

    logger.info(
        f"Content lengths: summary={len(event.content)}, "
        f"original={len(event.parse_content)}"
    )

    try:
        stats = await self.ingestion_service.ingest_document(
            summary_id=event.id,
            member_code=event.member_code,
            summary_text=event.content,              # Summary text
            original_content=event.parse_content,     # Full original doc
            collection_ids=event.collection_ids,
        )
        logger.info(f"Successfully ingested document: {stats}")
        return True

    except Exception as e:
        logger.error(f"Failed to ingest document: {e}", exc_info=True)
        return False

async def _handle_updated(self, event: SummaryEvent) -> bool:
    """Handle UPDATED action.

    Delegates to _handle_created since idempotency is handled by checksum.
    """
    logger.info(
        f"Summary updated - ID: {event.id}, Member: {event.member_code}, "
        f"Team: {event.team_code}"
    )

    # Validate required fields
    if not event.content:
        logger.error(f"Missing content (summary text) for summary_id={event.id}")
        return False

    if not event.parse_content:
        logger.error(f"Missing parse_content (original doc) for summary_id={event.id}")
        return False

    try:
        stats = await self.ingestion_service.update_document(
            summary_id=event.id,
            member_code=event.member_code,
            summary_text=event.content,
            original_content=event.parse_content,
            collection_ids=event.collection_ids,
        )
        logger.info(f"Successfully updated document: {stats}")
        return True

    except Exception as e:
        logger.error(f"Failed to update document: {e}", exc_info=True)
        return False
```

**Delete handler stays the same:**
```python
async def _handle_deleted(self, event: SummaryEvent) -> bool:
    """Handle DELETED action."""
    logger.info(
        f"Summary deleted - ID: {event.id}, Member: {event.member_code}, "
        f"Team: {event.team_code}"
    )

    try:
        stats = await self.ingestion_service.delete_document(summary_id=event.id)
        logger.info(f"Successfully deleted document: {stats}")
        return True

    except Exception as e:
        logger.error(f"Failed to delete document: {e}", exc_info=True)
        return False
```

---

## Migration Strategy

### Development/Staging (Clean Migration)

**Recommended approach:**

1. **Deploy new code** with feature flag (optional)
2. **Delete old collections:**
   ```python
   await qdrant_client.delete_collection("summaries_children")
   await qdrant_client.delete_collection("summaries_parents")
   ```
3. **Re-trigger ingestion** from Java backend for all documents
4. **Verify** new unified collection is created and populated

### Production (Zero-Downtime Migration)

**If downtime is unacceptable:**

1. **Deploy new code** with feature flag disabled
2. **Create new unified collection** (runs alongside old collections)
3. **Dual-write:** Temporarily write to both old + new collections
4. **Backfill:** Re-ingest historical data into new collection
5. **Validate:** Compare search results between old and new
6. **Switch:** Enable feature flag to read from new collection
7. **Cleanup:** After 1-2 weeks, delete old collections

**Backfill script example:**
```python
# scripts/migrate_to_unified_collection.py
async def migrate():
    # Get all unique summary_ids from old collections
    # For each summary_id:
    #   1. Fetch from Java backend API
    #   2. Re-ingest into new collection
    pass
```

---

## Testing Checklist

### Unit Tests

- [x] `tests/text_processing/test_normalize_text.py`
  - [ ] Unicode normalization (café vs cafe\u0301)
  - [ ] Hyphenation fixes (employ-\nment → employment)
  - [ ] Whitespace normalization
- [x] `tests/text_processing/test_checksum.py`
  - [ ] Consistent checksum for normalized equivalents
  - [ ] Different checksum for distinct content
- [x] `tests/text_processing/test_token_estimator.py`
  - [ ] Rough estimate for short samples
  - [ ] Rough estimate for longer passages
- [ ] `tests/adapters/test_qdrant_mapper.py`
  - [ ] Parent/Child → PointStruct mapping
  - [ ] Record → model reconstruction
- [ ] `tests/repositories/test_vector_repository.py`
  - [ ] Upsert batches call QdrantService with expected payloads
  - [ ] Retrieval helpers return domain models
  - [ ] Delete & collection_id helpers translate to generic delete/set_payload calls

- [ ] `test_qdrant_service.py`
  - [ ] Collection creation with named vectors
  - [ ] Payload index creation
  - [ ] Parent upsert (payload-only points)
  - [ ] Checksum retrieval
  - [ ] Delete by summary_id (all point types)

- [ ] `tests/services/test_document_builders.py`
  - [ ] Child doc metadata (parent linkage, indices, checksum propagation)
- [ ] `test_ingestion_pipeline.py`
  - [ ] Idempotency (same checksum → skip)
  - [ ] Parent size control (≤2500 → 1 parent, >2500 → split)
  - [ ] 60-child cap warning
  - [ ] Parents persisted via repository
  - [ ] Child docs forwarded to LlamaIndex with expected storage context

- [ ] `test_search_service.py`
  - [ ] Single-stage chunk retrieval
  - [ ] Filtering (member_code, collection_id)
  - [ ] Result aggregation by summary_id

### Integration Tests

- [ ] **End-to-end ingestion:**
  - [ ] Create document with both content fields
  - [ ] Verify parent and child points created with correct payloads
  - [ ] Verify child vectors populated correctly via LlamaIndex store
  - [ ] Verify metadata correct

- [ ] **Idempotency:**
  - [ ] Ingest document
  - [ ] Re-ingest same document (same checksum)
  - [ ] Verify ingestion skipped
  - [ ] Update content
  - [ ] Verify re-ingestion triggered

- [ ] **Single-stage search:**
  - [ ] Ingest multiple documents
  - [ ] Search query surfaces relevant child chunks
  - [ ] Verify parent context assembled correctly

- [ ] **Collection filtering:**
  - [ ] Ingest docs with different collection_ids
  - [ ] Search with collection_id filter
  - [ ] Verify only matching docs returned

- [ ] **Update operations:**
  - [ ] Ingest document
  - [ ] Update with changed content
  - [ ] Verify old points deleted
  - [ ] Verify new points created
  - [ ] Verify checksum updated

- [ ] **Delete operations:**
  - [ ] Ingest document
  - [ ] Delete by summary_id
  - [ ] Verify all point types deleted (parents and children)

### Performance Tests

- [ ] Large document (>10k tokens)
  - [ ] Verify semantic splitting works
  - [ ] Check parent count reasonable (<20 parents)
  - [ ] Measure ingestion time

- [ ] Many children (>60 per parent)
  - [ ] Verify warning logged
  - [ ] Verify ingestion still succeeds

- [ ] Batch ingestion (100+ documents)
  - [ ] Measure throughput
  - [ ] Check memory usage
  - [ ] Verify no timeouts

---

## Open Questions

### 1. Java Backend Integration

**Q:** Does `SummaryEvent` have both `content` and `parseContent` fields?

**Action:** Verify with Java team that:
- `content` = summary text (150-250 tokens)
- `parseContent` = full original document

**If not:** We need to:
- Option A: Request backend change to add `content` field
- Option B: Generate summaries in Python (requires OpenAI API, adds cost)

---

### 2. Summary Generation (If content field missing)

**Q:** If Java backend doesn't send `content`, how should we generate summaries?

**Options:**

**A. LLM-based summarization (high quality, expensive):**
```python
from llama_index.llms.openai import OpenAI

llm = OpenAI(model="gpt-4o-mini")
summary = await llm.acomplete(
    f"Summarize in 150-250 tokens:\n\n{original_content[:4000]}"
)
```

**B. Extractive summarization (fast, free):**
```python
def extract_summary(text: str, max_tokens: int = 200) -> str:
    """Take first N tokens as summary."""
    words = text.split()[:max_tokens]
    return ' '.join(words)
```

**C. Embedding-based (no summary text, just embed doc start):**
```python
# Use first 500 tokens as "summary"
summary_text = ' '.join(original_content.split()[:500])
```

**Recommendation:** Start with Option B (extractive), upgrade to Option A if needed.

---

### 3. Child Cap Enforcement

**Q:** When a parent has >60 children, should we:

**Option A:** Log warning and proceed (current plan)
**Option B:** Re-split parent into smaller sections
**Option C:** Increase child chunk size to reduce count

**Current plan:** Option A (warning only)

**Future enhancement:** Implement Option B:
```python
if len(child_nodes) > 60:
    # Re-split parent with larger chunk size
    larger_parser = SentenceSplitter(
        chunk_size=768,  # Increase from 512
        chunk_overlap=128,
    )
    child_nodes = await larger_parser.aget_nodes_from_documents([parent_doc])
```

---

### 4. Collection Naming

**Q:** Should we rename the unified collection or keep using prefix?

**Decision:** ✅ Use simple collection name `memos` (no prefix, no suffix)

**Rationale:**
- Single collection architecture → no need for suffixes like `_unified`
- Renamed config: `qdrant_collection_name` (was `qdrant_collection_prefix`)
- Clear domain terminology: "memos" matches the user-facing concept
- Clean and simple: just `memos`, not `summaries_unified` or `user_memos`

---

### 5. Quantization Impact

**Q:** Will INT8 quantization affect search quality?

**Answer:** Minimal impact for most use cases:
- Reduces memory by ~75%
- Slight recall drop (~1-2%)
- Faster search
- Recommended by Qdrant for production

**Monitoring:** Track search quality metrics after deployment.

---

### 6. Migration Timing

**Q:** When should we migrate?

**Options:**
- **Immediate:** During next maintenance window
- **Gradual:** Dual-write for 1-2 weeks
- **Feature flag:** Deploy code, migrate collection later

**Recommendation:** Depends on environment:
- **Dev/Staging:** Immediate clean migration
- **Production:** Gradual with dual-write

---

## Files to Create/Modify

### New Files
1. `src/rag_python/services/point_ids.py` - Stable UUID generation for Qdrant points
2. `src/rag_python/text_processing/` - Text normalization, checksumming, and token estimation modules
3. `src/rag_python/core/models.py` - Domain models for parents, summaries, and child vectors
4. `src/rag_python/adapters/qdrant_mapper.py` - PointStruct mapper utilities
5. `src/rag_python/services/document_builders.py` - LlamaIndex document factory helpers
6. `src/rag_python/repositories/vector_repository.py` - Repository for Qdrant vector operations

### Modified Files
1. `src/rag_python/config.py` - Rename `qdrant_collection_prefix` → `qdrant_collection_name` (value: `"memos"`)
2. `src/rag_python/schemas/events.py` - Add `content` field to `SummaryEvent`
3. `src/rag_python/services/qdrant_service.py` - Single collection, named vectors
4. `src/rag_python/services/pipeline.py` - New ingestion flow using VectorRepository + LlamaIndex vector stores
5. `src/rag_python/services/search_service.py` - Two-stage retrieval
6. `src/rag_python/worker/handlers.py` - Pass both content fields

### Test Files
1. `tests/test_point_ids.py` (NEW) - UUID stability and uniqueness tests
2. `tests/text_processing/test_normalize_text.py` (NEW) - Text normalization tests
3. `tests/text_processing/test_checksum.py` (NEW) - Checksum normalization coverage
4. `tests/text_processing/test_token_estimator.py` (NEW) - Token estimation heuristics
5. `tests/adapters/test_qdrant_mapper.py` (NEW) - Domain ↔ Qdrant translation
6. `tests/repositories/test_vector_repository.py` (NEW) - Repository orchestration against QdrantService
7. `tests/services/test_document_builders.py` (NEW) - Summary/child LlamaIndex doc factories
8. `tests/test_qdrant_service.py` (update) - Single collection, UUID points
9. `tests/test_ingestion_pipeline.py` (update) - New ingestion flow with LlamaIndex + UUIDs
10. `tests/test_search_service.py` (update) - Two-stage retrieval
11. `tests/test_handlers_integration.py` (update) - End-to-end with UUIDs

---

## Estimated Effort

| Phase | Task | Time |
|-------|------|------|
| **Phase 1** | Update Event Schema | 5 min |
| | Create Point ID Module (UUID5) | 30 min |
| | Create Text Processing Package | 1 hour |
| | Create LlamaIndex Document Builders | 20 min |
| | Update Config (rename prefix→name) | 5 min |
| | Refactor QdrantService | 2-3 hours |
| **Phase 2** | Update IngestionPipeline (VectorRepository + LlamaIndex writes) | 3-4 hours |
| **Phase 3** | Update SearchService | 2-3 hours |
| **Phase 4** | Update Handlers | 30 min |
| **Testing** | Unit Tests (point IDs, text processing) | 2-3 hours |
| | Integration Tests | 2-3 hours |
| **Migration** | Dev/Staging | 1 hour |
| | Production (if needed) | 4-6 hours |

**Total:** 14-21 hours (2-3 days)

---

## Success Criteria

- [ ] Single unified collection `memos` created with dense+sparse child vectors
- [ ] Parent and child point types stored correctly with stable UUIDs
- [ ] UUID idempotency working (same inputs → same UUIDs)
- [ ] Checksum idempotency working (skip re-ingestion if unchanged)
- [ ] Single-stage chunk search returning correct results
- [ ] Vector repository + mapper isolate payload translation from business logic
- [ ] Child vectors persisted via LlamaIndex vector store with correct metadata
- [ ] All existing tests passing
- [ ] New tests added and passing (point IDs, text processing, repository/mapper/doc-builders, UUID stability)
- [ ] Performance comparable or better than current
- [ ] Search quality maintained or improved
- [ ] Documentation updated

---

## Next Steps

1. **Review plan** with team
2. **Verify Java backend** sends both `content` and `parseContent`
3. **Create feature branch:** `feat/unified-collection-ingestion`
4. **Implement Phase 1:** Core infrastructure
5. **Test locally** with sample documents
6. **Implement Phase 2-4:** Ingestion, search, handlers
7. **Run integration tests**
8. **Deploy to dev/staging**
9. **Validate** with real data
10. **Deploy to production** (with migration strategy)

---

**Document Version:** 1.0
**Last Updated:** 2025-10-16
**Status:** Ready for Review
