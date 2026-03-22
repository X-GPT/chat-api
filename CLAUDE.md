# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyMemo Monorepo containing two applications:
- **chat-api** (TypeScript/Bun) - AI chat service at `apps/chat-api/`
- **rag-python** (Python) - RAG service at `apps/rag-python/`

## Commands

### chat-api (apps/chat-api/)

```bash
# Development
bun install          # Install dependencies
bun run dev          # Start dev server with hot reload at localhost:3000

# Code quality (Biome)
bun run lint         # Lint and auto-fix
bun run format       # Format code

# Docker
docker build -t chat-api .
docker-compose up    # Local development
```

### rag-python (apps/rag-python/)

```bash
uv sync
source .venv/bin/activate
```

### Deployment Environments

- `compose.yaml` - Local development
- `compose.preview.yaml` - Preview (PR testing)
- `compose.staging.yaml` - Staging
- `compose.production.yaml` - Production

## Architecture (chat-api)

### Request Flow

1. `POST /api/v1/chat` with headers `X-Member-Auth`, `X-Member-Code`
2. SSE stream initiated in `chat.route.ts`
3. `chat.controller.ts::complete()` orchestrates the request
4. `core/mymemo.ts::runMyMemo()` handles AI streaming and tool execution
5. Events emitted via SSE: `agent.message.delta`, `chat_entity`, `citations.updated`, etc.

### Key Modules

| Path | Purpose |
|------|---------|
| `src/features/chat/core/mymemo.ts` | Main orchestration: model streaming, tool execution, event emission |
| `src/features/chat/chat.controller.ts` | Request handling: fetches context, builds session, persists results |
| `src/features/chat/chat.language-models.ts` | Model registry for 60+ models across OpenAI, Anthropic, Google |
| `src/features/chat/prompts/` | System prompts (scope-dependent: general, collection, document) |
| `src/features/chat/tools/` | AI tool definitions: search, read, plan, list files |
| `src/config/env.ts` | Environment validation and URL builders |

### Chat Scopes

- `general` - Full knowledge access across all documents
- `collection` - Limited to one collection
- `document` - Limited to single file

Tools available vary by scope and `enableKnowledge` flag.

### External Integrations

- **Protected Chat Service** - User context, chat history, message persistence
- **RAG Service** - Document search at `http://rag-api:8000`

## Code Style

- **Formatter**: Biome with tab indentation, double quotes
- **Import organization**: Enabled via Biome
- **Path aliases**: `@/*` maps to `./src/*`

## Environment Variables

Required:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `PROTECTED_API_TOKEN`

Optional:
- `PROTECTED_API_ORIGIN` (default: `http://127.0.0.1`)
- `PROTECTED_API_PREFIX` (default: `/beta-api`)
- `RAG_API_ORIGIN` (default: `http://rag-api:8000`)
- `LOG_LEVEL` (default: `info`)
- `PORT` (default: 3000)
