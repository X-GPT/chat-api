# Migration Plan: Replace RAG Retrieval With Sandbox-Based Retrieval

## Summary

Replace the current `rag-api` retrieval path with a per-user E2B sandbox that runs the retrieval agent and local search tooling. Keep `chat-api` as the system of record for request handling, chat history/context loading, SSE streaming, and protected-service persistence. Only the retrieval and answer-generation step moves to the sandbox.

Phase 1 uses local retrieval only (`grep`, glob, file reads). Vector/semantic search is deferred to a later phase once the sandbox infrastructure, sync system, and agent integration are proven.

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
- local retrieval (`grep`, glob, file reads; vector search added in a later phase)
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

Add a sync-state store owned by `chat-api` behind a `SyncStateRepository` interface (database engine — MySQL or Postgres — to be finalized later). Fields equivalent to:
- `user_id`
- `sandbox_id`
- `summary_id`
- `type`
- `expected_path`
- `content_checksum`
- `source_updated_at`
- `last_synced_at`
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

## Prototype Gate: `qmd` in E2B — REJECTED

**Status: `qmd` has failed the prototype gate. A replacement retrieval strategy is required.**

### Findings (2026-03-27)

`qmd` installs via `npm install` and its lexical search (`searchLex`) works without native compilation. However, conceptual/semantic search (`search`) depends on `node-llama-cpp`, which triggers a full source compilation of `llama.cpp` (~1.3GB GGML model + C++ build). This fails in E2B sandbox templates:

- **Native compilation fails in the E2B build VM.** The `llama.cpp` C++ compilation crashes or times out even with `NODE_LLAMA_CPP_GPU=false`. The E2B build environment does not reliably support heavy native builds.
- **Model caching does not persist across sandbox instances.** `qmd` downloads a 1.28GB model to `~/.cache/qmd/models/` on first semantic search. E2B template snapshots do not preserve the user home directory (`/home/user/`), so the model re-downloads on every sandbox creation (~22s at ~60MB/s). Symlinks from `~/.cache` into the workspace directory are also not preserved.
- **Cold start is unacceptable.** Even if compilation and caching were solved, the model download adds 20-30s to every cold sandbox start on top of the E2B boot time.

Lexical search and file indexing (create, update, delete) work correctly. Pause/resume preserves workspace files. The E2B sandbox infrastructure itself is viable — only the `qmd` semantic search path is rejected.

### Recommended alternatives

Evaluate one of the following as a `qmd` replacement for sandbox-local retrieval:

1. **`minisearch`** — Pure JS full-text search with TF-IDF ranking, fuzzy matching, and field boosting. Zero native dependencies. Handles conceptual queries via TF-IDF relevance scoring rather than embeddings.
2. **`flexsearch`** — Pure JS with built-in indexing and fast prefix/full-text search. Zero native dependencies.
3. **API-side embeddings** — Compute embeddings in `chat-api` using OpenAI/Anthropic APIs before sending to the sandbox. The sandbox receives pre-ranked document IDs and only does file reads. Moves the semantic search cost out of the sandbox entirely.
4. **`grep`/glob only** — Already available on the sandbox filesystem. No install needed. Sufficient for exact-match and keyword queries; conceptual queries would need to be handled differently (e.g., by the LLM itself via tool use).

The replacement must have zero native compilation requirements to work reliably in E2B.

## Implementation Phases

### Phase 1: Sandbox prototype with local retrieval — COMPLETE

Validated E2B sandbox infrastructure using local retrieval tools (`grep`, glob, file reads).

Results (2026-03-27):
- **Cold start**: ~2-3.5s sandbox creation from template
- **Search**: 9ms grep-based keyword search over 3 documents
- **File operations**: write, update, delete all verified
- **Persistence**: files survive sandbox pause/resume (~2-3s round-trip)
- **Citations**: inline citations parse correctly through existing `extractReferencesFromText`
- **End-to-end**: 6-10s total including sandbox create, search, mutations, persistence check, cleanup

Artifacts:
- Template: `sandbox-template/template.ts` (Node.js LTS + workspace)
- Runner: `scripts/prototype-runner.mjs` (grep-based search, uploaded to sandbox at runtime)
- Orchestrator: `scripts/run-sandbox-prototype.ts`
- Build: `bun run e2b:build:dev` / `bun run e2b:build:prod`
- Run: `E2B_TEMPLATE=sandbox-template-dev bun run prototype:sandbox <input.json>`

### Phase 2: Sync foundation — IN PROGRESS

Add a sync-state layer and sync service in `chat-api`.

**Design decisions (2026-03-27):**

- **Repository interface pattern**: Sync-state uses a `SyncStateRepository` TypeScript interface, decoupled from any specific database. The database schema (MySQL or Postgres) is finalized later when the broader refactoring settles.
- **In-memory Map initial implementation**: Development and testing use `InMemorySyncStateRepository`. A real DB adapter is added when the schema is finalized.
- **Composite key**: `(userId, summaryId)`. `sandboxId` is stored but not part of the key — it changes on sandbox recreation.
- **Caller-driven source fetching**: The sync service receives `ProtectedSummary[]` from the caller. It does not fetch from the Protected Service API itself.
- **Per-user locking**: Promise-chain pattern serializes sync operations per userId. No concurrent syncs for the same user. Distributed locking deferred to Phase 5.
- **No chat-path integration**: Phase 2 builds sync primitives only, tested via unit tests and standalone scripts. The trigger point (on-request, background, etc.) is decided in Phase 3/4.
- **`last_indexed_at` deferred**: Not needed for Phase 2 (no indexing step with grep/glob retrieval). Can be added in Phase 6 if vector search needs it.

Implement source-to-sandbox reconciliation:
- create/update/delete
- checksum validation (sha256 over materialized content including frontmatter)
- sandbox manifest verification and drift repair

Define a stable on-disk file format for synced docs that includes source metadata (reuses Phase 1 YAML frontmatter format).

Artifacts:
- Types: `src/features/sandbox/sync-state.types.ts`
- Repository interface: `src/features/sandbox/sync-state.repository.ts`
- In-memory implementation: `src/features/sandbox/sync-state.repository.memory.ts`
- Materialization: `src/features/sandbox/materialization.ts`
- Manifest verification: `src/features/sandbox/sandbox-manifest.ts`
- Sync service: `src/features/sandbox/sandbox-sync.service.ts`

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
- use `grep`/glob for keyword and exact-match retrieval
- read top files before answering
- include inline stable citations in the answer text

Exit criteria:
- answer text streams back through `chat-api`
- inline citations are emitted in a parseable stable format
- keyword and exact-match queries behave as intended

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

### Phase 6: Vector search integration

Add semantic/vector search to the sandbox retrieval layer. This phase is intentionally deferred until the sandbox infrastructure, sync system, and agent integration are proven with local retrieval.

Evaluate options:
- **API-side embeddings** — Compute embeddings in `chat-api` using OpenAI/Anthropic APIs. Store vectors alongside sync state. Pass pre-ranked document IDs to the sandbox for file reads. Keeps the sandbox free of native dependencies.
- **Pure-JS search library** (e.g., `minisearch`, `flexsearch`) — TF-IDF or BM25 ranking inside the sandbox. No native deps. Not true vector search but may be sufficient for relevance ranking.
- **External vector DB** — Use a hosted vector database (e.g., Pinecone, Qdrant). `chat-api` queries the vector DB, passes results to the sandbox. Sandbox remains a file reader.

Constraints (learned from `qmd` rejection — see Prototype Gate):
- no native compilation dependencies inside E2B
- no large model downloads at sandbox runtime
- E2B template snapshots do not preserve `/home/user/` — any cached data must live in the workspace

Exit criteria:
- conceptual/semantic queries return relevant results
- retrieval quality matches or exceeds current `rag-api` for representative queries
- latency is within acceptable limits
- integration does not regress local retrieval or citation contracts

## Public Interfaces / Contract Changes

Replace the internal retrieval backend contract from `rag-api search response` to `sandbox answer response`.

New sandbox response contract should include:
- streamed `answerText`
- inline citation markers in a stable parseable format compatible with the existing refs extraction flow
- optional retrieval/debug metadata for logs only

No client-facing API or SSE schema changes should be required unless existing event flow proves insufficient.

## Test Plan

Prototype tests:
- `grep`/glob search over mixed text inputs in E2B
- pause/resume file persistence
- cold start timing
- citation round-trip through existing parser

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
