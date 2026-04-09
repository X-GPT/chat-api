# How I Replaced Our RAG Pipeline with Per-User Cloud Sandboxes

Traditional RAG is great until it isn't. You embed documents, chunk them, tune retrieval parameters, fight with relevance scores, and still get answers that miss context because the chunk boundaries fell in the wrong place. What if each user got their own filesystem with all their documents, and an AI agent that could grep, read, and reason over them directly?

That's what we built. This article walks through how we set up per-user cloud sandboxes as a drop-in replacement for a traditional RAG pipeline — no vector database, no embeddings, no chunking.

## The Problem with Chunking

We run an AI chat product that helps users interact with their personal document libraries — PDFs, notes, web clips, all kinds of content. The original architecture was the standard playbook: a chat API calls an LLM, and a separate RAG service handles retrieval via embeddings and vector search.

It worked, but we kept hitting the same problems:

- **Chunk boundary issues.** A document split across five chunks loses context at the seams. Users ask about a paragraph that spans two chunks and get a partial answer.
- **Embedding drift.** Different document types embed differently. Tuning retrieval for PDFs degrades note search, and vice versa.
- **Brittle citations.** Mapping retrieved chunks back to source documents required fragile heuristics that broke on edge cases.

The insight was simple: what if the AI could just read the actual files? Not chunks, not embeddings — full documents, searched with grep, read on demand. An AI agent with filesystem access doesn't have chunk boundary problems because it reads as much or as little as it needs.

## Why Grep Instead of Embeddings

This is the core bet: **let the LLM decide how to search.** Instead of a fixed retrieval pipeline (embed query -> cosine similarity -> top-k), the agent formulates its own grep queries, reads results, tries alternative terms if needed, and synthesizes across multiple files.

Grep turned out to be a surprisingly good fit:

- **Zero setup** — no model to load, no index to build
- **Deterministic** — same query always returns same results
- **Debuggable** — you can see exactly what matched and why
- **Agent-compensated** — the LLM tries multiple search terms, reads context around matches, and synthesizes across files

For document libraries of hundreds to low thousands of files, grep is fast enough and the agent's reasoning ability more than compensates for the lack of semantic search.

## The Architecture: One Sandbox Per User

The architecture gives each user their own cloud sandbox — we use [E2B](https://e2b.dev) (cloud microVMs with a file and process API), but the pattern applies to any sandbox provider. Inside the sandbox, an AI agent runs with built-in filesystem tools — Grep, Read, Glob — and the user's documents are materialized as plain text files.

Here's the request flow:

1. User sends a chat message
2. A feature flag decides: sandbox path or existing RAG path
3. Find or create a sandbox for this user
4. Sync the user's documents onto the sandbox filesystem
5. Run an AI agent inside the sandbox with filesystem tools
6. Stream the agent's response back to the client

The existing RAG path stays completely untouched. A single `if` branch is the only change to the main request handler. Both paths share the same streaming callbacks, so citation extraction, message persistence, and SSE delivery work identically regardless of which retrieval backend is active.

## Step 1: Materializing Documents as Files

The first problem to solve: how do you turn a database of user documents into files an AI agent can read?

We convert each document into a `.txt` file with YAML frontmatter containing metadata the agent needs for citations:

```typescript
function materializeDocument(doc: Document): MaterializedFile {
  const relativePath = `${sanitize(doc.id)}.txt`;

  const content = [
    "---",
    `id: ${doc.id}`,
    `sourceKind: ${resolveSourceKind(doc)}`,
    `title: ${JSON.stringify(doc.title)}`,
    "---",
    "",
    resolveContent(doc),
    "",
  ].join("\n");

  return {
    id: doc.id,
    path: `${docsRoot}/${relativePath}`,
    relativePath,
    content,
    checksum: sha256(content),
  };
}
```

The frontmatter gives the agent everything it needs to build citation links without exposing raw database IDs in the answer body. The SHA-256 checksum becomes important later for incremental sync.

If your product has folder or collection scoping, you can use symlinks to give the agent a scoped view of the filesystem — point collection directories back to the primary files, then set the agent's working directory to the relevant collection. One real file, N symlinks, no content duplication.

## Step 2: Running an AI Agent Inside the Sandbox

The AI agent runs inside the sandbox as a Node.js script. The host API uploads two files — the agent runner script and a JSON request payload — then executes the script via the sandbox's command API:

```typescript
// Upload the agent script and request payload
await Promise.all([
  sandbox.files.write("/workspace/agent-runner.mjs", agentScript),
  sandbox.files.write("/workspace/request.json", JSON.stringify({
    query: userMessage,
    systemPrompt: buildSystemPrompt({ scope, docsRoot }),
    cwd: agentWorkingDirectory,
  })),
]);

// Execute the agent and stream stdout back
const result = await sandbox.commands.run(
  "node /workspace/agent-runner.mjs /workspace/request.json",
  {
    envs: { ANTHROPIC_API_KEY: apiKey },
    onStdout: (chunk) => ndjsonParser.feed(chunk),
    timeoutMs: 120_000,
  },
);
ndjsonParser.flush();
```

Inside the sandbox, the agent script reads the request payload, initializes the Claude Agent SDK with the system prompt and built-in tools (Grep, Read, Glob), and writes NDJSON events to stdout as it generates output. The host parses these events (`text_delta`, `result`, `error`) with a line-buffered NDJSON parser and forwards text deltas to the client via SSE.

The system prompt tells the agent how to retrieve information:

```
## Retrieval Strategy

1. Use Grep to search for keywords in .txt files in your working directory.
2. Use Read to read the top 1-3 matching files in full.
3. Synthesize an answer using ONLY the content from files you have read.
4. If the first search returns no results, try alternative keywords.
5. If no files match, state explicitly: "I cannot find this information."
```

Why run the agent inside the sandbox instead of on the host? The Agent SDK's built-in tools operate on the local filesystem. Running the agent where the files live means these tools work natively with zero adaptation.

## Step 3: Keeping Documents in Sync

Users add, edit, and delete documents between chat sessions. The sandbox filesystem needs to reflect these changes. We use a two-tier sync strategy.

### Initial sync: tarball transfer

The first time a user's sandbox is set up, we fetch all their documents, materialize them locally, pack them into a `.tar.gz`, upload it, and extract:

```typescript
const tarball = await buildTarGz(files, symlinks);
await sandbox.files.write("/tmp/docs.tar.gz", tarball);
await sandbox.commands.run(
  `mkdir -p ${docsRoot} && tar xzf /tmp/docs.tar.gz -C ${docsRoot}`
);
```

Tarball transfer is dramatically faster than writing files one-by-one over the sandbox API. For a few hundred documents, the difference is seconds vs. minutes.

After the initial sync, we write a `sync-state.json` to the sandbox containing each file's ID and checksum, plus a marker file indicating sync is complete.

### Incremental sync: checksum diffing

On every subsequent request, we run a fast incremental sync. Fetch a lightweight manifest from the API (just IDs + checksums, no content), compare it against `sync-state.json` on the sandbox, and only transfer what changed. When nothing has changed — the common case — it's just two parallel reads and a map comparison.

We store sync state on the sandbox filesystem itself rather than in an external database. If a sandbox dies, the state dies with it — and a new sandbox simply gets a fresh initial sync.

## Wrapping Up

This article covered the setup: materializing documents as files with metadata frontmatter, running an AI agent with filesystem tools inside a cloud sandbox, and keeping documents in sync with tarball-based initial loads and checksum-based incremental updates.

In a follow-up post, we'll cover the operational side — sandbox lifecycle management, latency and cost numbers, scale limits, failure modes, and where this approach breaks down compared to traditional RAG.

If you're building a document-aware AI product, consider whether your users' document libraries fit on a filesystem. If they do, a per-user sandbox with agent-based retrieval might be simpler, more accurate, and easier to debug than a traditional RAG pipeline.
