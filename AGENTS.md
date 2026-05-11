# AGENTS.md

This file provides guidance to coding agents working in this repository.

## Behavioral Guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

### 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

### 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

### 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

Source: [forrestchang/andrej-karpathy-skills](https://github.com/forrestchang/andrej-karpathy-skills/blob/main/CLAUDE.md)

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
   - **JSON body** (`ChatBodyRequest`): chat payload — `chatContent`, optional `collectionId`/`summaryId`/`sessionId`
   - **Identity headers** (`InternalIdentity`): `X-Member-Code` (required), `X-Partner-Code` (required), `X-Team-Code`, `X-Member-Name`, `X-Partner-Name` (all optional)
2. SSE stream initiated in `chat.route.ts` after body validation (`.strict()`, rejects extra keys) and identity-header validation (401 on missing/invalid)
3. `chat.controller.ts::complete()` orchestrates the merged request — no upstream API calls
4. `runSandboxChat` is the sole agent path: forwards the turn to a per-user E2B sandbox daemon. The optional `sessionId` from the request body is passed through as the daemon's `agent_session_id`; when omitted, the daemon allocates a new session.
5. Events emitted via SSE:
   - `text_delta` — `{ text }` payload, one event per streamed token chunk; the client concatenates these to build the full response
   - `done` — `{}` payload, marks end-of-stream after the final `text_delta`
   - `session_id` — `{ sessionId }`, daemon-assigned conversation session; clients must persist and echo back to resume
   - `error` — `{ message }`, surfaced on agent or transport failure

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
