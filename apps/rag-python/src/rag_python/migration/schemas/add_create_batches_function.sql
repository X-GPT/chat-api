-- Recommended: ensure this index exists (it does via PK)
-- CREATE INDEX IF NOT EXISTS exported_ip_summary_id_id_idx ON public.exported_ip_summary_id(id);

CREATE OR REPLACE FUNCTION public.create_batches_from_summary_ids(
    p_job_id UUID,
    p_batch_size INT
)
RETURNS TABLE (
    total_records BIGINT,
    total_batches BIGINT,
    inserted_batches BIGINT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_total_records BIGINT;
    v_total_batches BIGINT;
    v_inserted BIGINT;
BEGIN
    IF p_batch_size IS NULL OR p_batch_size <= 0 THEN
        RAISE EXCEPTION 'p_batch_size must be a positive integer';
    END IF;

    SELECT COUNT(*) INTO v_total_records
    FROM public.exported_ip_summary_id;

    v_total_batches := CEIL(v_total_records::numeric / p_batch_size)::bigint;

    IF v_total_records = 0 THEN
        RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint;
        RETURN;
    END IF;

    WITH ordered AS (
        SELECT
            eis.summary_id,          -- bigint
            eis.id,                  -- bigint, ordering key (PK)
            ((ROW_NUMBER() OVER (ORDER BY eis.id) - 1) / p_batch_size + 1) AS batch_num
        FROM public.exported_ip_summary_id AS eis
    ),
    aggregated AS (
        SELECT
            batch_num,
            ARRAY_AGG(summary_id ORDER BY id) AS batch_ids
        FROM ordered
        GROUP BY batch_num
    ),
    ins AS (
        INSERT INTO public.ingestion_batch (
            job_id,
            status,
            batch_number,
            start_id,
            end_id,
            record_ids
        )
        SELECT
            p_job_id,
            'pending'::text,
            a.batch_num,                               -- 1-based batch numbers
            a.batch_ids[1],                            -- start_id = first summary_id in batch
            a.batch_ids[cardinality(a.batch_ids)],     -- end_id   = last summary_id in batch
            a.batch_ids                                -- bigint[] of summary_id
        FROM aggregated a
        ORDER BY a.batch_num
        ON CONFLICT ON CONSTRAINT ingestion_batch_job_id_batch_number_key DO NOTHING
        RETURNING 1
    )
    SELECT COUNT(*) INTO v_inserted FROM ins;

    RETURN QUERY SELECT v_total_records, v_total_batches, COALESCE(v_inserted, 0);
END;
$$;

-- Permissions (Supabase roles)
GRANT EXECUTE ON FUNCTION public.create_batches_from_summary_ids(UUID, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_batches_from_summary_ids(UUID, INT) TO service_role;

COMMENT ON FUNCTION public.create_batches_from_summary_ids IS
'Creates ingestion batches from exported_ip_summary_id using row_number() batching (single scan, no OFFSET). Idempotent via unique (job_id, batch_number). start_id/end_id are the first/last summary_id in each batch.';
