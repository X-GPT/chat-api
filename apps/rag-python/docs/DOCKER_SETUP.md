# Docker Multi-Service Setup Guide

## Overview

This guide covers the Docker setup for the RAG Python services (API + Worker) with managed Qdrant.

## What Was Implemented

### 1. Production-Optimized Dockerfile ✅

**Location:** `apps/rag-python/Dockerfile`

**Architecture:**
- **Builder stage**: Uses official uv image (ghcr.io/astral-sh/uv:0.8.22-python3.13-trixie-slim)
- **API target**: Slim Python image with FastAPI service
- **Worker target**: Slim Python image with SQS worker

**Key Features:**
- ✅ Multi-stage build (smaller final images)
- ✅ Non-root user (security)
- ✅ Docker cache mounts (faster builds)
- ✅ Pre-compiled bytecode (faster startup)
- ✅ Health checks for both services

### 2. Docker Compose Files ✅

All compose files have been updated:

**`compose.yaml` (Local Development)**
- Removed: `ingest-worker` (TypeScript)
- Added: `rag-api` and `rag-worker` (Python)
- Worker replicas: 1

**`compose.staging.yaml`**
- CloudWatch logging enabled
- Memory: 1GB per service
- Worker replicas: 2

**`compose.production.yaml`**
- CloudWatch logging enabled
- Memory: 2GB per service
- Worker replicas: 3

**`compose.preview.yaml`**
- CloudWatch logging enabled
- Memory: 512MB per service
- Worker replicas: 1 (default)

### 3. Configuration Files ✅

- **`.dockerignore`**: Excludes unnecessary files from builds
- **`.env.docker.example`**: Template for environment variables
- **`config.py`**: Added Qdrant configuration settings

## Testing the Setup

### Local Development Testing

1. **Start Docker daemon:**
```bash
# macOS/Linux
sudo systemctl start docker

# macOS with Docker Desktop
open -a Docker
```

2. **Build images:**
```bash
cd apps/rag-python

# Build API image
docker build --target api -t rag-api:latest .

# Build Worker image
docker build --target worker -t rag-worker:latest .
```

3. **Create local .env file:**
```bash
cp .env.docker.example .env
# Edit .env with your actual credentials
```

4. **Start services:**
```bash
cd /Users/chengchao/code/mymemo/chat-api
docker-compose up -d rag-api rag-worker
```

5. **Verify services:**
```bash
# Check API health
curl http://localhost:8000/api/v1/health

# View worker logs
docker-compose logs -f rag-worker

# Check running containers
docker ps | grep rag
```

### Worker Scaling

```bash
# Scale to 3 workers
docker-compose up -d --scale rag-worker=3

# Scale back to 1
docker-compose up -d --scale rag-worker=1

# View all worker instances
docker ps -f name=rag-worker
```

## Deployment Checklist

### Before Deploying

- [ ] Create environment files:
  - `/etc/mymemo/rag-python/env.staging`
  - `/etc/mymemo/rag-python/env.prod`
  - `/etc/mymemo/rag-python/env.dev` (for preview)

- [ ] Set required environment variables:
  - `RAG_API_IMAGE` - Docker image for API
  - `RAG_WORKER_IMAGE` - Docker image for Worker
  - `RAG_API_PORT` - Port for API service

- [ ] Configure Qdrant:
  - Create Qdrant cluster
  - Get API key
  - Add to environment files

- [ ] Configure SQS:
  - Create SQS queue
  - Set up IAM roles/keys
  - Add queue URL to environment

### Staging Deployment

```bash
# Build and push images
docker build --target api -t ${RAG_API_IMAGE} .
docker build --target worker -t ${RAG_WORKER_IMAGE} .
docker push ${RAG_API_IMAGE}
docker push ${RAG_WORKER_IMAGE}

# Deploy
docker-compose -f compose.staging.yaml up -d
```

### Production Deployment

```bash
# Build and push images
docker build --target api -t ${RAG_API_IMAGE} .
docker build --target worker -t ${RAG_WORKER_IMAGE} .
docker push ${RAG_API_IMAGE}
docker push ${RAG_WORKER_IMAGE}

# Deploy
docker-compose -f compose.production.yaml up -d
```

## Monitoring

### Health Checks

**API:**
```bash
curl http://localhost:8000/api/v1/health
```

**Worker:**
```bash
docker exec rag-worker pgrep -f "rag_python.worker.worker"
```

### Logs

**View logs:**
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f rag-api
docker-compose logs -f rag-worker

# CloudWatch (staging/production)
aws logs tail /apps/rag-python --follow
aws logs tail /apps/rag-python-staging --follow
```

### Metrics to Monitor

- **API:**
  - Request rate
  - Response times
  - Error rates
  - Memory usage

- **Worker:**
  - Messages processed
  - Processing time
  - Error rates
  - Queue depth

## Troubleshooting

### Build Issues

**Problem:** Cache mount errors
```bash
# Solution: Enable BuildKit
export DOCKER_BUILDKIT=1
docker build --target api -t rag-api .
```

**Problem:** Permission denied
```bash
# Solution: Run as non-root or fix permissions
docker build --progress=plain --target api -t rag-api .
```

### Runtime Issues

**Problem:** Health check failing
```bash
# Check logs
docker logs rag-api
docker logs rag-worker

# Verify network
docker network inspect mymemo_default
```

**Problem:** Worker not processing messages
```bash
# Check SQS configuration
docker exec rag-worker env | grep SQS

# Check worker logs
docker logs rag-worker --tail 100 -f
```

## Image Sizes

**Expected sizes:**
- Builder stage: ~400MB (not shipped)
- API final: ~300MB
- Worker final: ~300MB

Much smaller than including uv in final images (~500MB+)

## Security Notes

1. **Non-root user**: Both images run as `nonroot:999`
2. **No build tools**: Final images don't include uv or compiler
3. **Minimal base**: Using slim Python images
4. **Environment secrets**: Use Docker secrets or env files (not in images)

## Performance Optimizations

1. **Bytecode compilation**: `UV_COMPILE_BYTECODE=1` - faster startup
2. **Docker cache**: BuildKit cache mounts - faster builds
3. **Layer caching**: Dependencies cached separately from code
4. **Link mode**: `UV_LINK_MODE=copy` - better for Docker layers

## Next Steps

1. **Test builds locally** (when Docker daemon is running)
2. **Create CI/CD pipelines** for automated builds
3. **Set up monitoring** (Prometheus/Grafana)
4. **Configure auto-scaling** based on queue depth
5. **Add Qdrant client** for actual RAG functionality

## References

- [uv Docker Guide](https://docs.astral.sh/uv/guides/integration/docker/)
- [FastAPI Deployment](https://fastapi.tiangolo.com/deployment/)
- [Docker Multi-Stage Builds](https://docs.docker.com/build/building/multi-stage/)

