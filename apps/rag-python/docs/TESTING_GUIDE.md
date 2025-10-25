# Migration System Testing Guide

This guide provides a step-by-step approach to testing the migration system before running the full production migration.

## Testing Philosophy

**Test incrementally and verify each component independently before integration testing.**

The testing strategy follows this progression:
1. ✅ Connection tests (MySQL, Supabase)
2. ✅ Atomic operations (batch claiming)
3. ✅ Small-scale integration (100 records)
4. ✅ Idempotency & error handling
5. ✅ Resumability (stop/restart)
6. ✅ Medium-scale test (1,000 records)
7. 🚀 Production migration (895K records)

---

## Prerequisites

### 1. Environment Setup

Ensure your `.env` file has all required variables:

```bash
# MySQL (AWS RDS)
MYSQL_HOST=your-rds-endpoint.region.rds.amazonaws.com
MYSQL_PORT=3306
MYSQL_USER=your_user
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=your_database
MYSQL_TABLE=ip_summary

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# Qdrant
QDRANT_URL=https://your-cluster.qdrant.cloud:6333
QDRANT_API_KEY=your-api-key
QDRANT_COLLECTION_NAME=memos

# OpenAI
OPENAI_API_KEY=your-openai-key
```

### 2. Database Setup

Ensure you've completed:
- ✅ Created Supabase tables (`ingestion_job`, `ingestion_batch`)
- ✅ Created PostgreSQL functions (in `create_tables.sql`)
- ✅ Created Qdrant collection (via `setup_qdrant.py`)

---

## Test Suite

### Test 1: MySQL Connection

**Purpose:** Verify MySQL connectivity and data access.

```bash
uv run python -m rag_python.migration.scripts.test_mysql
```

**Expected output:**
```
✓ MySQL connection established
✓ Found 895,176 records in ip_summary
  First ID: 1234567890
  Last ID: 9876543210
✓ Successfully fetched 3 sample records
  Record 1234567890: member_code=user123, content_length=542
✓ All MySQL tests passed!
```

**What it tests:**
- ✅ MySQL connection with credentials
- ✅ Table exists and is accessible
- ✅ Can query all IDs (for batching)
- ✅ Can fetch records by ID
- ✅ Connection cleanup works

**Troubleshooting:**
- **Connection refused:** Check security groups on AWS RDS
- **Table not found:** Verify `MYSQL_TABLE` setting
- **Auth failed:** Check `MYSQL_USER` and `MYSQL_PASSWORD`

---

### Test 2: Supabase Connection

**Purpose:** Verify Supabase connectivity and CRUD operations.

```bash
uv run python -m rag_python.migration.scripts.test_supabase
```

**Expected output:**
```
--- Test 1: Get active jobs ---
✓ Found 0 active jobs

--- Test 2: Create test job ---
✓ Created test job: a1b2c3d4-...
  Status: pending
  Total batches: 3

--- Test 3: Create test batches ---
✓ Created 3 test batches

--- Test 4: Claim batch (atomic) ---
✓ Claimed batch 0
  Worker ID: test-worker-1
  Status: processing

--- Test 5: Update batch progress ---
✓ Updated batch progress
  Processed: 5
  Failed: 1

--- Test 6: Mark batch completed ---
✓ Marked batch as completed

--- Test 7: Get job statistics ---
✓ Job statistics:
  Completed batches: 1
  Pending batches: 2
  Processed records: 5
  Failed records: 1

--- Test 8: Update job status ---
✓ Updated job status to COMPLETED

--- Cleanup: Deleting test job ---
✓ Deleted test job

✓ All Supabase tests passed!
```

**What it tests:**
- ✅ Supabase connection and authentication
- ✅ Job creation and status updates
- ✅ Batch creation and claiming
- ✅ Progress tracking with deltas
- ✅ Statistics aggregation (PostgreSQL function)
- ✅ Cascade deletes work correctly

**Troubleshooting:**
- **401 Unauthorized:** Check `SUPABASE_KEY` (must be service role key, not anon key)
- **Table not found:** Run `create_tables.sql` in Supabase SQL editor
- **Function not found:** PostgreSQL functions not created

---

### Test 3: Atomic Batch Claiming

**Purpose:** Verify that concurrent workers don't claim the same batch (race condition test).

```bash
uv run python -m rag_python.migration.scripts.test_batch_claiming
```

**Expected output:**
```
Created test job: a1b2c3d4-...
Created 10 test batches

--- Spawning 3 concurrent workers ---
[worker-0] Claimed batch 0
[worker-1] Claimed batch 1
[worker-2] Claimed batch 2
[worker-0] Claimed batch 3
[worker-1] Claimed batch 4
[worker-2] Claimed batch 5
[worker-0] Claimed batch 6
[worker-1] Claimed batch 7
[worker-2] Claimed batch 8
[worker-0] Claimed batch 9
[worker-1] No batches available
[worker-2] No batches available

--- Results ---
Total batches claimed: 10
Unique batches claimed: 10
Worker 0: claimed 4 batches - [0, 3, 6, 9]
Worker 1: claimed 3 batches - [1, 4, 7]
Worker 2: claimed 3 batches - [2, 5, 8]

✓ No duplicate claims detected - atomic claiming works!
```

**What it tests:**
- ✅ PostgreSQL `FOR UPDATE SKIP LOCKED` prevents race conditions
- ✅ Multiple workers can claim batches concurrently
- ✅ No batch is claimed by more than one worker
- ✅ RPC function atomicity

**Troubleshooting:**
- **Duplicate claims:** PostgreSQL function not using `FOR UPDATE SKIP LOCKED`
- **All batches claimed by one worker:** Workers not running concurrently

---

### Test 4: Dry Run (100 Records)

**Purpose:** End-to-end test with a small dataset to verify the full pipeline.

```bash
uv run python -m rag_python.migration.scripts.test_migration_pilot
```

**Expected output:**
```
==================== DRY RUN TEST - First 100 records ====================
Batch size: 10
Max workers: 2
========================================================================

Planning new migration job (LIMITED TO 100 RECORDS)...
Using 100 records (limited from 895,176 total)
Split 100 records into 10 batches of ~10 records each
Created job a1b2c3d4-...

Opening connections for monitoring...
Spawning 2 worker processes...
Started worker 0 (PID: 12345)
Started worker 1 (PID: 12346)

Monitoring job progress...
Progress: 2/10 batches completed, 2 processing, 6 pending, 0 failed | Records: 20 processed, 0 failed
Progress: 5/10 batches completed, 1 processing, 4 pending, 0 failed | Records: 50 processed, 1 failed
Progress: 10/10 batches completed, 0 processing, 0 pending, 0 failed | Records: 98 processed, 2 failed

Job a1b2c3d4-... finished with status: completed
Migration complete!

✓ DRY RUN COMPLETED SUCCESSFULLY
```

**What it tests:**
- ✅ End-to-end flow: plan → spawn → process → monitor → complete
- ✅ Worker processes spawn correctly (multiprocessing)
- ✅ Fork safety (no connection sharing)
- ✅ MySQL → Qdrant ingestion pipeline
- ✅ OpenAI embedding generation
- ✅ Progress tracking and monitoring
- ✅ Job completion detection

**Troubleshooting:**
- **Workers hang:** Check connection issues or OpenAI rate limits
- **Ingestion errors:** Check Qdrant collection setup
- **High failure rate:** Investigate record content quality

---

### Test 5: Idempotency Verification

**Purpose:** Verify that re-running the same records doesn't create duplicates.

```bash
# Run dry run twice on the same records
uv run python -m rag_python.migration.scripts.test_migration_pilot
# Wait for completion, then run again
uv run python -m rag_python.migration.scripts.test_migration_pilot
```

**Manual verification:**
```bash
# Query Qdrant to check for duplicates
# Use Qdrant dashboard or API to verify point count
```

**Expected behavior:**
- ✅ Second run should update existing points (same ID)
- ✅ No duplicate points in Qdrant
- ✅ Checksum-based deduplication works

**Check Qdrant:**
```python
from rag_python.config import get_settings
from rag_python.services.qdrant_service import QdrantService

settings = get_settings()
qdrant = QdrantService(settings)

# Get collection info
info = await qdrant.aclient.get_collection(settings.qdrant_collection_name)
print(f"Total points: {info.points_count}")
```

---

### Test 6: Error Handling

**Purpose:** Verify graceful degradation when errors occur.

**Manual test:**
1. Modify a record to have invalid content (e.g., empty `parse_content`)
2. Run dry run
3. Verify batch continues despite individual record failures

**Expected behavior:**
- ✅ Failed records logged but don't stop batch processing
- ✅ `failed_count` increments correctly
- ✅ Batch completes with partial success
- ✅ Error messages captured in logs

---

### Test 7: Resumability

**Purpose:** Verify migration can be stopped and resumed.

```bash
# Start dry run
uv run python -m rag_python.migration.scripts.test_migration_pilot

# Press Ctrl+C after 2-3 batches complete

# Run again - should prompt to resume
uv run python -m rag_python.migration.scripts.test_migration_pilot
# Answer 'Y' to resume
```

**Expected output:**
```
Found 1 active job(s)
  Job a1b2c3d4-...: running, 3/10 batches completed

Resume existing job? (Y/n): Y
Resuming job a1b2c3d4-...
Reset 0 stuck batches

Progress: 3/10 batches completed, 2 processing, 5 pending, 0 failed | Records: 30 processed, 0 failed
...continues from where it left off...
```

**What it tests:**
- ✅ Controller detects existing jobs
- ✅ Stuck batches reset correctly
- ✅ Workers pick up remaining batches
- ✅ No duplicate work
- ✅ Statistics preserved

---

### Test 8: Medium-Scale Test (1,000 Records)

**Purpose:** Test with a larger dataset to catch performance issues.

```bash
# Modify test_migration_pilot.py to use 1,000 records instead of 100
# Or set environment variable
export DRY_RUN_LIMIT=1000
uv run python -m rag_python.migration.scripts.test_migration_pilot
```

**Monitor:**
- ⏱️ Processing time per batch (~3-8 minutes expected)
- 📊 OpenAI rate limit usage
- 💾 Memory consumption
- 🔌 Connection stability

**Expected metrics:**
- ~10 batches of 100 records each
- ~30-80 minutes total time (with 2 workers)
- No memory leaks
- Stable connections throughout

---

## Production Migration Checklist

Before running the full 895K record migration:

- [ ] All 8 tests passed successfully
- [ ] Qdrant collection verified and ready
- [ ] OpenAI API rate limits checked (tier 2+ recommended)
- [ ] Qdrant storage capacity verified (~18GB needed)
- [ ] `.env` file backed up
- [ ] Supabase tables and functions verified
- [ ] Decision made on `batch_size` (100 recommended)
- [ ] Decision made on `max_workers` (3-5 recommended)
- [ ] Monitoring/alerting setup (optional)

---

## Running Production Migration

```bash
# Final settings check
cat .env | grep -E "MYSQL_|SUPABASE_|QDRANT_|OPENAI_"

# Run migration
uv run python -m rag_python.migration.controller

# Expected time: 90-240 hours (4-10 days) with 5 workers
```

**Monitoring:**
- Controller logs show progress every 5 seconds
- Check Qdrant dashboard for point count
- Monitor OpenAI usage dashboard
- Check Supabase for job statistics

**If interrupted:**
- Simply restart: `uv run python -m rag_python.migration.controller`
- Answer 'Y' to resume

---

## Troubleshooting Common Issues

### MySQL connection timeout
```
Error: Can't connect to MySQL server
```
**Solution:** Check AWS RDS security groups, verify VPN/network access

### Supabase permission denied
```
Error: 401 Unauthorized
```
**Solution:** Use service role key (not anon key) in `SUPABASE_KEY`

### OpenAI rate limit
```
Error: Rate limit exceeded
```
**Solution:** Reduce `max_workers`, upgrade OpenAI tier, or add retry logic

### Qdrant out of storage
```
Error: Not enough disk space
```
**Solution:** Upgrade Qdrant cloud plan or enable on-disk storage

### Worker crashes
```
Worker-3 (PID: 12345) terminated with exit code 1
```
**Solution:** Check worker logs for specific error, verify resource availability

---

## Next Steps

After successful testing:
1. Document any configuration adjustments made
2. Update `.env.example` with production-tested values
3. Plan monitoring strategy for production run
4. Schedule migration during low-traffic period
5. Prepare rollback plan if needed

---

## Test Results Log Template

```markdown
## Test Results - [Date]

### Test 1: MySQL Connection
- Status: ✅ / ❌
- Total records found:
- Notes:

### Test 2: Supabase Connection
- Status: ✅ / ❌
- Notes:

### Test 3: Atomic Batch Claiming
- Status: ✅ / ❌
- Duplicates detected: Yes / No
- Notes:

### Test 4: Dry Run (100 records)
- Status: ✅ / ❌
- Time taken:
- Success rate:
- Notes:

### Test 5: Idempotency
- Status: ✅ / ❌
- Duplicates in Qdrant: Yes / No
- Notes:

### Test 6: Error Handling
- Status: ✅ / ❌
- Notes:

### Test 7: Resumability
- Status: ✅ / ❌
- Notes:

### Test 8: Medium-Scale (1,000 records)
- Status: ✅ / ❌
- Time taken:
- Success rate:
- Issues encountered:

### Production Readiness: ✅ / ❌
```
