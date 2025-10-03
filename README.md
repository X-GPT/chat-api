# MyMemo Monorepo

This repository contains multiple projects for the MyMemo ecosystem.

## Projects

### 🔷 chat-api (TypeScript)

Chat API service built with TypeScript/Bun.

**Location:** `apps/chat-api/`

**Setup:**
```bash
cd apps/chat-api
bun install
bun run dev
```

See [apps/chat-api/README.md](./apps/chat-api/README.md) for detailed documentation.

### 🐍 rag-python (Python)

RAG (Retrieval-Augmented Generation) service built with Python and uv.

**Location:** `apps/rag-python/`

**Setup:**
```bash
cd apps/rag-python
uv sync
source .venv/bin/activate
```

See [apps/rag-python/README.md](./apps/rag-python/README.md) for detailed documentation.

## Shared Infrastructure

The following directories contain shared infrastructure and deployment configuration:

- `infra/` - Infrastructure configuration (nginx templates, etc.)
- `scripts/` - Deployment and utility scripts
- `compose*.yaml` - Docker Compose configurations for different environments

## Repository Structure

```
.
├── apps/               # Deployable applications
│   ├── chat-api/       # TypeScript chat API service
│   │   ├── src/
│   │   ├── package.json
│   │   └── ...
│   └── rag-python/     # Python RAG service
│       ├── src/
│       ├── pyproject.toml
│       └── ...
├── infra/              # Shared infrastructure
├── scripts/            # Shared scripts
├── compose*.yaml       # Shared Docker Compose files
└── README.md           # This file
```

### Future Growth

As the monorepo grows, you can add:
- `packages/` - Shared libraries and utilities
- `tools/` - Development tools and scripts
- `docs/` - Centralized documentation

## Development

Each project can be developed independently. Navigate to the respective project directory and follow its setup instructions.

## Deployment

Deployment configurations are managed at the root level using Docker Compose files:

- `compose.yaml` - Local development
- `compose.preview.yaml` - Preview environment
- `compose.staging.yaml` - Staging environment
- `compose.production.yaml` - Production environment

