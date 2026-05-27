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

MyMemo Monorepo (Bun workspaces) containing:
- **chat-api** (`apps/chat-api/`) - AI chat service; orchestrates per-user E2B sandboxes
- **sandbox-daemon** (`apps/sandbox-daemon/`) - in-sandbox HTTP daemon; bundled and shipped into E2B
- **llm-gateway** (`apps/llm-gateway/`) - control plane; the only service holding the real `ANTHROPIC_API_KEY`. Verifies the per-turn bearer token and proxies to Anthropic
- **@mymemo/db** (`packages/db/`), **@mymemo/llm-token** (`packages/llm-token/`) - shared packages

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
   - **JSON body** (`ChatBodyRequest`): chat payload — `chatContent`, optional `collectionId`/`summaryId`/`sessionId`/`sandboxId`
   - **Identity headers** (`InternalIdentity`): `X-Member-Code` (required), `X-Partner-Code` (required), `X-Team-Code`, `X-Member-Name`, `X-Partner-Name` (all optional)
2. SSE stream initiated in `chat.route.ts` after body validation (`.strict()`, rejects extra keys) and identity-header validation (401 on missing/invalid)
3. `chat.controller.ts::complete()` orchestrates the merged request — no upstream API calls
4. `runSandboxChat` is the sole agent path: forwards the turn to a per-user E2B sandbox daemon. The optional `sessionId` from the request body is passed through as the daemon's `agent_session_id`; when omitted, the daemon allocates a new session. The optional `sandboxId` is used to reconnect to an existing E2B sandbox; when omitted (or reconnection fails), a new sandbox is created. chat-api also mints a short-lived `@mymemo/llm-token` bound to `{userId, sandboxId, requestId}` and sends it (with `LLM_GATEWAY_PUBLIC_URL`) in the turn body. The daemon sets these as `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` on the agent process, so **the sandbox never holds a provider key** — all LLM calls route through `llm-gateway`, which validates the token and injects the real `ANTHROPIC_API_KEY`.
5. Events emitted via SSE:
   - `text_delta` — `{ text }` payload, one event per streamed token chunk; the client concatenates these to build the full response
   - `done` — `{}` payload, marks end-of-stream after the final `text_delta`
   - `session_id` — `{ sessionId }`, daemon-assigned conversation session; clients must persist and echo back to resume
   - `sandbox_id` — `{ sandboxId }`, the active E2B sandbox; clients must persist and echo back to reuse the same sandbox across requests
   - `error` — `{ message }`, surfaced on agent or transport failure

### Trust Boundary

Identity arrives via `X-*` headers, **not** the JSON body. chat-api does not authenticate users itself; the internal caller (gateway / BFF) is responsible for authenticating the user and forwarding their identity. The body schema uses `.strict()` so any attempt to pass identity in the body is rejected with a 400. This service must therefore only be reachable from trusted internal callers; do not expose `POST /api/v1/chat` directly to untrusted networks.

The sandboxed agent is treated as untrusted (it runs prompt-injectable, Bash-capable code). It holds no provider key — only a short-lived, single-user, signed bearer token. The single inbound edge from a sandbox is **sandbox → llm-gateway**; `llm-gateway` holds `ANTHROPIC_API_KEY` + `LLM_TOKEN_SECRET` and should only be reachable from sandboxes (and only reach `api.anthropic.com` outbound). chat-api and llm-gateway share `LLM_TOKEN_SECRET` (chat-api mints, gateway verifies); the daemon never sees it.

### Key Modules

| Path | Purpose |
|------|---------|
| `src/features/chat/chat.controller.ts` | Reads context from request body, hands the turn to the sandbox |
| `src/features/sandbox-orchestration/` | `runSandboxChat`, sandbox manager, daemon proxy; mints the per-turn LLM token |
| `src/features/sandbox-agent/` | Sandbox-side agent system prompt builder |
| `src/config/env.ts` | Environment validation |
| `apps/llm-gateway/src/index.ts` | Control-plane proxy: verifies token, injects `ANTHROPIC_API_KEY`, forwards to Anthropic |
| `packages/llm-token/index.ts` | `mintLlmToken` / `verifyLlmToken` (shared, HMAC-signed) |

### Chat Scopes

- `general` - inferred when no `collectionId` / `summaryId` is provided
- `collection` - inferred when `collectionId` is provided
- `document` - inferred when `summaryId` is provided

## Code Style

- **Formatter**: Biome with tab indentation, double quotes
- **Import organization**: Enabled via Biome
- **Path aliases**: `@/*` maps to `./src/*`

## Environment Variables

### chat-api

Required:
- `E2B_API_KEY`
- `DATABASE_URL`
- `DAEMON_AUTH_TOKEN`
- `LLM_TOKEN_SECRET` — HMAC secret for minting per-turn LLM tokens (shared with llm-gateway)
- `LLM_GATEWAY_PUBLIC_URL` — gateway base URL the sandbox agent uses; **must be reachable from inside the E2B sandbox**

Optional:
- `LOG_LEVEL` (default: `info`)
- `PORT` (default: 3000)
- `E2B_TEMPLATE` (default: `sandbox-template-dev`)

### llm-gateway

Required:
- `ANTHROPIC_API_KEY` — the real provider key; lives **only** in this service
- `LLM_TOKEN_SECRET` — must match chat-api's

Optional:
- `UPSTREAM_BASE_URL` (default: `https://api.anthropic.com`)
- `PORT` (default: 8081)
