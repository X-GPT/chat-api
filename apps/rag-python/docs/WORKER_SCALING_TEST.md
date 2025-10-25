# Worker Scaling Test Plan

## Objective
Determine optimal worker count by identifying bottlenecks in the migration pipeline.

## Test Matrix

Run 100 records with different worker counts and measure:
1. Total time
2. OpenAI API errors (429 rate limit)
3. Qdrant errors (timeouts)
4. Memory usage

### Test Configuration

```bash
# In .env
BATCH_SIZE=50  # Keep constant
```

### Test Runs

| Test | Workers | Expected Speedup | What to Check |
|------|---------|-----------------|---------------|
| 1    | 1       | Baseline (60s)  | Baseline metrics |
| 2    | 2       | 2x (30s)        | Linear scaling? |
| 3    | 5       | 5x (12s)        | Still linear? |
| 4    | 10      | 10x (6s)        | OpenAI 429 errors? |
| 5    | 20      | 20x (3s)        | Bottleneck identified |

## Commands

```bash
# Test 1: 1 worker
uv run python -m rag_python.migration.scripts.test_migration_pilot \
  --max-records 100 --workers 1

# Test 2: 2 workers
uv run python -m rag_python.migration.scripts.test_migration_pilot \
  --max-records 100 --workers 2

# Test 3: 5 workers
uv run python -m rag_python.migration.scripts.test_migration_pilot \
  --max-records 100 --workers 5

# Test 4: 10 workers
uv run python -m rag_python.migration.scripts.test_migration_pilot \
  --max-records 100 --workers 10

# Test 5: 20 workers
uv run python -m rag_python.migration.scripts.test_migration_pilot \
  --max-records 100 --workers 20
```

## What to Look For

### 1. Check OpenAI Logs for Rate Limits
```bash
# In worker logs, look for:
"Rate limit exceeded" or "429" errors
```

If you see these → **OpenAI is the bottleneck**

### 2. Check Scaling Efficiency

```
Workers | Time (seconds) | Speedup | Efficiency
--------|----------------|---------|------------
1       | 60             | 1x      | 100%
2       | 30             | 2x      | 100%  ✅ Linear
5       | 12             | 5x      | 100%  ✅ Linear
10      | 8              | 7.5x    | 75%   ⚠️ Sublinear (bottleneck detected)
20      | 6              | 10x     | 50%   ❌ Heavy bottleneck
```

**Linear scaling** (100% efficiency) → No bottleneck, can add more workers
**Sublinear scaling** (<80% efficiency) → Bottleneck detected, don't add more workers

### 3. Check Memory Growth

```bash
# Monitor during test
watch -n 1 'ps aux | grep python | grep worker'
```

Expected: 525MB per worker
- 5 workers: ~2.6GB
- 10 workers: ~5.2GB
- 20 workers: ~10.5GB

If your machine has <16GB RAM → **Memory is the bottleneck**

### 4. Check Qdrant Performance

Look in Qdrant Cloud dashboard or logs:
- Throughput (writes/sec)
- Latency (p95, p99)
- Error rate

If latency spikes or errors appear → **Qdrant is the bottleneck**

## Decision Matrix

| Observation | Bottleneck | Action |
|-------------|------------|--------|
| Scaling stops at 2-3 workers + 429 errors | OpenAI Tier 1 | Upgrade OpenAI tier OR keep 2 workers |
| Scaling stops at 8-10 workers + 429 errors | OpenAI Tier 2 | Upgrade to Tier 3 OR keep 8 workers |
| Qdrant timeouts at >5 workers | Qdrant Free/Starter | Upgrade Qdrant OR keep 5 workers |
| Memory exceeds 80% at X workers | RAM | Add RAM OR use max X workers |
| Linear scaling up to 20 workers | No bottleneck! | Use 20 workers ✅ |

## Recommended Production Config

After testing, set in `.env`:

```bash
# Conservative (works for most setups)
MAX_WORKERS=5
BATCH_SIZE=50

# Aggressive (if tests show linear scaling to 20)
MAX_WORKERS=20
BATCH_SIZE=50
MYSQL_POOL_SIZE=50  # Increase pool

# Memory-constrained (small machine)
MAX_WORKERS=2
BATCH_SIZE=100  # Larger batches to reduce overhead
```
