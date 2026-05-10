# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MyMemo Monorepo containing the chat-api application:
- **chat-api** (TypeScript/Bun) - AI chat service at `apps/chat-api/`

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

### Deployment Environments

- `compose.yaml` - Local development
- `compose.preview.yaml` - Preview (PR testing)
- `compose.staging.yaml` - Staging
- `compose.production.yaml` - Production

## Architecture (chat-api)

### Request Flow

1. `POST /api/v1/chat` with the full `ChatRequest` payload (member/partner identity, optional history, optional client-supplied chat/refs IDs)
2. SSE stream initiated in `chat.route.ts`
3. `chat.controller.ts::complete()` orchestrates the request from the request body alone — no upstream API calls
4. Either `runSandboxChat` (when `SANDBOX_ENABLED` and `enableKnowledge`) or `core/mymemo.ts::runMyMemo()` handles streaming
5. Events emitted via SSE: `agent.message.delta`, `chat_entity`, etc.

### Key Modules

| Path | Purpose |
|------|---------|
| `src/features/chat/core/mymemo.ts` | Fallback orchestration: model streaming + update_plan tool |
| `src/features/chat/chat.controller.ts` | Reads context from request body, dispatches to sandbox or fallback path |
| `src/features/chat/chat.language-models.ts` | Model registry for 60+ models across OpenAI, Anthropic, Google |
| `src/features/chat/prompts/` | System prompts (scope-dependent: general, collection, document) |
| `src/features/chat/tools/` | AI tool definitions (currently just `update_plan`) |
| `src/config/env.ts` | Environment validation |

### Chat Scopes

- `general` - inferred when no `collectionId` / `summaryId` is provided
- `collection` - inferred when `collectionId` is provided
- `document` - inferred when `summaryId` is provided

## Code Style

- **Formatter**: Biome with tab indentation, double quotes
- **Import organization**: Enabled via Biome
- **Path aliases**: `@/*` maps to `./src/*`

## Environment Variables

Required:
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `DEEPSEEK_API_KEY`

Optional:
- `LOG_LEVEL` (default: `info`)
- `PORT` (default: 3000)
- `SANDBOX_ENABLED` (default: `false`) — enables the per-user E2B sandbox path
- `E2B_API_KEY` (required when `SANDBOX_ENABLED=true`)
- `DATABASE_URL` (required when `SANDBOX_ENABLED=true`)
- `E2B_TEMPLATE` (default: `sandbox-template-dev`)
