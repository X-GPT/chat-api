# Phase 1: Sandbox Prototype With Local Retrieval — COMPLETE

## Summary

Phase 1 validated that E2B sandboxes can serve as the retrieval environment, using local tools only (`grep`, glob, file reads). Vector/semantic search is deferred to Phase 6.

`chat-api` continues to own request handling, context/history loading, SSE streaming, citation parsing, and final persistence. This phase prototyped sandbox-local document materialization, search, and answer generation with inline citations.

## Status

**COMPLETE (2026-03-27).** All exit criteria met. E2B sandbox infrastructure is confirmed viable with local retrieval.

## Results

| Metric | Value |
|---|---|
| Sandbox cold start | ~2-3.5s |
| grep keyword search (3 docs) | 9ms |
| File update + grep verification | 3ms |
| File delete + verification | 2ms |
| Pause/resume persistence check | ~2-3s |
| End-to-end (create, search, mutations, persistence, cleanup) | 6-10s |
| Citation round-trip | 3/3 citations parsed correctly |

## Artifacts

- E2B template: `sandbox-template/template.ts` (Node.js LTS + workspace dirs)
- Template build scripts: `bun run e2b:build:dev` / `bun run e2b:build:prod`
- Prototype entrypoint: `bun run prototype:sandbox <input.json>`
- Prototype runner: `scripts/prototype-runner.mjs` (grep-based search, uploaded to sandbox at runtime)
- On-disk document format with frontmatter metadata (`summaryId`, `type`, `sourceKind`, `title`)
- Citation assembly compatible with existing `extractReferencesFromText` parser

## Environment

- `E2B_API_KEY=<your key>` (required)
- `E2B_TEMPLATE=<template name or id>` (required)

## `qmd` Rejection Log (2026-03-27)

`qmd` was the original retrieval candidate. It was rejected during prototyping:

- **Semantic search triggers native `llama.cpp` compilation.** `store.search()` depends on `node-llama-cpp`, which compiles `llama.cpp` from C++ source. This fails in the E2B build VM (timeouts / OOM), even with `NODE_LLAMA_CPP_GPU=false`.
- **1.28GB model cannot be cached in the template.** E2B template snapshots do not preserve `/home/user/`. Symlinks and `XDG_CACHE_HOME` overrides do not survive snapshotting.
- **Cold start would be unacceptable.** Model re-download adds 20-30s to every cold sandbox start.

Lexical search (`searchLex`) works without native compilation, but alone it is insufficient. Local retrieval (`grep`/glob) is used for Phase 1 instead. Vector search is deferred to Phase 6.

## Notes

- The prototype accepts representative source content directly; it does not assume Markdown-only input.
- The prototype keeps source metadata in each sandbox file so citations can map back to `summaryId` and `type`.
