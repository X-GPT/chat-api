# Refactoring Plan: Split `chat.external.ts` into Organized API Module

## Overview

Refactor the 666-line `chat.external.ts` file into a well-organized `api/` directory with separate modules for different concerns. **No unit tests** will be created since these are thin HTTP client wrappers with minimal business logic.

## Current State

- **File**: `src/features/chat/chat.external.ts`
- **Lines**: 666
- **Functions**: 7 exported API functions
- **Schemas**: 10+ Zod schemas
- **Dependents**: 9 files import from this module

## Target Structure

```
apps/chat-api/src/features/chat/api/
├── types.ts        # All Zod schemas and type exports (~150 lines)
├── client.ts       # Shared HTTP utilities (~40 lines)
├── chat.ts         # Chat-related API functions (~180 lines)
├── files.ts        # File-related API functions (~130 lines)
└── summaries.ts    # Summary-related API functions (~80 lines)
```

## Benefits

- **Smaller files**: Largest file will be ~200 lines vs 666 lines
- **Single responsibility**: Each file has one clear purpose
- **Easy navigation**: Can quickly find chat, file, or summary API functions
- **Maintainability**: Changes to one API domain don't affect others
- **Consistency**: Matches existing project structure (`core/`, `tools/`, `prompts/`)
- **Type safety**: All schemas and types in one discoverable location

---

## Execution Plan

### Phase 1: Create New API Module Files

#### 1.1 Create `api/types.ts`

**Purpose**: Centralize all Zod schemas, type exports, and validation utilities

**Contents**:
- Import `ChatMessagesScope` from `@/config/env`
- Import `z` from `zod`
- All Zod schemas:
  - `chatDataSchema`
  - `chatContextSchema`
  - `protectedChatContextResponseSchema`
  - `chatMessageSchema`
  - `protectedChatMessagesResponseSchema`
  - `protectedFileCollectionSchema`
  - `protectedFileMetadataSchema`
  - `protectedFilesResponseSchema`
  - `protectedFileDataSchema` (discriminated union)
  - `protectedFileDetailResponseSchema`
  - `protectedSummarySchema`
  - `protectedSummariesResponseSchema`
- Type exports:
  - `ProtectedChatContext`
  - `ProtectedChatContextData`
  - `ProtectedChatMessage`
  - `ProtectedFileMetadata`
  - `ProtectedSummary`
- Interface exports:
  - `FetchProtectedChatMessagesParams`
  - `FetchProtectedFilesParams`
- Constants:
  - `VALID_CHAT_MESSAGE_SCOPES`
- Utility functions:
  - `normalizeChatMessagesScope`

**Estimated lines**: ~190

---

#### 1.2 Create `api/client.ts`

**Purpose**: Shared HTTP client configuration and utilities

**Contents**:
- Import `apiEnv` from `@/config/env`
- Export `FetchOptions` interface
- Export `defaultHeaders` constant
- Export `buildHeaders` function

**Estimated lines**: ~40

---

#### 1.3 Create `api/chat.ts`

**Purpose**: Chat-related API functions

**Contents**:
- Imports:
  - Types from `./types`
  - `buildHeaders`, `FetchOptions` from `./client`
  - Endpoint getters from `@/config/env`
  - `ChatLogger` from `../chat.logger`
  - `ChatEntity` from `../chat.events`
- Internal interface:
  - `ProtectedChatIdResponse`
- Exported functions:
  - `fetchProtectedChatId(options, logger)`
  - `fetchProtectedChatContext(chatKey, collectionId, summaryId, options, logger)`
  - `fetchProtectedChatMessages(chatKey, params, options, logger)`
  - `sendChatEntityToProtectedService(chatEntity, options, logger)`

**Estimated lines**: ~180

---

#### 1.4 Create `api/files.ts`

**Purpose**: File-related API functions

**Contents**:
- Imports:
  - Types from `./types`
  - `buildHeaders`, `FetchOptions` from `./client`
  - Endpoint getters from `@/config/env`
  - `ChatLogger` from `../chat.logger`
- Internal type:
  - `RawProtectedFileData` (inferred from schema)
- Exported functions:
  - `fetchProtectedFiles(params, options, logger)`
  - `fetchProtectedFileDetail(type, id, options, logger)`

**Estimated lines**: ~130

---

#### 1.5 Create `api/summaries.ts`

**Purpose**: Summary-related API functions

**Contents**:
- Imports:
  - Types from `./types`
  - `buildHeaders`, `FetchOptions` from `./client`
  - Endpoint getters from `@/config/env`
  - `ChatLogger` from `../chat.logger`
- Exported functions:
  - `fetchProtectedSummaries(ids, options, logger)`

**Estimated lines**: ~80

---

### Phase 2: Update Import Statements

#### Files that need updates (9 total):

1. **`chat.controller.ts`** (lines 5-10)
   - **Current**: `import { fetchProtectedChatContext, fetchProtectedChatId, fetchProtectedChatMessages, sendChatEntityToProtectedService } from "./chat.external"`
   - **New**: `import { fetchProtectedChatContext, fetchProtectedChatId, fetchProtectedChatMessages, sendChatEntityToProtectedService } from "./api/chat"`

2. **`chat.adapter.ts`** (line 3)
   - **Current**: `import type { ProtectedChatMessage } from "./chat.external"`
   - **New**: `import type { ProtectedChatMessage } from "./api/types"`

3. **`tools/utils.ts`** (line 1)
   - **Current**: `import type { ProtectedFileMetadata } from "../chat.external"`
   - **New**: `import type { ProtectedFileMetadata } from "../api/types"`

4. **`tools/list-all-files.ts`**
   - Check and update if imports from `chat.external`

5. **`tools/list-collection-files.ts`**
   - Check and update if imports from `chat.external`

6. **`tools/read-file.ts`**
   - Check and update if imports from `chat.external`

7. **`tools/update-citations.ts`**
   - Check and update if imports from `chat.external`

8. **`chat.events.ts`**
   - Check and update if imports from `chat.external`

9. **`chat.adapter.test.ts`**
   - Check and update if imports from `chat.external`

---

### Phase 3: Delete Old File

- Delete `src/features/chat/chat.external.ts`

---

### Phase 4: Verification

1. **Type check**: Run `npx tsc --noEmit` to check for type errors
2. **Build check**: Run build command to ensure application compiles
3. **Test suite**: Run existing tests to ensure nothing is broken
4. **Import verification**: Search codebase for any remaining references to `chat.external`

---

## Import/Export Reference

### `api/types.ts` Exports

**Types**:
- `ProtectedChatContext`
- `ProtectedChatContextData`
- `ProtectedChatMessage`
- `ProtectedFileMetadata`
- `ProtectedSummary`

**Interfaces**:
- `FetchProtectedChatMessagesParams`
- `FetchProtectedFilesParams`

**Schemas** (for internal use):
- All Zod schemas listed above

**Functions**:
- `normalizeChatMessagesScope(scope): ChatMessagesScope`

---

### `api/client.ts` Exports

**Interface**:
- `FetchOptions`

**Function**:
- `buildHeaders(options?: FetchOptions): Record<string, string>`

---

### `api/chat.ts` Exports

**Functions**:
- `fetchProtectedChatId(options, logger): Promise<string>`
- `fetchProtectedChatContext(chatKey, collectionId, summaryId, options, logger): Promise<ProtectedChatContext>`
- `fetchProtectedChatMessages(chatKey, params, options, logger): Promise<ProtectedChatMessage[]>`
- `sendChatEntityToProtectedService(chatEntity, options, logger): Promise<void>`

---

### `api/files.ts` Exports

**Functions**:
- `fetchProtectedFiles(params, options, logger): Promise<ProtectedFileMetadata[]>`
- `fetchProtectedFileDetail(type, id, options, logger): Promise<RawProtectedFileData | null>`

---

### `api/summaries.ts` Exports

**Functions**:
- `fetchProtectedSummaries(ids, options, logger): Promise<ProtectedSummary[]>`

---

## Todo Tracker

### Phase 1: Create New Files ✅ COMPLETE

- [x] Create `src/features/chat/api/` directory
- [x] Create `api/types.ts` with all schemas and types
- [x] Create `api/client.ts` with shared HTTP utilities
- [x] Create `api/chat.ts` with chat API functions
- [x] Create `api/files.ts` with file API functions
- [x] Create `api/summaries.ts` with summary API functions

### Phase 2: Update Imports ✅ COMPLETE

- [x] Update imports in `chat.controller.ts`
- [x] Update imports in `chat.adapter.ts`
- [x] Update imports in `tools/utils.ts`
- [x] Check and update `tools/list-all-files.ts`
- [x] Check and update `tools/list-collection-files.ts`
- [x] Check and update `tools/read-file.ts`
- [x] Check and update `tools/update-citations.ts`
- [x] Check and update `chat.events.ts`
- [x] Check and update `chat.adapter.test.ts`

### Phase 3: Cleanup ✅ COMPLETE

- [x] Delete `chat.external.ts`
- [x] Search codebase for remaining `chat.external` references (1 reference found and updated in search-documents-plan.md)

### Phase 4: Verification ✅ COMPLETE

- [x] Run `npx tsc --noEmit` (type check) - ✅ Passed with no errors
- [x] Run `bun test` (test suite) - ✅ 47 tests passed, 0 failed
- [x] Run `bun run lint` (optional - code style check) - ✅ Passed, no fixes needed
- [x] Run `bun run dev` briefly to verify app starts (optional smoke test) - ⏭️ Skipped (optional)

---

## 🎉 Refactoring Complete!

**Status**: ✅ **All phases completed successfully**

### Summary of Changes

**Before:**
- 1 monolithic file: `chat.external.ts` (666 lines)
- All API functions, schemas, and utilities in one place
- Difficult to navigate and maintain

**After:**
- 5 focused modules in `api/` directory:
  - `types.ts` (178 lines) - All schemas and type definitions
  - `client.ts` (29 lines) - Shared HTTP utilities
  - `chat.ts` (253 lines) - Chat API functions
  - `files.ts` (157 lines) - File API functions
  - `summaries.ts` (71 lines) - Summary API functions
- 9 files updated with new import paths
- 1 documentation file updated

### Verification Results

✅ **Type Check**: No errors
✅ **Tests**: 47 passed, 0 failed
✅ **Lint**: No issues found
✅ **Total**: All validations passed

### Impact

- **Lines of code**: Same (688 total, just reorganized)
- **Breaking changes**: None (pure structural refactoring)
- **Test coverage**: Maintained (all existing tests pass)
- **Type safety**: Maintained (no type errors)

---

## Notes

- **No unit tests**: These are thin HTTP client wrappers. Testing will rely on integration/E2E tests.
- **Backwards compatibility**: Not maintained - all imports were updated to new paths.
- **Migration risk**: Low - pure structural refactoring with no logic changes.

---

## Actual Time Taken

- Phase 1: Created new files
- Phase 2: Updated imports
- Phase 3: Cleanup
- Phase 4: Verification

**Completion Date**: 2025-10-19
