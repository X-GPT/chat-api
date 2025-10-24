# MySQL to Qdrant Migration System - Complete Architecture & Implementation Plan

## Implementation Progress Tracker

### Phase 1: Foundation (Setup & Dependencies)
- [x] Add `aiomysql` dependency to `pyproject.toml`
- [x] Run `uv sync` to install dependencies
- [x] Create `.env.migration.example` template file
- [x] Update `.gitignore` to protect `.env` files
- [x] Update `MigrationSettings` to use `.env` (not `.env.migration`)
- [x] Add migration environment variables to your `.env` file (see template for required vars)

### Phase 2: Database Schema (Supabase & Qdrant)
- [x] Create `migration/schemas/create_tables.sql` file
- [x] Run SQL script in Supabase SQL editor
- [x] Verify tables created: `ingestion_job`, `ingestion_batch`
- [x] Verify indexes created correctly
- [x] Create `migration/scripts/setup_qdrant.py` setup script
- [x] **Run setup_qdrant.py script** to create Qdrant collection
- [x] Verify Qdrant collection schema matches requirements

### Phase 3: Core Module Implementation
- [x] Create `migration/config.py` - MigrationSettings class
- [x] Create `migration/models.py` - Pydantic models for Job/Batch/Record
- [x] Create `migration/mysql_client.py` - MySQL async client wrapper
- [x] Create `migration/supabase_client.py` - Supabase client wrapper (with PostgreSQL RPC functions)
  - [x] Implemented atomic `claim_next_batch()` using PostgreSQL function
  - [x] Implemented atomic `bump_batch_progress()` with delta increments
  - [x] Implemented `get_ingestion_job_stats()` for server-side aggregation
  - [x] Implemented `reset_stuck_batches()` with exponential backoff and jitter

### Phase 4: Worker & Controller Implementation
- [x] Create `migration/worker.py` - Worker process logic
- [x] Create `migration/controller.py` - Main orchestrator
- [x] Update `migration/__init__.py` with proper exports

### Phase 5: Testing & Validation
- [ ] Test MySQL connection with sample query
- [ ] Test Supabase connection and table access
- [ ] Test batch claiming mechanism with 2 workers
- [ ] Run dry-run with first 100 records
- [ ] Run test with first 1,000 records
- [ ] Verify idempotency (re-running same records)
- [ ] Verify error handling (intentionally fail some records)
- [ ] Test resumability (stop and restart controller)

### Phase 6: Production Migration
- [ ] Review and adjust worker count based on test results
- [ ] Review and adjust batch size based on memory usage
- [ ] Start full migration with all 895,176 records
- [ ] Monitor progress via controller logs
- [ ] Monitor OpenAI API rate limits
- [ ] Monitor Qdrant performance
- [ ] Handle any failed batches

### Phase 7: Post-Migration
- [ ] Verify total record count in Qdrant matches MySQL
- [ ] Review failed batches and investigate errors
- [ ] Document lessons learned
- [ ] Plan separate job for `collection_ids` population

---

## Executive Summary

This document describes a robust migration system to transfer 895,176 summary records from AWS RDS MySQL (`ip_summary` table) to Qdrant vector database, with progress tracking in Supabase. The system uses a controller-worker architecture with 5 parallel worker processes, atomic batch claiming, and full resumability.

## System Architecture

### High-Level Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        CONTROLLER SCRIPT                         │
│  (migration/controller.py)                                       │
│                                                                   │
│  1. Check Supabase for existing 'running' job → Resume or Create │
│  2. Query MySQL: SELECT id FROM ip_summary ORDER BY id           │
│  3. Split into batches of 100 IDs                                │
│  4. Create ingestion_job record in Supabase                      │
│  5. Create ingestion_batch records (status='pending')            │
│  6. Launch 5 worker processes via multiprocessing                │
│  7. Monitor job progress, update statistics                      │
│  8. Handle graceful shutdown (Ctrl+C)                            │
└─────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┼──────────────┐
                    ▼              ▼              ▼
        ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
        │  WORKER 1     │  │  WORKER 2     │  │  WORKER 5     │
        │  (Process)    │  │  (Process)    │  │  (Process)    │
        │               │  │               │  │               │
        │  Loop:        │  │  Loop:        │  │  Loop:        │
        │  1. Claim     │  │  1. Claim     │  │  1. Claim     │
        │     batch     │  │     batch     │  │     batch     │
        │     (atomic)  │  │     (atomic)  │  │     (atomic)  │
        │  2. Fetch     │  │  2. Fetch     │  │  2. Fetch     │
        │     records   │  │     records   │  │     records   │
        │     from      │  │     from      │  │     from      │
        │     MySQL     │  │     MySQL     │  │     MySQL     │
        │  3. Ingest    │  │  3. Ingest    │  │  3. Ingest    │
        │     each to   │  │     each to   │  │     each to   │
        │     Qdrant    │  │     Qdrant    │  │     Qdrant    │
        │  4. Update    │  │  4. Update    │  │  4. Update    │
        │     batch     │  │     batch     │  │     batch     │
        │     status    │  │     status    │  │     status    │
        └───────────────┘  └───────────────┘  └───────────────┘
                 │                  │                  │
                 └──────────────────┴──────────────────┘
                                   │
                                   ▼
                    ┌──────────────────────────────┐
                    │  SUPABASE (Progress Tracking)│
                    │  - ingestion_job             │
                    │  - ingestion_batch           │
                    └──────────────────────────────┘
```

## Database Schemas

### Source: MySQL (AWS RDS)

**Table**: `ip_summary`

Relevant columns:
- `id` (BIGINT, snowflake ID) - Primary key
- `parse_content` (TEXT) - Content to index in Qdrant
- `member_code` (VARCHAR) - User identifier
- Other columns ignored in this migration
- **Note**: `collection_ids` will be populated in a separate job to avoid JOINs

### Tracking: Supabase

#### Table: `ingestion_job`

```sql
CREATE TABLE ingestion_job (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),
    total_batches INTEGER NOT NULL DEFAULT 0,
    completed_batches INTEGER NOT NULL DEFAULT 0,
    failed_batches INTEGER NOT NULL DEFAULT 0,
    total_records INTEGER NOT NULL DEFAULT 0,
    processed_records INTEGER NOT NULL DEFAULT 0,
    failed_records INTEGER NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX idx_ingestion_job_status ON ingestion_job(status);

COMMENT ON TABLE ingestion_job IS 'Tracks overall migration job progress';
COMMENT ON COLUMN ingestion_job.metadata IS 'Stores additional info like start_time, end_time, etc.';
```

#### Table: `ingestion_batch`

```sql
CREATE TABLE ingestion_batch (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id UUID NOT NULL REFERENCES ingestion_job(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    batch_number INTEGER NOT NULL,
    start_id BIGINT NOT NULL,      -- First ID in batch (for reference)
    end_id BIGINT NOT NULL,        -- Last ID in batch (for reference)
    record_ids BIGINT[] NOT NULL,  -- Actual array of all 100 IDs in this batch
    processed_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ,     -- Scheduled retry time (exponential backoff)
    worker_id TEXT,
    claimed_at TIMESTAMPTZ,
    UNIQUE(job_id, batch_number)
);

CREATE INDEX idx_ingestion_batch_job_id ON ingestion_batch(job_id);
CREATE INDEX idx_ingestion_batch_status ON ingestion_batch(status);
CREATE INDEX idx_ingestion_batch_claim ON ingestion_batch(job_id, status)
    WHERE status = 'pending';
CREATE INDEX idx_ingestion_batch_processing ON ingestion_batch(status, claimed_at);
CREATE INDEX idx_ingestion_batch_next_retry ON ingestion_batch(status, next_retry_at);

COMMENT ON TABLE ingestion_batch IS 'Individual batch of 100 records to process';
COMMENT ON COLUMN ingestion_batch.record_ids IS 'Snowflake IDs are non-continuous, so we store exact IDs';
COMMENT ON COLUMN ingestion_batch.next_retry_at IS 'Scheduled retry time with exponential backoff and jitter';
```

**PostgreSQL Functions** (see [create_tables.sql](../src/rag_python/migration/schemas/create_tables.sql) for full implementation):
- `claim_next_batch(p_job_id, p_worker_id)` - Atomic batch claiming with FOR UPDATE SKIP LOCKED
- `get_ingestion_job_stats(p_job_id)` - Efficient server-side statistics aggregation
- `reset_stuck_batches(...)` - Reset stuck batches with exponential backoff and jitter
- `bump_batch_progress(...)` - Atomic progress counter increments with worker validation

### Destination: Qdrant

Uses existing collection schema (already defined in codebase):
- Collection: `memos` (configurable via `qdrant_collection_name` in `.env`)
- Named vectors: `child` (dense), `child-sparse` (BM25)
- Payload fields: `summary_id`, `member_code`, `collection_ids` (set to `None` initially), etc.

## Qdrant Collection Setup

### Setup Script (Recommended)

**Use the dedicated setup script to create the Qdrant collection BEFORE running the migration.**

Run this command locally:
```bash
uv run python -m rag_python.migration.scripts.setup_qdrant
```

**What the script does:**
1. Checks if the collection already exists
2. If it exists, shows current stats and asks for confirmation to proceed
3. If it doesn't exist, creates the collection using `ensure_schema()`
4. Displays the collection configuration for verification
5. Provides next steps for running the migration

**Why use a separate script instead of the controller?**
- ✅ **Explicit setup step** - Clear separation of concerns
- ✅ **Verify before migration** - Ensure collection is ready before processing data
- ✅ **Easier troubleshooting** - If collection creation fails, fix it before running migration
- ✅ **Idempotent** - Safe to run multiple times

### How the Collection is Created

The setup script uses `QdrantService.ensure_schema()` which creates a collection with:
   - **Dense vector** (`child`): 1536 dimensions, cosine distance, HNSW index (m=16, ef_construct=256)
   - **Sparse vector** (`child-sparse`): BM25-based, with IDF modifier
   - **Payload indexes**: `member_code` (keyword, tenant isolation), `summary_id` (integer), `collection_ids` (integer), `type` (keyword), `checksum` (keyword)

**Configuration:**
```bash
# In your .env file (NOT .env.migration)
QDRANT_URL=https://your-cluster.qdrant.cloud:6333
QDRANT_API_KEY=your-api-key-here
QDRANT_COLLECTION_NAME=memos  # Default collection name
```

### Manual Creation (Optional)

If you prefer to create the collection manually in Qdrant Cloud UI or via API:

1. **Collection Name**: `memos` (or whatever you set in `QDRANT_COLLECTION_NAME`)

2. **Vector Configuration**:
   - Vector name: `child`
   - Size: 1536
   - Distance: Cosine
   - Quantization: Binary (optional, for storage optimization)
   - On-disk storage: Enabled (recommended for large datasets)

3. **Sparse Vector Configuration**:
   - Vector name: `child-sparse`
   - Modifier: IDF
   - On-disk storage: Enabled

4. **Payload Schema** (created automatically on first upsert, but can be pre-created):
   ```json
   {
     "member_code": "keyword",
     "summary_id": "integer",
     "collection_ids": "integer[]",
     "type": "keyword",
     "checksum": "keyword",
     "parent_idx": "integer",
     "chunk_index": "integer"
   }
   ```

5. **Indexes** (created automatically, but for reference):
   - `member_code` - Keyword index (critical for tenant isolation)
   - `summary_id` - Integer index (for filtering/lookup)
   - `collection_ids` - Integer index (for multi-collection filtering)
   - `type` - Keyword index (to distinguish parent/child points)
   - `checksum` - Keyword index (for idempotency)

### Verification

After setup (automatic or manual), verify the collection:

```python
# Quick verification script
from rag_python.config import get_settings
from rag_python.services.qdrant_service import QdrantService

settings = get_settings()
qdrant = QdrantService(settings)

# Check collection info
info = await qdrant.aclient.get_collection(settings.qdrant_collection_name)
print(f"Collection: {info.config.params}")
print(f"Vectors: {info.config.params.vectors}")
print(f"Sparse vectors: {info.config.params.sparse_vectors}")
```

### Important Notes

- **Collection creation is idempotent** - The setup script is safe to run multiple times
- **Run before migration** - Always run `setup_qdrant.py` before starting the controller
- **Storage recommendation**: For 895K records with avg 2-3 chunks each (~2.5M vectors), expect:
  - Dense vectors: ~15GB (with binary quantization)
  - Sparse vectors: ~2GB
  - Metadata: ~1GB
  - **Total**: ~18GB storage needed
- **Qdrant Cloud pricing**: Check your tier supports this storage + memory requirements
- The migration will NOT delete the collection if it exists - it will only add new points

## Key Design Decisions

### 1. Handling Non-Continuous IDs (Snowflake)

**Problem**: Snowflake IDs are not sequential, so ID ranges (e.g., 1-100, 101-200) would have gaps.

**Solution**:
- Query MySQL to get all IDs: `SELECT id FROM ip_summary ORDER BY id`
- Split the result into chunks of exactly 100 IDs
- Store the complete array of IDs in `record_ids` column
- Use `start_id` and `end_id` for human-readable reference only

**Trade-off**: Slightly larger storage in Supabase, but guarantees exactly 100 records per batch.

### 2. Atomic Batch Claiming

**Problem**: 5 workers running concurrently could claim the same batch (race condition).

**Solution**: Use PostgreSQL function with `FOR UPDATE SKIP LOCKED` (called via Supabase RPC):

The implementation uses a PostgreSQL function named `claim_next_batch` that is called via RPC:

```python
# Client-side call
response = self.client.rpc(
    "claim_next_batch",
    {
        "p_job_id": str(job_id),
        "p_worker_id": worker_id,
    },
).execute()
```

**PostgreSQL function logic** (simplified):
```sql
-- Actual function in create_tables.sql
CREATE OR REPLACE FUNCTION claim_next_batch(
    p_job_id UUID,
    p_worker_id TEXT
) RETURNS SETOF ingestion_batch AS $$
    UPDATE ingestion_batch
    SET status = 'processing',
        worker_id = p_worker_id,
        claimed_at = NOW(),
        updated_at = NOW()
    WHERE id = (
        SELECT id
        FROM ingestion_batch
        WHERE job_id = p_job_id
          AND status = 'pending'
        ORDER BY batch_number
        LIMIT 1
        FOR UPDATE SKIP LOCKED  -- Critical: prevents race conditions
    )
    RETURNING *;
$$ LANGUAGE sql;
```

**How it works**:
- Each worker calls the RPC function simultaneously
- `FOR UPDATE` locks the row
- `SKIP LOCKED` causes other workers to skip already-locked rows
- Only one worker gets each batch (atomic operation)
- Server-side execution ensures true atomicity

### 3. Worker Process Isolation

**Why processes, not threads?**
- Python's GIL limits true parallelism with threads
- Each worker needs its own async event loop
- Process isolation prevents shared state bugs
- Easier to monitor/kill individual workers

**Implementation**: Use `multiprocessing.Process`

### 4. Resumability Strategy

**Scenario**: Controller crashes after creating job and 1000 batches, but only 500 completed.

**Solution**:
1. On startup, controller queries: `SELECT * FROM ingestion_job WHERE status IN ('pending', 'running')`
2. If found, prompt user: "Resume existing job {id}? (Y/n)"
3. If yes:
   - Requeue failed batches (`UPDATE ingestion_batch SET status='pending', retry_count=retry_count+1 WHERE status='failed' AND retry_count < 3`)
   - Reset stuck batches (`UPDATE ... WHERE status='processing' AND claimed_at < NOW() - INTERVAL '10 minutes'`)
   - Resume worker spawning
4. If no, mark old job as 'failed' and create new one

### 5. Error Handling Philosophy

**Principle**: Fail gracefully, don't halt the entire migration.

**Per-record errors** (e.g., invalid content):
- Log the error with summary_id
- Increment `failed_count` for the batch
- Continue processing remaining records

**Per-batch errors** (e.g., MySQL connection lost):
- Mark batch as 'failed'
- If `retry_count < 3`, reset to 'pending' for retry
- If `retry_count >= 3`, mark as permanently failed
- Log error message in `error_message` column

**Job-level completion**:
- Job completes when all batches are either 'completed' or 'failed' (max retries exhausted)
- Final status: 'completed' if `failed_batches == 0`, else 'failed'

## Implementation Files

### File Structure

```
apps/rag-python/
├── src/rag_python/
│   └── migration/
│       ├── __init__.py
│       ├── config.py              # MigrationSettings class
│       ├── models.py              # Pydantic models for Job/Batch
│       ├── mysql_client.py        # Async MySQL client wrapper
│       ├── supabase_client.py     # Supabase client wrapper
│       ├── controller.py          # Main orchestrator script
│       ├── worker.py              # Worker process logic
│       ├── schemas/
│       │   └── create_tables.sql  # Supabase DDL
│       └── scripts/
│           ├── __init__.py
│           └── setup_qdrant.py    # Qdrant collection setup script
├── .env                           # Main environment file (add migration vars here)
├── .env.migration.example         # Migration variables template (for reference)
└── docs/
    └── MIGRATION_PLAN.md          # This document
```

### 1. Configuration (`migration/config.py`)

```python
"""Migration-specific configuration."""

from pydantic_settings import BaseSettings, SettingsConfigDict


class MigrationSettings(BaseSettings):
    """Migration settings loaded from .env file (same as main app settings)."""

    model_config = SettingsConfigDict(
        env_file=".env",  # Use same .env as main app
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # MySQL Configuration (AWS RDS)
    mysql_host: str
    mysql_port: int = 3306
    mysql_user: str
    mysql_password: str
    mysql_database: str
    mysql_table: str = "ip_summary"
    mysql_pool_size: int = 10  # Connection pool size

    # Supabase Configuration
    supabase_url: str
    supabase_key: str  # Service role key (not anon key!)

    # Migration Configuration
    batch_size: int = 100
    max_workers: int = 5
    max_retries: int = 3
    worker_poll_interval: float = 1.0  # Seconds between batch claim attempts
    worker_heartbeat_interval: float = 30.0  # How often to log "still alive"
    batch_timeout_minutes: int = 10  # Consider batch stuck if processing > 10min

    # Reuse existing app settings for Qdrant/OpenAI
    # (loaded separately in worker via get_settings())
```

### 2. Data Models (`migration/models.py`)

```python
"""Pydantic models for migration job tracking."""

from datetime import datetime
from enum import Enum
from uuid import UUID

from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    """Job status enum."""

    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class BatchStatus(str, Enum):
    """Batch status enum."""

    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"


class IngestionJob(BaseModel):
    """Represents an ingestion job record in Supabase."""

    id: UUID
    created_at: datetime
    updated_at: datetime
    status: JobStatus
    total_batches: int = 0
    completed_batches: int = 0
    failed_batches: int = 0
    total_records: int = 0
    processed_records: int = 0
    failed_records: int = 0
    metadata: dict = Field(default_factory=dict)


class IngestionBatch(BaseModel):
    """Represents a batch record in Supabase."""

    id: UUID
    job_id: UUID
    created_at: datetime
    updated_at: datetime
    status: BatchStatus
    batch_number: int
    start_id: int  # First ID in batch
    end_id: int  # Last ID in batch
    record_ids: list[int]  # Full array of IDs
    processed_count: int = 0
    failed_count: int = 0
    error_message: str | None = None
    retry_count: int = 0
    next_retry_at: datetime | None = None  # Scheduled retry with exponential backoff
    worker_id: str | None = None
    claimed_at: datetime | None = None


class SummaryRecord(BaseModel):
    """Represents a record from MySQL ip_summary table."""

    id: int  # Snowflake ID
    member_code: str
    parse_content: str  # Content to index
```

### 3. MySQL Client (`migration/mysql_client.py`)

```python
"""MySQL client wrapper for async operations."""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import aiomysql
from aiomysql import Pool

from rag_python.core.logging import get_logger
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import SummaryRecord

logger = get_logger(__name__)


class MySQLClient:
    """Async MySQL client for reading ip_summary table."""

    def __init__(self, settings: MigrationSettings):
        self.settings = settings
        self.pool: Pool | None = None
        self._validate_table_name()

    def _validate_table_name(self) -> None:
        """Validate table name to prevent SQL injection."""
        table_name = self.settings.mysql_table
        # Allow only alphanumeric, underscore, and dot (for db.table notation)
        if not all(c.isalnum() or c in ('_', '.') for c in table_name):
            raise ValueError(
                f"Invalid table name: {table_name}. "
                "Only alphanumeric characters, underscores, and dots are allowed."
            )

    async def connect(self) -> None:
        """Create connection pool."""
        logger.info(f"Connecting to MySQL: {self.settings.mysql_host}:{self.settings.mysql_port}")
        self.pool = await aiomysql.create_pool(
            host=self.settings.mysql_host,
            port=self.settings.mysql_port,
            user=self.settings.mysql_user,
            password=self.settings.mysql_password,
            db=self.settings.mysql_database,
            minsize=1,
            maxsize=self.settings.mysql_pool_size,
            autocommit=True,
        )
        logger.info("MySQL connection pool created")

    async def close(self) -> None:
        """Close connection pool."""
        if self.pool:
            self.pool.close()
            await self.pool.wait_closed()
            logger.info("MySQL connection pool closed")

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[aiomysql.Connection]:
        """Acquire a connection from the pool."""
        if not self.pool:
            raise RuntimeError("MySQL client not connected")
        async with self.pool.acquire() as conn:
            yield conn

    async def get_all_ids(self) -> list[int]:
        """Fetch all summary IDs ordered by ID.

        Returns:
            Sorted list of all summary IDs from the table.
        """
        logger.info(f"Fetching all IDs from {self.settings.mysql_table}...")
        async with self.acquire() as conn:
            async with conn.cursor() as cursor:
                # Note: Table name validated in __init__, safe to use in f-string
                # SQL parameters (%s) cannot be used for table/column names
                await cursor.execute(
                    f"SELECT id FROM {self.settings.mysql_table} ORDER BY id"
                )
                rows = await cursor.fetchall()
                ids = [row[0] for row in rows]
                logger.info(f"Fetched {len(ids):,} IDs")
                return ids

    async def get_records_by_ids(self, ids: list[int]) -> list[SummaryRecord]:
        """Fetch specific records by their IDs.

        Args:
            ids: List of summary IDs to fetch.

        Returns:
            List of SummaryRecord objects.
        """
        if not ids:
            return []

        logger.debug(f"Fetching {len(ids)} records from MySQL")
        async with self.acquire() as conn:
            async with conn.cursor(aiomysql.DictCursor) as cursor:
                # Use parameterized query for IDs to prevent SQL injection
                # Note: Table name validated in __init__, safe to use in f-string
                placeholders = ",".join(["%s"] * len(ids))
                query = f"""
                    SELECT id, member_code, parse_content
                    FROM {self.settings.mysql_table}
                    WHERE id IN ({placeholders})
                """
                await cursor.execute(query, ids)
                rows = await cursor.fetchall()

                # Convert to Pydantic models
                records = [
                    SummaryRecord(
                        id=row["id"],
                        member_code=row["member_code"],
                        parse_content=row["parse_content"] or "",
                    )
                    for row in rows
                    if row["parse_content"]  # Skip records with NULL content
                ]

                logger.debug(f"Fetched {len(records)}/{len(ids)} valid records")
                return records
```

### 4. Supabase Client (`migration/supabase_client.py`)

**IMPORTANT**: The actual implementation uses PostgreSQL RPC functions for atomic operations. The code below shows the key method signatures. See [supabase_client.py](../src/rag_python/migration/supabase_client.py) for the full implementation.

Key features of the actual implementation:
- Takes an `AsyncClient` instance in constructor (dependency injection pattern)
- All methods are async and use `await` for operations
- Uses `datetime.now(UTC)` instead of deprecated `datetime.utcnow()`
- All batch operations validate worker ownership for safety
- Uses PostgreSQL functions via RPC for atomic operations:
  - `claim_next_batch()` - Uses `FOR UPDATE SKIP LOCKED` for true atomic claiming
  - `bump_batch_progress()` - Atomically increments counters using delta values
  - `get_ingestion_job_stats()` - Server-side aggregation for efficiency
  - `reset_stuck_batches()` - Capped exponential backoff with jitter for retry scheduling
- Progress updates use delta increments, not absolute counts
- Batch completion/failure methods include worker_id validation to prevent race conditions

```python
"""Supabase client wrapper for job tracking."""

from datetime import UTC, datetime
from typing import Any
from uuid import UUID

from supabase import AsyncClient

from rag_python.core.logging import get_logger
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import (
    BatchStatus,
    IngestionBatch,
    IngestionJob,
    JobStatus,
)

logger = get_logger(__name__)


class SupabaseClient:
    """Client for tracking migration progress in Supabase."""

    def __init__(self, async_client: AsyncClient, settings: MigrationSettings):
        self.settings = settings
        self.client: AsyncClient = async_client

    # ==================== Job Operations ====================

    async def get_active_jobs(self) -> list[IngestionJob]:
        """Get all jobs with status 'pending' or 'running'."""
        # Uses await with async client operations

    async def create_job(self, total_batches: int, total_records: int) -> IngestionJob:
        """Create a new ingestion job with start_time in metadata."""
        # Uses datetime.now(UTC).isoformat()

    async def update_job_status(self, job_id: UUID, status: JobStatus) -> None:
        """Update job status. Merges end_time into metadata on COMPLETED."""
        # Preserves existing metadata using _merge_metadata()

    async def get_job_stats(self, job_id: UUID) -> dict[str, Any]:
        """Get aggregated statistics using PostgreSQL function.

        Calls 'get_ingestion_job_stats' RPC function for efficient server-side aggregation.
        Returns dict with keys: completed_batches, failed_batches, pending_batches,
        processing_batches, processed_records, failed_records
        """

    async def update_job_stats(self, job_id: UUID) -> None:
        """Update job statistics based on aggregated batch data."""

    # ==================== Batch Operations ====================

    async def create_batches(
        self, job_id: UUID, batch_specs: list[dict[str, Any]]
    ) -> list[IngestionBatch]:
        """Create multiple batch records in chunks of 100."""

    async def claim_next_batch(self, job_id: UUID, worker_id: str) -> IngestionBatch | None:
        """Atomically claim the next pending batch using PostgreSQL function.

        Uses 'claim_next_batch' RPC function with FOR UPDATE SKIP LOCKED
        to prevent race conditions. Returns claimed batch or None.
        """

    async def update_batch_progress(
        self,
        batch_id: UUID,
        worker_id: str,
        processed_delta: int = 0,
        failed_delta: int = 0,
    ) -> IngestionBatch | None:
        """Atomically increment batch progress counters using PostgreSQL function.

        Uses 'bump_batch_progress' RPC function with worker_id validation
        and single-writer guard. Returns updated batch or None if not owned by worker.
        """

    async def mark_batch_completed(self, batch_id: UUID, worker_id: str) -> None:
        """Mark batch as completed with worker ownership validation."""
        # Validates worker_id and status='processing' to prevent race conditions

    async def mark_batch_failed(
        self,
        batch_id: UUID,
        worker_id: str,
        error_message: str,
        retry: bool = True,
    ) -> None:
        """Mark batch as failed with optional retry and worker validation.

        Implements exponential backoff by incrementing retry_count.
        Resets to 'pending' if retry_count < max_retries, else 'failed'.
        """

    async def reset_stuck_batches(self, job_id: UUID) -> int:
        """Reset batches stuck in 'processing' state using PostgreSQL function.

        Uses 'reset_stuck_batches' RPC function with capped exponential backoff and jitter.
        Security-hardened with SECURITY DEFINER and non-blocking SKIP LOCKED.
        Returns number of batches reset.

        Parameters:
        - p_timeout_minutes: From settings.batch_timeout_minutes
        - p_max_retries: From settings.max_retries
        - p_base_delay_seconds: 30 seconds
        - p_backoff_cap_seconds: 1800 seconds (30 min max)
        """
```

**Note**: All methods are async and use the `AsyncClient` from supabase-py. The actual implementation requires `await` for all method calls.

### 5. Controller (`migration/controller.py`)

```python
"""Controller script to orchestrate the migration."""

import asyncio
import signal
import sys
from multiprocessing import Process
from uuid import UUID

from supabase import acreate_client, AsyncClient

from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import JobStatus
from rag_python.migration.mysql_client import MySQLClient
from rag_python.migration.supabase_client import SupabaseClient
from rag_python.migration.worker import run_worker

logger = get_logger(__name__)


class MigrationController:
    """Orchestrates the migration process."""

    def __init__(self, settings: MigrationSettings):
        self.settings = settings
        self.mysql_client = MySQLClient(settings)
        self.supabase_client: SupabaseClient | None = None
        self.async_supabase: AsyncClient | None = None
        self.workers: list[Process] = []
        self.shutdown_flag = False

    async def initialize(self) -> None:
        """Initialize database connections."""
        logger.info("Initializing migration controller...")

        # Connect to MySQL
        await self.mysql_client.connect()

        # Create async Supabase client
        self.async_supabase = await acreate_client(
            self.settings.supabase_url,
            self.settings.supabase_key,
        )
        self.supabase_client = SupabaseClient(self.async_supabase, self.settings)

        # NOTE: Qdrant collection should already be created via setup_qdrant.py script
        # before running the controller

        logger.info("Controller initialized")

    async def close_all(self) -> None:
        """Close everything (used both between phases and on final cleanup)."""
        logger.info("Closing connections...")
        if self.mysql_client:
            try:
                await self.mysql_client.close()
            except Exception:
                logger.exception("Error closing MySQL client")
        self.mysql_client = None

        # Supabase AsyncClient doesn't have an explicit close method
        # The underlying httpx client will be cleaned up when references are dropped
        self.async_supabase = None
        self.supabase_client = None
        logger.info("All connections closed")

    def register_signal_handlers(self) -> None:
        """Register handlers for graceful shutdown."""
        def signal_handler(signum, frame):
            logger.warning(f"Received signal {signum}, initiating shutdown...")
            self.shutdown_flag = True

        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)

    async def get_or_create_job(self) -> UUID:
        """Get existing active job or create new one.

        Returns:
            Job ID to process
        """
        # Check for existing jobs
        active_jobs = await self.supabase_client.get_active_jobs()

        if active_jobs:
            logger.warning(f"Found {len(active_jobs)} active job(s)")
            for job in active_jobs:
                logger.info(
                    f"  Job {job.id}: {job.status.value}, "
                    f"{job.completed_batches}/{job.total_batches} batches completed"
                )

            # Prompt user
            response = input("\nResume existing job? (Y/n): ").strip().lower()
            if response in ("", "y", "yes"):
                job = active_jobs[0]
                logger.info(f"Resuming job {job.id}")

                # Reset stuck batches
                reset_count = await self.supabase_client.reset_stuck_batches(job.id)
                if reset_count:
                    logger.info(f"Reset {reset_count} stuck batches")

                # Update status to running
                await self.supabase_client.update_job_status(job.id, JobStatus.RUNNING)
                return job.id

            # User chose not to resume
            logger.info("Creating new job instead")
            for job in active_jobs:
                await self.supabase_client.update_job_status(job.id, JobStatus.FAILED)

        # Create new job
        return await self.create_new_job()

    async def create_new_job(self) -> UUID:
        """Create a new migration job.

        Returns:
            New job ID
        """
        logger.info("Planning new migration job...")

        # Get all IDs from MySQL
        all_ids = await self.mysql_client.get_all_ids()
        total_records = len(all_ids)

        if total_records == 0:
            logger.error("No records found in MySQL table")
            sys.exit(1)

        # Split into batches
        batch_size = self.settings.batch_size
        batch_specs = []

        for i in range(0, total_records, batch_size):
            batch_ids = all_ids[i : i + batch_size]
            batch_specs.append({
                "batch_number": len(batch_specs),
                "start_id": batch_ids[0],
                "end_id": batch_ids[-1],
                "record_ids": batch_ids,
            })

        total_batches = len(batch_specs)
        logger.info(
            f"Split {total_records:,} records into {total_batches:,} batches "
            f"of ~{batch_size} records each"
        )

        # Create job record
        job = await self.supabase_client.create_job(total_batches, total_records)

        # Create batch records
        await self.supabase_client.create_batches(job.id, batch_specs)

        # Update job status
        await self.supabase_client.update_job_status(job.id, JobStatus.RUNNING)

        return job.id

    def spawn_workers(self, job_id: UUID) -> None:
        """Spawn worker processes.

        Args:
            job_id: Job ID for workers to process
        """
        logger.info(f"Spawning {self.settings.max_workers} worker processes...")

        for i in range(self.settings.max_workers):
            worker = Process(
                target=run_worker,
                args=(job_id, i),
                name=f"Worker-{i}",
            )
            worker.start()
            self.workers.append(worker)
            logger.info(f"Started worker {i} (PID: {worker.pid})")

    async def monitor_job(self, job_id: UUID) -> None:
        """Monitor job progress and update statistics.

        Args:
            job_id: Job ID to monitor
        """
        logger.info("Monitoring job progress...")

        while not self.shutdown_flag:
            # Update statistics
            await self.supabase_client.update_job_stats(job_id)

            # Get current stats
            stats = await self.supabase_client.get_job_stats(job_id)

            completed = stats["completed_batches"]
            failed = stats["failed_batches"]
            pending = stats["pending_batches"]
            processing = stats["processing_batches"]
            total = completed + failed + pending + processing

            logger.info(
                f"Progress: {completed}/{total} batches completed, "
                f"{processing} processing, {pending} pending, {failed} failed | "
                f"Records: {stats['processed_records']:,} processed, "
                f"{stats['failed_records']:,} failed"
            )

            # Check if job is complete
            if pending == 0 and processing == 0:
                final_status = JobStatus.COMPLETED if failed == 0 else JobStatus.FAILED
                await self.supabase_client.update_job_status(job_id, final_status)
                logger.info(f"Job {job_id} finished with status: {final_status.value}")
                break

            # Wait before next check
            await asyncio.sleep(5)

    def shutdown_workers(self) -> None:
        """Gracefully shutdown all workers."""
        logger.info("Shutting down workers...")

        for worker in self.workers:
            if worker.is_alive():
                logger.info(f"Terminating worker {worker.name} (PID: {worker.pid})")
                worker.terminate()
                worker.join(timeout=10)

                if worker.is_alive():
                    logger.warning(f"Force killing worker {worker.name}")
                    worker.kill()
                    worker.join()

        logger.info("All workers stopped")

    async def run(self) -> None:
        """Main execution flow."""
        try:
            await self.initialize()
            self.register_signal_handlers()

            # Get or create job
            job_id = await self.get_or_create_job()

            # Spawn workers
            self.spawn_workers(job_id)

            # Monitor progress
            await self.monitor_job(job_id)

            # Wait for workers to finish
            logger.info("Waiting for workers to complete...")
            for worker in self.workers:
                worker.join()

            logger.info("Migration complete!")

        except Exception as e:
            logger.error(f"Controller error: {e}", exc_info=True)
            raise
        finally:
            self.shutdown_workers()
            await self.cleanup()


async def main():
    """Entry point."""
    setup_logging()
    settings = MigrationSettings()
    controller = MigrationController(settings)
    await controller.run()


if __name__ == "__main__":
    asyncio.run(main())
```

### 6. Worker (`migration/worker.py`)

```python
"""Worker process for ingesting batches."""

import asyncio
import os
from uuid import UUID

from supabase import acreate_client, AsyncClient

from rag_python.config import get_settings
from rag_python.core.logging import get_logger, setup_logging
from rag_python.migration.config import MigrationSettings
from rag_python.migration.models import SummaryRecord
from rag_python.migration.mysql_client import MySQLClient
from rag_python.migration.supabase_client import SupabaseClient
from rag_python.services.ingestion_service import IngestionService
from rag_python.services.qdrant_service import QdrantService

logger = get_logger(__name__)


class MigrationWorker:
    """Worker process that claims and processes batches."""

    def __init__(self, job_id: UUID, worker_index: int):
        self.job_id = job_id
        self.worker_index = worker_index
        self.worker_id = f"{os.uname().nodename}-{os.getpid()}-{worker_index}"

        # Settings
        self.migration_settings = MigrationSettings()
        self.app_settings = get_settings()

        # Clients
        self.mysql_client = MySQLClient(self.migration_settings)
        self.supabase_client: SupabaseClient | None = None
        self.async_supabase: AsyncClient | None = None
        self.qdrant_service: QdrantService | None = None
        self.ingestion_service: IngestionService | None = None

        self.shutdown_flag = False

    async def initialize(self) -> None:
        """Initialize worker resources."""
        logger.info(f"Initializing worker {self.worker_id}...")

        # Connect to MySQL
        await self.mysql_client.connect()

        # Create async Supabase client
        self.async_supabase = await acreate_client(
            self.migration_settings.supabase_url,
            self.migration_settings.supabase_key,
        )
        self.supabase_client = SupabaseClient(self.async_supabase, self.migration_settings)

        # Initialize Qdrant and ingestion service
        # NOTE: Collection already created by controller, so we don't call ensure_schema() here
        self.qdrant_service = QdrantService(self.app_settings)

        self.ingestion_service = IngestionService(
            self.app_settings,
            self.qdrant_service,
        )

        logger.info(f"Worker {self.worker_id} initialized")

    async def cleanup(self) -> None:
        """Clean up worker resources."""
        logger.info(f"Cleaning up worker {self.worker_id}...")
        await self.mysql_client.close()

        # Supabase AsyncClient doesn't have an explicit close method
        # Drop references to allow cleanup
        self.async_supabase = None
        self.supabase_client = None

        if self.qdrant_service:
            await self.qdrant_service.aclose()
        logger.info(f"Worker {self.worker_id} cleanup complete")

    async def process_record(self, record: SummaryRecord) -> bool:
        """Process a single record.

        Args:
            record: Summary record to ingest

        Returns:
            True if successful, False otherwise
        """
        try:
            if not record.parse_content or not record.parse_content.strip():
                logger.warning(f"Skipping record {record.id}: empty content")
                return False

            stats = await self.ingestion_service.ingest_document(
                summary_id=record.id,
                member_code=record.member_code,
                original_content=record.parse_content,
                collection_ids=None,  # Set in separate job
            )

            logger.debug(
                f"Ingested record {record.id}: "
                f"{stats.parent_points_upserted} parents, "
                f"{stats.child_points_upserted} children"
            )
            return True

        except Exception as e:
            logger.error(f"Failed to ingest record {record.id}: {e}")
            return False

    async def process_batch(self, batch) -> None:
        """Process a claimed batch.

        Args:
            batch: IngestionBatch to process
        """
        logger.info(
            f"Worker {self.worker_id} processing batch {batch.batch_number} "
            f"({len(batch.record_ids)} records, retry {batch.retry_count})"
        )

        try:
            # Fetch records from MySQL
            records = await self.mysql_client.get_records_by_ids(batch.record_ids)

            if not records:
                logger.warning(f"No valid records found for batch {batch.batch_number}")
                await self.supabase_client.mark_batch_completed(batch.id)
                return

            # Process each record
            processed_count = 0
            failed_count = 0

            for i, record in enumerate(records):
                if self.shutdown_flag:
                    logger.warning("Shutdown requested, stopping batch processing")
                    raise InterruptedError("Worker shutdown")

                success = await self.process_record(record)
                if success:
                    processed_count += 1
                else:
                    failed_count += 1

                # Update progress every 10 records
                if (i + 1) % 10 == 0:
                    await self.supabase_client.update_batch_progress(
                        batch.id,
                        processed_count,
                        failed_count,
                    )
                    logger.debug(
                        f"Batch {batch.batch_number} progress: "
                        f"{processed_count}/{len(records)} processed"
                    )

            # Final progress update
            await self.supabase_client.update_batch_progress(
                batch.id,
                processed_count,
                failed_count,
            )

            # Mark batch as completed
            await self.supabase_client.mark_batch_completed(batch.id)

            logger.info(
                f"Batch {batch.batch_number} completed: "
                f"{processed_count} processed, {failed_count} failed"
            )

        except Exception as e:
            logger.error(f"Batch {batch.batch_number} failed: {e}", exc_info=True)
            await self.supabase_client.mark_batch_failed(
                batch.id,
                error_message=str(e),
                retry=True,
            )

    async def run(self) -> None:
        """Main worker loop."""
        try:
            await self.initialize()

            logger.info(f"Worker {self.worker_id} starting main loop...")

            consecutive_empty_polls = 0
            max_empty_polls = 10  # Exit after 10 consecutive empty polls

            while not self.shutdown_flag:
                # Try to claim a batch
                batch = await self.supabase_client.claim_next_batch(
                    self.job_id,
                    self.worker_id,
                )

                if batch:
                    consecutive_empty_polls = 0
                    await self.process_batch(batch)
                else:
                    # No batch available
                    consecutive_empty_polls += 1

                    if consecutive_empty_polls >= max_empty_polls:
                        logger.info(
                            f"No batches available after {max_empty_polls} polls, "
                            "assuming job is complete"
                        )
                        break

                    logger.debug(
                        f"No batch claimed, waiting {self.migration_settings.worker_poll_interval}s..."
                    )
                    await asyncio.sleep(self.migration_settings.worker_poll_interval)

            logger.info(f"Worker {self.worker_id} finished")

        except Exception as e:
            logger.error(f"Worker {self.worker_id} error: {e}", exc_info=True)
            raise
        finally:
            await self.cleanup()


def run_worker(job_id: UUID, worker_index: int) -> None:
    """Entry point for worker process.

    Args:
        job_id: Job ID to process
        worker_index: Index of this worker (0-4)
    """
    setup_logging()
    worker = MigrationWorker(job_id, worker_index)
    asyncio.run(worker.run())


if __name__ == "__main__":
    import sys
    if len(sys.argv) != 3:
        print("Usage: python worker.py <job_id> <worker_index>")
        sys.exit(1)

    job_id = UUID(sys.argv[1])
    worker_index = int(sys.argv[2])
    run_worker(job_id, worker_index)
```

### 7. Environment Variables (Add to `.env`)

**Important**: Migration settings are stored in the same `.env` file as the main application settings (NOT a separate `.env.migration` file).

Add these variables to your existing `.env` file:

```bash
# MySQL Configuration (AWS RDS)
MYSQL_HOST=your-rds-endpoint.region.rds.amazonaws.com
MYSQL_PORT=3306
MYSQL_USER=your_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=your_database
MYSQL_TABLE=ip_summary
MYSQL_POOL_SIZE=10

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key-here

# Migration Configuration
BATCH_SIZE=100
MAX_WORKERS=5
MAX_RETRIES=3
WORKER_POLL_INTERVAL=1.0
WORKER_HEARTBEAT_INTERVAL=30.0
BATCH_TIMEOUT_MINUTES=10
```

A template is provided in `.env.migration.example` for reference.

### 8. Dependency Update (`pyproject.toml`)

Add to the `dependencies` list:

```toml
"aiomysql>=0.2.0",
```

**Note:** SQLAlchemy is already in the project dependencies but is **NOT used** in this migration system. We use:
- `aiomysql` for async MySQL connections (raw SQL)
- `supabase-py` for Supabase (REST API client)
- Pydantic for data models (not SQLAlchemy ORM)

## Execution Guide

### 1. Setup

```bash
# Navigate to project
cd apps/rag-python

# Install dependencies
uv sync

# Add migration environment variables to your .env file
# (See .env.migration.example for the required variables)
# Add MySQL, Supabase, and migration settings to your existing .env file

# Create Supabase tables
# (Copy SQL from migration/schemas/create_tables.sql and run in Supabase SQL editor)

# Create Qdrant collection
uv run python -m rag_python.migration.scripts.setup_qdrant
```

### 2. Run Migration

```bash
# Run controller (spawns workers automatically)
uv run python -m rag_python.migration.controller
```

### 3. Monitor Progress

The controller will output logs like:

```
INFO - Resuming job a1b2c3d4-...
INFO - Reset 3 stuck batches
INFO - Spawning 5 worker processes...
INFO - Started worker 0 (PID: 12345)
...
INFO - Progress: 1523/8952 batches completed, 5 processing, 7424 pending, 0 failed | Records: 152,300 processed, 12 failed
```

### 4. Handle Interruptions

If the controller crashes:
1. Restart: `uv run python -m rag_python.migration.controller`
2. It will detect the existing job and prompt: "Resume existing job? (Y/n)"
3. Type `Y` to resume from where it left off

### 5. Post-Migration

After completion:
- Check `failed_batches` and `failed_records` counts
- Query Supabase to see which batches failed permanently
- Manually investigate failed records if needed
- Run a separate job to populate `collection_ids` (future work)

## Performance Estimates

### Expected Timeline

- **Total records**: 895,176
- **Batch size**: 100 records
- **Total batches**: ~8,952
- **Workers**: 5 parallel processes
- **Estimated time per record**: 2-5 seconds (chunking + embedding + upsert)
- **Estimated time per batch**: 200-500 seconds (~3-8 minutes)
- **Total estimated time**:
  - Best case: 8952 batches ÷ 5 workers × 3 min = ~90 hours
  - Worst case: 8952 batches ÷ 5 workers × 8 min = ~240 hours

**Note**: OpenAI embedding API rate limits may be the bottleneck. With tier 2 (3,000 RPM), you can process ~180,000 chunks/hour. Monitor the rate limits during migration.

### Cost Estimates

- **OpenAI embeddings**:
  - Model: text-embedding-3-small ($0.02 per 1M tokens)
  - Avg content length: ~500 tokens (parse_content)
  - Avg chunks per document: ~2-3
  - Total tokens: 895K × 500 × 2.5 = ~1.1B tokens
  - Cost: $22 for embeddings

- **Qdrant storage**:
  - Depends on your Qdrant plan (cloud vs self-hosted)

- **AWS RDS data transfer**:
  - Assuming 1KB per record = 895MB total (negligible)

## Troubleshooting

### Common Issues

**Issue**: Workers not claiming batches

**Solution**: Check `ingestion_batch` table status. If all are 'processing' but workers are idle, run:
```sql
UPDATE ingestion_batch
SET status = 'pending', worker_id = NULL, claimed_at = NULL
WHERE status = 'processing' AND claimed_at < NOW() - INTERVAL '10 minutes';
```

---

**Issue**: MySQL connection errors

**Solution**:
- Check security groups on AWS RDS (allow connections from worker IPs)
- Verify credentials in `.env.migration`
- Check connection pool size (reduce if hitting max connections)

---

**Issue**: Qdrant rate limiting

**Solution**:
- Reduce `max_workers` to 2-3
- Add sleep between ingestions if needed

---

**Issue**: OpenAI rate limit exceeded

**Solution**:
- Check your OpenAI tier and rate limits
- Add exponential backoff retry logic in worker
- Reduce `max_workers`

---

**Issue**: Out of memory

**Solution**:
- Reduce `batch_size` to 50
- Reduce `max_workers` to 3
- Check for memory leaks in worker loop

## Future Enhancements

1. **Webhook notifications**: Send Slack/email when job completes
2. **Web UI**: Dashboard to monitor progress in real-time
3. **Dry run mode**: Validate records without actually ingesting
4. **Incremental sync**: Only migrate new/updated records
5. **Collection IDs job**: Separate migration for populating collection associations
6. **Parallel job support**: Allow multiple jobs running concurrently with different filters
7. ~~**Better atomic claiming**: Create PostgreSQL function for true FOR UPDATE SKIP LOCKED~~ ✅ **IMPLEMENTED** - Uses PostgreSQL RPC functions for atomic operations

## Conclusion

This migration system provides:
- ✅ Robust error handling (3 retries per batch)
- ✅ Full resumability (survive crashes)
- ✅ Parallel processing (5 workers)
- ✅ Progress tracking (Supabase tables)
- ✅ Atomic batch claiming (no duplicate work)
- ✅ Graceful shutdown (Ctrl+C safe)

The system is production-ready for your 895K record migration. Start with a test run on a subset (e.g., first 1000 records) to validate before running the full migration.
