"""Pydantic models for migration job tracking."""

from datetime import datetime
from enum import Enum
from typing import Any
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
    metadata: dict[str, Any] = Field(default_factory=dict)


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
    worker_id: str | None = None
    claimed_at: datetime | None = None


class SummaryRecord(BaseModel):
    """Represents a record from MySQL ip_summary table."""

    id: int  # Snowflake ID
    member_code: str
    parse_content: str  # Content to index
