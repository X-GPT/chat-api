# Migration Plan: Per-User Sandbox Daemon with State Reconciliation

## Summary

Use one E2B sandbox per user and make the sandbox the execution owner for that user.

- Postgres is the source of truth for current knowledge state.
- Each user stores a `sandbox_id`.
- The sandbox contains a Bun-powered Hono daemon started from the E2B template.
- The daemon keeps an in-memory FIFO queue and processes one request at a time.
- Before answering, the daemon reconciles Postgres file state into the sandbox filesystem.
- The Claude agent runs only inside the sandbox and answers by scanning sandbox files with filesystem tools.
- Chat turns are best-effort: if the sandbox dies mid-turn, the user resends.

This version does not use revision ops. It uses current DB state plus precomputed file checksums.

Phase 1 uses local retrieval only (`grep`, glob, file reads). Vector/semantic search is deferred to a later phase once the sandbox infrastructure, sync system, and agent integration are proven.

Documents synced to the sandbox are text files derived from the protected/MySQL source. Some are Markdown-formatted and some are plain text or parser output. The system must not assume Markdown-only input.

## Key Design

### 1. Postgres knowledge model

Store current file state only.

Per file row, keep:

- `user_id`
- `path`
- `content`
- `checksum`
- `updated_at`
- optional logical metadata needed by the app

Per user, keep:

- `state_version` — incremented on every committed knowledge change

Runtime metadata per user:

- `sandbox_id`
- `agent_session_id`
- `synced_version`
- `sandbox_status`
- `last_seen_at`

Rules:

- every app write updates current file state in Postgres
- every app write recomputes checksum for changed files
- every successful write transaction increments `state_version`
- `state_version` is the sync trigger; checksum is the diff signal

### 2. Sandbox lifecycle and daemon

Bake the daemon into the E2B template.

Template behavior:

- install Bun, app code, and dependencies
- E2B template start command: `bun run /app/daemon.ts`
- E2B template ready command: `curl -fsS http://127.0.0.1:3000/health`

Runtime behavior:

- API loads `sandbox_id` for the user
- if sandbox is valid, reconnect to it
- if sandbox is missing/unhealthy, create a new sandbox from template and update `sandbox_id`
- API never starts the daemon during request handling

### 3. In-sandbox daemon behavior

Run a Hono server inside the sandbox as the only executor for that user.

Endpoints:

- `GET /health`
- `POST /enqueue`
- `GET /current`
- optional `POST /cancel`

Behavior:

- keep an in-memory FIFO queue
- allow exactly one active request at a time
- for each request:
    1. reconcile sandbox files to latest required DB state
    2. run Claude Agent SDK
    3. stream output
    4. persist updated `agent_session_id`
    5. update `synced_version` after successful reconciliation

Important rule: only the daemon may run Claude or mutate sandbox-local runtime state.

### 4. State reconciliation flow

The daemon syncs by comparing authoritative DB state with sandbox-local synced state.

Inputs:

- user `state_version` from Postgres
- file manifest from Postgres: `path → checksum`
- sandbox local manifest file (`.sync-manifest.json`): `path → checksum`

Flow for each chat request:

1. API includes the user's current `state_version` as `required_version`.
2. Daemon reads `synced_version`.
3. If `synced_version >= required_version`, skip reconciliation.
4. Otherwise fetch the full DB manifest and changed file contents as needed.
5. Compare DB manifest with sandbox local manifest.
6. Apply:
    - create/update files whose checksum differs or are missing
    - delete files present locally but absent in DB manifest
7. Write the new local manifest in sandbox.
8. Persist `synced_version = required_version` in Postgres.
9. Run Claude only after reconciliation completes.

Rules:

- do not compare DB `updated_at` directly with filesystem mtimes
- use checksum as the content identity signal
- canonical sandbox root: `/workspace/data`

### 5. Streaming path

Use the API as a synchronous stream proxy.

Flow:

1. client sends chat request to main API
2. API resolves sandbox and daemon URL
3. API forwards request to daemon `POST /enqueue`
4. daemon waits in local FIFO
5. once active, daemon returns a streaming HTTP response
6. API relays the stream to the client over SSE
7. when daemon completes, API closes client stream

Daemon-to-API event format: NDJSON with `started`, `text_delta`, `completed`, `failed`.

Uses E2B sandbox public URL support via `sandbox.getHost(port)`.

### 6. Failure policy

Keep v1 best-effort and simple.

Rules:

- if client disconnects, the stream is lost
- if sandbox crashes mid-turn, the request is lost and user resends
- if daemon health check fails, API recreates sandbox from template
- on new sandbox creation, daemon rebuilds local files by reconciling from Postgres state
- if `agent_session_id` is invalid, create a new agent session in the same sandbox

No durable external queue for chat turns in v1.

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

### Phase 2: Sync foundation — COMPLETE

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
- Types: `src/features/sandbox-orchestration/sandbox-sync-types.ts`
- State management: `src/features/sandbox-orchestration/sandbox-sync-state.ts`
- Sync planner: `src/features/sandbox-orchestration/sandbox-sync-planner.ts`
- Sync apply: `src/features/sandbox-orchestration/sandbox-sync-apply.ts`
- Sync archive: `src/features/sandbox-orchestration/sandbox-sync-archive.ts`
- Sync service: `src/features/sandbox-orchestration/sandbox-sync-service.ts`
- Materialization: `src/features/sandbox/materialization.ts`
- Fetch summaries: `src/features/sandbox-orchestration/fetch-all-summaries.ts`

Exit criteria:
- sandbox content can be rebuilt from source
- drift is detected and repaired
- deletes and scope changes remove stale files correctly

### Phase 3: Sandbox agent integration — COMPLETE

Add a sandbox request path that accepts:
- user query
- scope context
- conversation context needed for answering

**Design decisions (2026-03-27):**

- **Claude Agent SDK inside sandbox**: LLM orchestration runs inside the E2B sandbox using `@anthropic-ai/claude-agent-sdk` with built-in tools (Bash, Read, Grep, Glob). Chat-api uploads an agent runner script and streams NDJSON results back via `sandbox.commands.run()` with `onStdout` callback.
- **NDJSON streaming protocol**: Agent runner writes `{"type":"text_delta","text":"..."}` and `{"type":"result","text":"..."}` lines to stdout. Chat-api parses these and forwards to SSE.
- **Collection-aware directory structure**: Files organized as `docs/{userId}/{type}/{summaryId}.txt` (general scope) with copies in `docs/{userId}/collections/{collectionId}/{type}/{summaryId}.txt` for collection scope. Agent `cwd` is set per scope to restrict tool access.
- **API key per-command**: `ANTHROPIC_API_KEY` passed via E2B `envs` option on each command, not baked into the template.

Agent behavior:
- Claude Agent SDK handles agentic loop with built-in Grep/Read/Glob tools
- Searches and reads local `.txt` files with YAML frontmatter
- Includes inline stable citations in `[[N]][cN]` format with `[cN]: detail/{type}/{summaryId}` definitions

Artifacts:
- Template update: `sandbox-template/template.ts` (adds Claude Code + Agent SDK)
- Agent runner: `src/features/sandbox-agent/agent-runner.mjs`
- Orchestration: `src/features/sandbox-agent/sandbox-agent.ts`
- System prompt: `src/features/sandbox-agent/sandbox-agent.prompt.ts`
- NDJSON parser: `src/features/sandbox-agent/ndjson-parser.ts`
- Types: `src/features/sandbox-agent/sandbox-agent.types.ts`
- Collection materialization: `src/features/sandbox/materialization.ts` (extended)
- Integration test: `scripts/run-sandbox-agent.ts`

Exit criteria:
- answer text streams back through `chat-api`
- inline citations are emitted in a parseable stable format
- keyword and exact-match queries behave as intended

### Phase 4: `chat-api` integration — COMPLETE (inline sync)

Replace current `rag-api` retrieval calls with sandbox orchestration, gated behind a feature flag.

> **Note:** Phase 4 is complete as implemented — the sandbox path works end-to-end with inline sync on the request path (`sandbox-orchestration.ts` calls `ensureInitialSync()`/`runIncrementalSync()` before `runSandboxAgent()`). Phase 4b replaces this with a per-user sandbox daemon that owns sync and agent execution.

**Design decisions (2026-03-28):**

- **Feature-flagged coexistence**: `SANDBOX_ENABLED` env var (defaults to `false`). When enabled and `enableKnowledge` is true, the sandbox path replaces `runMyMemo()`. The existing RAG path is completely unchanged — no RAG code removed or modified.
- **Branch at controller level**: The sandbox agent replaces the entire tool-calling loop (search + read + answer generation), not just a single tool. The branch is in `chat.controller.ts::complete()` after building config and conversation history.
- **Sandbox lifecycle via E2B SDK**: `SandboxManager` uses `Sandbox.list()` (metadata query by userId) to find existing sandboxes, `Sandbox.connect()` to reconnect, or `Sandbox.create()` to make new ones. A sandboxId cache avoids the list API call on every request.
- **Session resume for conversation history**: Instead of serializing chat history as text, the Claude Agent SDK's `resume: sessionId` parameter is used. The agent runner captures and emits session IDs via NDJSON. `SessionStore` maps `chatKey → sessionId` in memory (24h TTL, 10k max entries).
- **Sync is a separate concern**: This phase does not own document sync. The sandbox is assumed to be pre-synced by a separate sync service (Phase 4b). The integration test uses `SandboxSyncService` from Phase 2 directly for testing. The `sandbox.files.write()` API accepts arrays for batch writes, eliminating the N-round-trip concern that originally motivated sandbox-side sync.
- **Shared callbacks**: `onTextDelta`/`onTextEnd` callbacks are extracted as shared functions in the controller, used by both RAG and sandbox paths. Citation extraction in `onTextEnd` works unchanged because both paths produce the same `[cN]: detail/{type}/{summaryId}` format.
- **Retry only infra errors**: Only `SandboxCreationError` triggers a retry (one attempt). Agent/LLM errors propagate immediately.

Artifacts:
- Orchestration: `src/features/sandbox-orchestration/sandbox-orchestration.ts`
- Sandbox lifecycle: `src/features/sandbox-orchestration/sandbox-manager.ts`
- Session store: `src/features/sandbox-orchestration/session-store.ts`
- Error types: `src/features/sandbox-orchestration/errors.ts`
- Controller changes: `src/features/chat/chat.controller.ts` (feature-flagged branch)
- Agent runner update: `src/features/sandbox-agent/agent-runner.mjs` (session resume)
- NDJSON parser update: `src/features/sandbox-agent/ndjson-parser.ts` (session_id event)
- Integration test: `scripts/run-phase4-integration.ts`

Exit criteria:
- end-to-end chat works with existing SSE and persistence contracts
- refs are persisted in the current format
- users remain isolated by sandbox
- session resume preserves conversation context across queries
- `SANDBOX_ENABLED=false` uses existing RAG path with zero change

### Phase 4b: Per-user sandbox daemon with state reconciliation — IN PROGRESS

Replace chat-api-orchestrated sandbox execution with a per-user daemon that owns the full lifecycle: state reconciliation, agent execution, and streaming.

#### Superseded: SQS approach

SQS FIFO infrastructure was deployed to staging and production (queues, DLQs, CloudWatch alarms, Terraform CI/CD) as a candidate for decoupling sync from the request path. This approach has been superseded by the in-sandbox daemon pattern, which moves sync responsibility into the sandbox itself.

Infrastructure artifacts remain in the repo:
- `infra/terraform/bootstrap/` — S3 state bucket, GitHub OIDC provider, IAM roles
- `infra/terraform/sandbox-sync/` — SQS FIFO queues, CloudWatch alarms, IAM policies
- `.github/workflows/terraform-sandbox-sync.yml` — Terraform CI/CD

#### Design decisions (2026-04-06):

- **Bun-powered Hono daemon (no PM2)**: The daemon runs directly via `bun run /app/daemon.ts`. Bun is consistent with chat-api's runtime, provides native TypeScript execution, and avoids PM2 overhead. E2B template start/ready commands handle lifecycle; crash recovery is handled at the sandbox level (API recreates the sandbox).
- **Postgres knowledge model**: Replaces the in-memory `SyncStateRepository` with Postgres as the durable source of truth. Per-file rows with `checksum` enable content-identity-based diffing. Per-user `state_version` is the sync trigger — incremented on every committed knowledge change.
- **Daemon-side reconciliation**: The daemon compares its local `.sync-manifest.json` against the DB manifest before each agent turn. This eliminates the need for chat-api to orchestrate sync — the daemon is self-healing.
- **In-memory FIFO queue**: The daemon serializes requests per user with an in-memory queue. No distributed locking needed — each user has exactly one sandbox with one daemon.
- **Streaming via `sandbox.getHost(port)`**: The API acts as a synchronous stream proxy, forwarding to the daemon's `POST /enqueue` endpoint and relaying NDJSON events as SSE.

Artifacts (to build):
- E2B template update: `sandbox-template/template.ts` (Bun + Hono daemon, deps)
- Daemon source: `/app/daemon.ts` (Hono server, FIFO queue, reconciliation, agent runner)
- Postgres schema: knowledge files table (`user_id`, `path`, `content`, `checksum`, `updated_at`), user runtime metadata (`sandbox_id`, `agent_session_id`, `synced_version`, `sandbox_status`, `state_version`)
- API-side forwarding: replace `sandbox-orchestration.ts` inline sync+agent with daemon proxy (`getOrCreateUserSandbox`, `forwardChatToSandbox`)

Remaining work:
- Postgres schema migration
- Daemon implementation (Hono server, reconciliation logic, agent runner integration)
- E2B template rebuild with Bun + daemon
- API integration to forward chat requests to daemon instead of running inline sync + agent
- Wire `sandbox.getHost(port)` streaming path
- Update `env.ts` with Postgres connection config

### Phase 5: Production hardening

Add:
- sandbox lifecycle management (TTL, pause/resume, cleanup of idle sandboxes)
- daemon health monitoring (periodic `/health` checks, sandbox recreation on failure)
- distributed locking deferred (daemon FIFO handles per-user serialization)
- metrics: reconciliation latency, daemon uptime, sandbox health, request queue depth

Validate concurrency and cost with representative load.

Exit criteria:
- warm and cold latency are within acceptable limits
- operational alerts and dashboards exist
- sandbox recreation and state rebuild work reliably under load

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

## Public Interfaces / Internal Contracts

Core API-side functions:

- `getOrCreateUserSandbox(userId)` — resolve or create sandbox, return sandbox instance
- `getSandboxDaemonUrl(sandboxId, port)` — get daemon URL via `sandbox.getHost(port)`
- `forwardChatToSandbox(userId, request)` — proxy chat request to daemon and relay stream

Core daemon-side functions:

- `reconcileSandboxState(userId, requiredVersion)` — sync sandbox files to DB state
- `loadDbManifest(userId)` — fetch file manifest from Postgres
- `loadChangedFiles(userId, paths)` — fetch content for changed files
- `loadLocalManifest()` / `writeLocalManifest(manifest)` — read/write `.sync-manifest.json`
- `runAgentTurn(agentSessionId?, prompt)` — run Claude Agent SDK and stream output

Daemon request contract:

- `POST /enqueue`
    - input: `request_id`, `user_id`, `required_version`, `message`, optional conversation context
    - output: streaming NDJSON (`started`, `text_delta`, `completed`, `failed`)

No client-facing API or SSE schema changes required. `chat-api` remains the owner of chat persistence and citation persistence.

## Test Plan

Critical scenarios:
- same user, two requests: daemon processes them strictly in order
- different users: separate sandboxes run concurrently
- daemon starts automatically in new sandbox from template
- API can reach daemon via sandbox host URL
- checksum-based reconciliation updates only changed files
- deleted DB files are removed from sandbox
- sandbox recreation rebuilds state correctly from Postgres
- agent session can be recreated without losing sandbox filesystem state
- failed mid-turn request does not corrupt Postgres knowledge state

Regression tests:
- chat history loading unchanged
- protected-service persistence unchanged
- citations still resolve to protected summaries

## Assumptions and Defaults

- Best-effort chat execution is acceptable; failed in-flight turns can be resent manually.
- Bun is the daemon runtime (no PM2). The daemon is started by the template, not bootstrapped during request handling.
- Postgres stores durable current knowledge state and successful chat history, but not a durable pending chat-job queue in v1.
- File checksums are computed at write time in the app and stored in Postgres.
- Synced sandbox documents are text files; some are Markdown and some are plain text/parser output.
- Inline stable citations in the answer text are the default citation contract.
