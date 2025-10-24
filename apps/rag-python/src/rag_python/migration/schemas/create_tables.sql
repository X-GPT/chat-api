-- ============================================================
-- Supabase Schema for Migration Job Tracking
-- ============================================================
-- This script creates the necessary tables to track the progress
-- of the MySQL to Qdrant migration.
--
-- Usage:
-- 1. Copy this entire script
-- 2. Go to Supabase SQL Editor: https://supabase.com/dashboard/project/{your-project}/sql
-- 3. Paste and run this script
-- ============================================================

-- Table: ingestion_job
-- Tracks overall migration job progress
CREATE TABLE IF NOT EXISTS ingestion_job (
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

-- Index for querying active jobs
CREATE INDEX IF NOT EXISTS idx_ingestion_job_status
    ON ingestion_job(status);

-- Comments for documentation
COMMENT ON TABLE ingestion_job IS 'Tracks overall migration job progress';
COMMENT ON COLUMN ingestion_job.status IS 'Job status: pending, running, completed, or failed';
COMMENT ON COLUMN ingestion_job.metadata IS 'Stores additional info like start_time, end_time, etc.';

-- Table: ingestion_batch
-- Individual batch of 100 records to process
CREATE TABLE IF NOT EXISTS ingestion_batch (
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
	  next_retry_at TIMESTAMPTZ,
    worker_id TEXT,
    claimed_at TIMESTAMPTZ,
    UNIQUE(job_id, batch_number)
);

-- Index for querying batches by job
CREATE INDEX IF NOT EXISTS idx_ingestion_batch_job_id
    ON ingestion_batch(job_id);

-- Index for querying batches by status
CREATE INDEX IF NOT EXISTS idx_ingestion_batch_status
    ON ingestion_batch(status);

-- Index for querying batches by job, status, and batch_number
CREATE INDEX IF NOT EXISTS idx_ingestion_batch_job_status_batch_number
    ON ingestion_batch(job_id, status, batch_number);

-- Partial index for efficient batch claiming (only pending batches)
CREATE INDEX IF NOT EXISTS idx_ingestion_batch_claim
    ON ingestion_batch(job_id, status)
    WHERE status = 'pending';

-- Index for querying batches by status and claimed_at
CREATE INDEX IF NOT EXISTS ingestion_batch_processing_idx
  ON public.ingestion_batch (status, claimed_at);

-- Index for querying batches by status and next_retry_at
CREATE INDEX IF NOT EXISTS ingestion_batch_next_retry_idx
  ON public.ingestion_batch (status, next_retry_at);

-- Comments for documentation
COMMENT ON TABLE ingestion_batch IS 'Individual batch of 100 records to process';
COMMENT ON COLUMN ingestion_batch.record_ids IS 'Snowflake IDs are non-continuous, so we store exact IDs';
COMMENT ON COLUMN ingestion_batch.start_id IS 'First ID in batch (for human-readable reference only)';
COMMENT ON COLUMN ingestion_batch.end_id IS 'Last ID in batch (for human-readable reference only)';
COMMENT ON COLUMN ingestion_batch.worker_id IS 'Identifier of the worker that claimed this batch';
COMMENT ON COLUMN ingestion_batch.claimed_at IS 'Timestamp when batch was claimed by a worker';

-- ============================================================
-- PostgreSQL Function for Atomic Batch Claiming
-- ============================================================

CREATE OR REPLACE FUNCTION public.claim_next_batch(
    p_job_id    UUID,
    p_worker_id TEXT
)
RETURNS SETOF public.ingestion_batch
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH next_row AS (
        SELECT b.id
        FROM public.ingestion_batch AS b
        WHERE b.job_id = p_job_id
          AND b.status = 'pending'
          AND (b.next_retry_at IS NULL OR now() >= b.next_retry_at)  -- Respect retry backoff
        ORDER BY b.batch_number ASC, b.id ASC
        FOR UPDATE SKIP LOCKED  -- Critical: prevents race conditions
        LIMIT 1
    )
    UPDATE public.ingestion_batch AS ub
    SET status     = 'processing',
        worker_id  = p_worker_id,
        claimed_at = now(),
        updated_at = now()
    FROM next_row
    WHERE ub.id = next_row.id
    RETURNING ub.*;
END;
$$;

COMMENT ON FUNCTION public.claim_next_batch IS 'Atomically claim the next pending batch for a worker using FOR UPDATE SKIP LOCKED';
COMMENT ON FUNCTION public.claim_next_batch IS 'Uses CTE pattern with SECURITY DEFINER for proper isolation and security';

-- speeds selection of the next pending batch for a job in order
CREATE INDEX IF NOT EXISTS ingestion_batch_job_status_order_idx
  ON public.ingestion_batch (job_id, status, batch_number, id);

-- ============================================================
-- PostgreSQL Function for Job Statistics
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_ingestion_job_stats(p_job_id UUID)
RETURNS TABLE(
    completed_batches    INT,
    failed_batches       INT,
    pending_batches      INT,
    processing_batches   INT,
    processed_records    BIGINT,
    failed_records       BIGINT
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
    SELECT
        count(*) FILTER (WHERE status = 'completed')  ::INT    AS completed_batches,
        count(*) FILTER (WHERE status = 'failed')     ::INT    AS failed_batches,
        count(*) FILTER (WHERE status = 'pending')    ::INT    AS pending_batches,
        count(*) FILTER (WHERE status = 'processing') ::INT    AS processing_batches,
        coalesce(sum(processed_count), 0)             ::BIGINT AS processed_records,
        coalesce(sum(failed_count), 0)                ::BIGINT AS failed_records
    FROM public.ingestion_batch
    WHERE job_id = p_job_id;
$$;

COMMENT ON FUNCTION public.get_ingestion_job_stats IS 'Efficiently aggregate batch statistics for a job using SQL aggregates';

-- ============================================================
-- PostgreSQL Function for Resetting Stuck Batches
-- ============================================================

CREATE OR REPLACE FUNCTION public.reset_stuck_batches(
    p_job_id              UUID,
    p_timeout_minutes     INTEGER,         -- e.g. 15
    p_max_retries         INTEGER,         -- e.g. 5
    p_base_delay_seconds  INTEGER,         -- e.g. 30
    p_backoff_cap_seconds INTEGER          -- e.g. 1800 (30m cap)
)
RETURNS TABLE (
    id            UUID,
    new_status    TEXT,
    retry_count   INTEGER,
    next_retry_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
    WITH stuck AS (
        SELECT b.*
        FROM public.ingestion_batch b
        WHERE b.job_id = p_job_id
          AND b.status = 'processing'
          AND b.claimed_at < (now() - make_interval(mins => p_timeout_minutes))
        FOR UPDATE SKIP LOCKED
    ),
    upd AS (
        UPDATE public.ingestion_batch ub
        SET
            retry_count = ub.retry_count + 1,
            -- backoff with jitter: delay = min(cap, base * 2^(retry-1)) * (1 + 0..0.1)
            next_retry_at = CASE
                WHEN (ub.retry_count + 1) <= p_max_retries THEN
                    now()
                    + make_interval(secs => LEAST(
                        p_backoff_cap_seconds,
                        ROUND(p_base_delay_seconds * (2 ^ GREATEST(ub.retry_count, 0)))::int
                    ))
                    + (random() * interval '6 seconds')  -- ~0..6s jitter (≈10% of a 60s base)
                ELSE NULL
            END,
            status = CASE
                WHEN (ub.retry_count + 1) <= p_max_retries THEN 'pending'
                ELSE 'failed'
            END,
            worker_id  = NULL,
            claimed_at = NULL,
            updated_at = now(),
            error_message = CASE
                WHEN (ub.retry_count + 1) <= p_max_retries THEN coalesce(ub.error_message, 'stuck; reset for retry')
                ELSE coalesce(ub.error_message, 'stuck; max retries exceeded')
            END
        FROM stuck s
        WHERE ub.id = s.id
        RETURNING ub.id, ub.status AS new_status, ub.retry_count, ub.next_retry_at
    )
    SELECT * FROM upd;
END;
$$;

COMMENT ON FUNCTION public.reset_stuck_batches IS 'Reset batches stuck in processing state with exponential backoff (capped), jitter, and security hardening';

-- ============================================================
-- PostgreSQL Function for Bumping Batch Progress
-- ============================================================

CREATE OR REPLACE FUNCTION public.bump_batch_progress(
    p_batch_id        UUID,
    p_worker_id       TEXT,
    p_processed_delta INTEGER,
    p_failed_delta    INTEGER
)
RETURNS SETOF public.ingestion_batch
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
    UPDATE public.ingestion_batch b
    SET processed_count = coalesce(b.processed_count, 0) + greatest(p_processed_delta, 0),
        failed_count    = coalesce(b.failed_count, 0)    + greatest(p_failed_delta, 0),
        updated_at      = now()
    WHERE b.id = p_batch_id
      AND b.worker_id = p_worker_id         -- single-writer guard
      AND b.status = 'processing'           -- only while processing
    RETURNING b.*;
$$;

COMMENT ON FUNCTION public.bump_batch_progress IS 'Atomically increment batch progress counters with single-writer guard';

-- ============================================================
-- Verification Queries (run these after table creation)
-- ============================================================

-- Verify tables were created
SELECT
    table_name,
    table_type
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN ('ingestion_job', 'ingestion_batch')
ORDER BY table_name;

-- Verify indexes were created
SELECT
    schemaname,
    tablename,
    indexname,
    indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename IN ('ingestion_job', 'ingestion_batch')
ORDER BY tablename, indexname;

-- ============================================================
-- Optional: Enable Row Level Security (RLS)
-- ============================================================
-- Uncomment these if you want to enable RLS for these tables
-- (Not required for backend-only migration scripts)

-- ALTER TABLE ingestion_job ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE ingestion_batch ENABLE ROW LEVEL SECURITY;

-- Create policy to allow service role full access
-- CREATE POLICY "Service role has full access to ingestion_job"
--     ON ingestion_job
--     FOR ALL
--     TO service_role
--     USING (true)
--     WITH CHECK (true);

-- CREATE POLICY "Service role has full access to ingestion_batch"
--     ON ingestion_batch
--     FOR ALL
--     TO service_role
--     USING (true)
--     WITH CHECK (true);
