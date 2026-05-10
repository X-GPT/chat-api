# AGENTS.md

This file provides guidance to coding agents working in this repository.

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

## Architecture (chat-api)

### Request Flow

1. `POST /api/v1/chat` with:
   - **JSON body** (`ChatBodyRequest`): chat payload — `chatContent`, `chatKey`, `chatType`, optional `collectionId`/`summaryId`/client-supplied `chatId`/`refsId`
   - **Identity headers** (`InternalIdentity`): `X-Member-Code` (required), `X-Partner-Code` (required), `X-Team-Code`, `X-Member-Name`, `X-Partner-Name` (all optional)
2. SSE stream initiated in `chat.route.ts` after body validation (`.strict()`, rejects extra keys) and identity-header validation (401 on missing/invalid)
3. `chat.controller.ts::complete()` orchestrates the merged request — no upstream API calls
4. `runSandboxChat` is the sole agent path: forwards the turn to a per-user E2B sandbox daemon
5. Events emitted via SSE: `chat_entity` (streaming chat content), `error`

### Trust Boundary

Identity arrives via `X-*` headers, **not** the JSON body. chat-api does not authenticate users itself; the internal caller (gateway / BFF) is responsible for authenticating the user and forwarding their identity. The body schema uses `.strict()` so any attempt to pass identity in the body is rejected with a 400. This service must therefore only be reachable from trusted internal callers; do not expose `POST /api/v1/chat` directly to untrusted networks.

### Key Modules

| Path | Purpose |
|------|---------|
| `src/features/chat/chat.controller.ts` | Reads context from request body, hands the turn to the sandbox |
| `src/features/sandbox-orchestration/` | `runSandboxChat`, sandbox manager, daemon proxy |
| `src/features/sandbox-agent/` | Sandbox-side agent prompt + NDJSON parser |
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
- `E2B_API_KEY`
- `DATABASE_URL`

Optional:
- `LOG_LEVEL` (default: `info`)
- `PORT` (default: 3000)
- `E2B_TEMPLATE` (default: `sandbox-template-dev`)
- `DEEPSEEK_BASE_URL`
- `DEEPSEEK_DEFAULT_MODEL` (default: `deepseek-v4-flash`)
