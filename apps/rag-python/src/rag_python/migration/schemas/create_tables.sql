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

-- Partial index for efficient batch claiming (only pending batches)
CREATE INDEX IF NOT EXISTS idx_ingestion_batch_claim
    ON ingestion_batch(job_id, status)
    WHERE status = 'pending';

-- Comments for documentation
COMMENT ON TABLE ingestion_batch IS 'Individual batch of 100 records to process';
COMMENT ON COLUMN ingestion_batch.record_ids IS 'Snowflake IDs are non-continuous, so we store exact IDs';
COMMENT ON COLUMN ingestion_batch.start_id IS 'First ID in batch (for human-readable reference only)';
COMMENT ON COLUMN ingestion_batch.end_id IS 'Last ID in batch (for human-readable reference only)';
COMMENT ON COLUMN ingestion_batch.worker_id IS 'Identifier of the worker that claimed this batch';
COMMENT ON COLUMN ingestion_batch.claimed_at IS 'Timestamp when batch was claimed by a worker';

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
