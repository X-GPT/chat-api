# Builder stage - uses uv for dependency management
FROM ghcr.io/astral-sh/uv:0.8.22-python3.13-trixie-slim AS builder

# Performance optimizations
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

# Use system Python (don't download)
ENV UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# Install dependencies (cached separately from code)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=vendored,target=vendored \
    uv sync --locked --no-install-project --no-dev

# Copy application code
COPY . /app

# Install project
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-dev

# API target - slim Python image without uv
FROM python:3.13-slim-trixie AS api

# Create non-root user
RUN groupadd --system --gid 999 nonroot \
 && useradd --system --gid 999 --uid 999 --create-home nonroot

# Copy application from builder
COPY --from=builder --chown=nonroot:nonroot /app /app

# Add venv to PATH
ENV PATH="/app/.venv/bin:$PATH"

# Use non-root user
USER nonroot
WORKDIR /app

# Expose port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python - <<'PY'
import sys, urllib.request, os
port = os.getenv("HEALTH_PORT", "8000")
endpoint = os.getenv("HEALTH_ENDPOINT", "/api/v1/health")
try:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{endpoint}", timeout=5) as r:
        sys.exit(0 if r.status == 200 else 1)
except Exception:
    sys.exit(1)
PY

# Run FastAPI
CMD ["fastapi", "run", "src/rag_python/main.py", "--host", "0.0.0.0", "--port", "8000"]

# Worker target - slim Python image without uv
FROM python:3.13-slim-trixie AS worker

# Create non-root user
RUN groupadd --system --gid 999 nonroot \
 && useradd --system --gid 999 --uid 999 --create-home nonroot

# Copy application from builder
COPY --from=builder --chown=nonroot:nonroot /app /app

# Add venv to PATH
ENV PATH="/app/.venv/bin:$PATH"

# Use non-root user
USER nonroot
WORKDIR /app

# Health check (check /healthz endpoint)
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD python - <<'PY'
import sys, urllib.request, os
port = os.getenv("HEALTH_PORT", "8080")
endpoint = os.getenv("HEALTH_ENDPOINT", "/healthz")
try:
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{endpoint}", timeout=5) as r:
        sys.exit(0 if r.status == 200 else 1)
except Exception:
    sys.exit(1)
PY

# Run worker
CMD ["python", "-m", "rag_python.worker.worker"]

