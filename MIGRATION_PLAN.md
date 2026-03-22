# Migration Plan: Replace RAG Retrieval With Sandbox-Based Retrieval

## Summary

Replace the current `rag-api` retrieval path with a per-user E2B sandbox that runs the retrieval agent and local search tooling. Keep `chat-api` as the system of record for request handling, chat history/context loading, SSE streaming, and protected-service persistence. Only the retrieval and answer-generation step moves to the sandbox.

This migration is gated by an early prototype of `qmd` inside E2B. `qmd` is not treated as a committed dependency until the prototype proves viability for indexing, retrieval quality, cold start, and incremental updates on real document samples.

Documents synced to the sandbox are text files derived from the protected/MySQL source. Some are Markdown-formatted and some are plain text or parser output. The system must not assume Markdown-only input.

## Key Changes

### 1. Keep `chat-api` responsibilities; swap only retrieval + generation

`chat-api` continues to:
- validate requests
- load chat context and history
- emit SSE events
- persist final chat entities and refs
- own citation persistence contract

Replace the current `search_knowledge` / `rag-api` path with a request to the user's sandbox.

The sandbox is responsible for:
- local file access
- local retrieval (`qmd`, `grep`, glob, or equivalent)
- answer generation
- returning streamed answer text with inline stable citations

### 2. Preserve the current citation contract

Each synced sandbox document must carry source metadata at minimum:
- `summaryId`
- `type`
- stable sandbox path

The sandbox response must include:
- streamed answer text
- inline citation markers in the answer text using stable source identifiers

`chat-api` remains responsible for:
- parsing inline citation markers from the final answer text
- converting parsed citations into the current refs format
- fetching protected summaries as needed
- persisting `refsContent`

The primary citation contract should remain inline citations in the answer text, not a separately model-authored citation object. This avoids drift between the generated answer and a second structured citation payload.

Do not rely on sandbox file paths alone as the citation contract.

### 3. Add a durable sync system between source data and sandbox filesystem

Treat protected/MySQL documents as the source of truth.

Treat the sandbox filesystem as a materialized cache.

Add a MySQL sync-state table owned by `chat-api` with fields equivalent to:
- `user_id`
- `sandbox_id`
- `summary_id`
- `type`
- `expected_path`
- `content_checksum`
- `source_updated_at`
- `last_synced_at`
- `last_indexed_at`
- `sync_status`

On each sync cycle, derive:
- files to create/update
- files to delete
- unchanged files

Sync logic must detect more than `updated_at` changes:
- deletions
- content checksum mismatches
- collection/scope changes
- sandbox recreation
- stale or orphaned sandbox files

### 4. Add sandbox drift detection and repair

Do not trust the sync-state table as proof that the sandbox is correct.

Use this model:
- source tables = desired state
- sync-state table = last known applied state
- sandbox manifest/check = observed state

Require reconciliation in these cases:
- new sandbox
- resumed sandbox
- sandbox execution failure
- periodic verification window

Verification should compare expected files against sandbox files and repair drift by re-syncing and re-indexing affected files.

### 5. Introduce sandbox lookup and isolation

Use E2B sandbox metadata to store `userId`.

Maintain `userId -> sandbox` lookup in application-owned state so multiple API replicas can resolve the same sandbox consistently.

Multiple concurrent queries for the same user must not race file sync and indexing; serialize sync/index work per sandbox.

## Prototype Gate: `qmd` in E2B

Before implementation proceeds past prototype, validate all of the following in a dedicated spike:
- `qmd` installs and runs reliably in the E2B base image.
- index creation works on representative synced user files.
- incremental indexing works for create, update, and delete flows.
- search quality is acceptable for:
  - conceptual queries
  - exact match queries
  - mixed-content files
- cold start and warm-query latency are measured.
- resource usage is measured for realistic file counts.
- index persistence across sandbox pause/resume is confirmed.

If `qmd` fails the prototype gate, choose a different sandbox-local retrieval strategy before continuing migration.

## Implementation Phases

### Phase 1: Sandbox prototype

Create an E2B sandbox template with:
- runtime dependencies for the agent
- `qmd`
- workspace directory for synced files

Build a prototype runner that:
- writes sample files
- indexes them
- executes search
- returns answer text with inline stable citations

Exit criteria:
- `qmd` viability confirmed or rejected
- cold/warm latency measured
- file/index persistence behavior documented

### Phase 2: Sync foundation

Add a MySQL sync-state table and sync service in `chat-api`.

Implement source-to-sandbox reconciliation:
- create/update/delete
- checksum validation
- sandbox manifest verification

Define a stable on-disk file format for synced docs that includes source metadata.

Exit criteria:
- sandbox content can be rebuilt from source
- drift is detected and repaired
- deletes and scope changes remove stale files correctly

### Phase 3: Sandbox agent integration

Add a sandbox request path that accepts:
- user query
- scope context
- conversation context needed for answering

Agent behavior:
- use `qmd` for conceptual retrieval if prototype passes
- use `grep`/glob for exact-match or file-pattern queries
- read top files before answering
- include inline stable citations in the answer text

Exit criteria:
- answer text streams back through `chat-api`
- inline citations are emitted in a parseable stable format
- different query classes behave as intended

### Phase 4: `chat-api` integration

Replace current `rag-api` retrieval calls with sandbox orchestration.

Keep current request/response and persistence flow intact.

Parse sandbox answer citations and map them back into existing refs persistence behavior.

Add error handling for:
- sandbox not found
- sandbox cold start
- sync failure
- retrieval failure

Exit criteria:
- end-to-end chat works with existing SSE and persistence contracts
- refs are persisted in the current format
- users remain isolated by sandbox

### Phase 5: Production hardening

Add:
- sandbox lifecycle management
- sync/index locking per sandbox
- retries and failure recovery
- metrics for sync, index, query, and sandbox health

Validate concurrency and cost with representative load.

Exit criteria:
- concurrent requests do not corrupt sync/index state
- warm and cold latency are within acceptable limits
- operational alerts and dashboards exist

## Public Interfaces / Contract Changes

Replace the internal retrieval backend contract from `rag-api search response` to `sandbox answer response`.

New sandbox response contract should include:
- streamed `answerText`
- inline citation markers in a stable parseable format compatible with the existing refs extraction flow
- optional retrieval/debug metadata for logs only

No client-facing API or SSE schema changes should be required unless existing event flow proves insufficient.

## Test Plan

Prototype tests:
- `qmd` indexing and search in E2B on mixed text inputs
- pause/resume persistence
- cold start timing

Sync tests:
- initial full sync
- update existing doc
- delete doc
- collection/scope change
- sandbox drift recovery
- sandbox recreation rebuild

Integration tests:
- end-to-end chat request through sandbox
- inline citations parsed and converted into existing refs flow
- SSE streaming preserved
- concurrent requests for one user do not race sync/index
- multiple users remain isolated

Regression tests:
- chat history loading unchanged
- protected-service persistence unchanged
- citations still resolve to protected summaries

## Assumptions

- protected/MySQL source remains the canonical document source.
- synced sandbox documents are text files; some are Markdown and some are plain text/parser output.
- `chat-api` remains the owner of chat persistence and citation persistence.
- inline stable citations in the answer text are the default contract.
- MySQL-backed sync state is the recommended default for durability and cross-replica coordination.
