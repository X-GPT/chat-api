# Implementation Plan: AI-Powered Document Search Tool

## Overview
Create a new LLM tool that searches for relevant documents using AI-powered filtering across paginated summaries, then returns the most relevant document IDs in XML format.

## Todo Tracker

- [x] 1. Add gpt-5-nano model support to chat.language-models.ts ✓
- [x] 2. Create API endpoint configuration for fetching paginated summaries in env.ts ✓
- [x] 3. Implement fetchProtectedMemberSummaries() function in api/summaries.ts ✓
- [x] 4. Create AI document ranker utility (lib/ai-document-ranker.ts) ✓
- [x] 5. Create search-documents.ts tool with searchDocumentsTool definition ✓
- [x] 6. Implement handleSearchDocuments() handler function with pagination logic ✓
- [x] 7. Add search_documents event types to chat.events.ts ✓
- [x] 8. Register search_documents tool in tools.ts ✓
- [ ] 9. Test the implementation end-to-end

**Last Updated**: 2025-10-20
**Progress**: 8/9 tasks completed (89%)

### Completed Tasks Details:
1. ✓ Added `gpt-5-nano` and `gpt-5-nano-2025-08-07` to [chat.language-models.ts:53-54](../chat.language-models.ts#L53-L54)
2. ✓ Implemented `getProtectedMemberSummariesEndpoint()` in [env.ts:210-277](../../../config/env.ts#L210-L277)
3. ✓ Created `fetchProtectedMemberSummaries()` with pagination support in [summaries.ts:78-157](../api/summaries.ts#L78-L157)
4. ✓ Built `rankDocumentsByRelevance()` utility in [ai-document-ranker.ts](../lib/ai-document-ranker.ts) with:
   - AI-powered relevance scoring using gpt-5-nano
   - Configurable topK parameter (default: 10)
   - Relevance threshold filtering (>0.3)
   - Comprehensive error handling and logging
5. ✓ Created `searchDocumentsTool` LLM tool definition in [search-documents.ts](search-documents.ts)
6. ✓ Implemented `handleSearchDocuments()` handler with:
   - Pagination support (pageSize: 50)
   - Parallel page processing for performance
   - Deduplication and re-ranking (top 20 documents)
   - XML output formatting
   - Event emission for tracking
   - Comprehensive error handling
7. ✓ Added event types to [chat.events.ts:129-139](../chat.events.ts#L129-L139):
   - `SearchDocumentsStartedEvent` with query
   - `SearchDocumentsCompletedEvent` with query, totalDocuments, and optional error
8. ✓ Registered `search_documents` tool in [tools.ts](tools.ts):
   - Added import for `searchDocumentsTool` from search-documents.ts
   - Added `search_documents` to `getTools()` function
   - Enabled in `getAllowedTools()` for three scopes when knowledge is enabled:
     - "general" scope (with knowledge)
     - "collection" scope (with knowledge)
     - "document" scope (with knowledge)

## File Structure

```
apps/chat-api/src/
├── config/
│   └── env.ts                           # Add endpoint builder here
├── features/chat/
│   ├── api/
│   │   ├── summaries.ts                 # Add new fetch function here
│   │   ├── types.ts                     # Add response types if needed
│   │   └── client.ts                    # Existing HTTP client utilities
│   ├── lib/                             # New: Internal utilities directory
│   │   └── ai-document-ranker.ts       # New: AI ranking utility (NOT an LLM tool)
│   ├── tools/
│   │   ├── search-documents.ts         # New: LLM tool implementation
│   │   └── tools.ts                    # Register tool here
│   ├── chat.events.ts                  # Add event types here
│   └── chat.language-models.ts         # Add gpt-5-nano here
```

## Architecture

### 1. **Add gpt-5-nano Model Support**
- **File**: `apps/chat-api/src/features/chat/chat.language-models.ts`
- **Action**: Add gpt-5-nano variants to the OpenAI model list:
  - `gpt-5-nano`
  - `gpt-5-nano-2025-08-07`

### 2. **Create New API Endpoint Configuration**
- **File**: `apps/chat-api/src/config/env.ts`
- **Action**: Add `getProtectedMemberSummariesEndpoint()` function
- **Details**:
  - Endpoint pattern: `/protected/members/{memberCode}/summaries`
  - Query parameters:
    - `partnerCode` (required when summaryId not provided)
    - `collectionId` (optional, Long)
    - `summaryId` (optional, Long)
    - `pageIndex` (1-based, min: 1, default: 1)
    - `pageSize` (min: 1, max: 100, default: 10)

### 3. **Create API Client Function**
- **File**: `apps/chat-api/src/features/chat/api/summaries.ts`
- **Action**: Add `fetchProtectedMemberSummaries()` function (alongside existing `fetchProtectedSummaries()`)
- **Parameters**:
  - `memberCode: string` (required, path parameter)
  - `params: { partnerCode: string, collectionId?: string | number | null, summaryId?: string | number | null, pageIndex?: number, pageSize?: number }`
  - `options: FetchOptions`
  - `logger: ChatLogger`
- **Return type**: Zod-validated response with:
  ```typescript
  {
    summaries: ProtectedSummary[],
    totalPages: number,
    totalRecords: number,
    currentPage: number
  }
  ```
- **Details**:
  - Use existing schema validation pattern
  - Default pageSize: 50 (balance between API calls and processing)
  - 1-based pagination (pageIndex starts at 1)

### 4. **Implement AI-Powered Document Ranking Utility**
- **File**: New file `apps/chat-api/src/features/chat/lib/ai-document-ranker.ts`
- **Action**: Create reusable AI ranking utility function (NOT an LLM tool, just an internal utility)
- **Note**: Kept as a utility function rather than a subagent for simplicity and performance

#### Implementation Details (Completed)

**Key Features**:
1. `rankDocumentsByRelevance()` function - Main utility for AI-powered document ranking
2. Uses gpt-5-nano model - Efficient and cost-effective for ranking tasks
3. Configurable topK parameter - Returns up to N most relevant documents (default: 10)
4. Relevance scoring - Returns scores between 0.0-1.0, filters out low-relevance docs (< 0.3)
5. Robust error handling - Handles parsing errors, empty results, and API failures
6. Comprehensive logging - Logs all operations for debugging

**Input** (`RankDocumentsInput`):
- `query: string` - The user's search query
- `summaries: ProtectedSummary[]` - Array of document summaries to rank
- `topK?: number` - Maximum number of documents to return (default: 10)
- `logger: ChatLogger` - Logger instance for tracking operations

**Output** (`RankDocumentsResult`):
- `rankedDocuments: RankedDocument[]` - Sorted array of documents with:
  - `id: string | number` - Document identifier
  - `title: string | null` - Document title
  - `relevanceScore: number` - Relevance score (0.0-1.0)
- `totalProcessed: number` - Total number of summaries analyzed

**Design Decisions**:
- Low temperature (0.3) for consistent ranking results
- JSON response format for reliable parsing with regex fallback
- Content preview truncation (500 chars) to stay within token limits
- Filters documents with relevance scores below 0.3 to avoid noise
- Extracts title from multiple possible fields (title, summaryTitle, fileName)
- Uses parseContentSlice/parseContent/content in priority order for content analysis

### 5. **Create Core Tool Implementation**
- **File**: New file `apps/chat-api/src/features/chat/tools/search-documents.ts`
- **Components**:
  - **Tool Definition**: `searchDocumentsTool` using `tool()` from AI SDK
    - Input schema: `{ query: string }`
    - Description: "Find the most relevant documents by AI-analyzing document summaries"

  - **Handler Function**: `handleSearchDocuments()`
    - Parameters:
      - `query: string` - The search query
      - `memberCode: string` - Member identifier (path param)
      - `partnerCode: string` - Partner identifier (required)
      - `collectionId: string | null` - Optional collection filter
      - `logger: ChatLogger`
      - `onEvent: (event: EventMessage) => void`
    - Logic:
      1. Emit `search_documents.started` event
      2. Fetch first page to determine totalPages
      3. Fetch all pages of summaries with pagination (pageSize: 50)
      4. For each page: call AI ranker to get top 10 IDs
      5. Combine results from all pages
      6. Deduplicate and rank final set (keep top 20)
      7. Format as XML with `<documentIds>` tags
      8. Emit `search_documents.completed` event
    - Error handling: try-catch with proper logging

### 6. **Add Event Definitions**
- **File**: `apps/chat-api/src/features/chat/chat.events.ts`
- **Action**: Add new event types:
  ```typescript
  SearchDocumentsStartedEvent: { type: "search_documents.started", query: string }
  SearchDocumentsCompletedEvent: { type: "search_documents.completed", query: string, totalDocuments: number, error?: string }
  ```

### 7. **Register Tool**
- **File**: `apps/chat-api/src/features/chat/tools/tools.ts`
- **Actions**:
  - Import and add to `getTools()` function
  - Add `search_documents` to appropriate scopes in `getAllowedTools()`
  - Enable for: general (with knowledge), collection (with knowledge), document (with knowledge)

### 8. **XML Output Format**
```xml
<searchResults>
  <query>user query text</query>
  <totalDocuments>15</totalDocuments>
  <documentIds>
    <document>
      <id>12345</id>
      <title>Document Title</title>
      <relevanceScore>0.95</relevanceScore>
    </document>
    <!-- ... more documents ... -->
  </documentIds>
</searchResults>
```

## Implementation Details

### Pagination Strategy
- Use pageSize: 50 (balance between API calls and AI processing)
- Page index is 1-based (starts at 1, not 0)
- Fetch first page to get totalPages from response
- Process pages sequentially or in parallel (consider rate limits)
- Each page returns top 10 via AI ranker
- Aggregate results and deduplicate by document ID
- Final ranking: keep top 20 most relevant documents across all pages

### AI Prompting Strategy
- System prompt: "You are a relevance ranking assistant. Analyze document summaries and identify the most relevant ones."
- User prompt template:
  ```
  Query: {userQuery}

  Analyze these summaries and return the IDs of the 10 most relevant documents as a JSON array:
  {summaries}
  ```
- Parse JSON response to extract document IDs

### Performance Considerations
- Parallel processing: Use `Promise.all()` for concurrent AI ranking of pages
- Rate limiting: Implement if needed based on API limits
- Caching: Consider caching summary metadata

## Testing Strategy
1. Unit test AI ranker module with mock summaries
2. Integration test pagination logic
3. End-to-end test with real LLM tool invocation
4. Test edge cases: empty results, single page, many pages

## Dependencies
- ✅ AI SDK (`ai` package) - already installed
- ✅ OpenAI SDK (`@ai-sdk/openai`) - already installed
- ✅ Zod for validation - already installed
- ⚠️ Need to verify: API endpoint for fetching paginated summaries

## API Endpoint Specification (Resolved)

**Endpoint**: `GET /protected/members/{memberCode}/summaries`

**Path Parameters**:
- `memberCode` (string, required) - Member identifier

**Query Parameters**:
- `partnerCode` (string, required when summaryId not provided) - Partner code
- `collectionId` (Long/number, optional) - Filter by collection
- `summaryId` (Long/number, optional) - Filter by specific summary
- `pageIndex` (integer, optional) - 1-based page index, min: 1, default: 1
- `pageSize` (integer, optional) - Records per page, min: 1, max: 100, default: 10

**Implementation Decisions**:
- ✅ Use pageSize: 50 for efficient batch processing
- ✅ Support collectionId filtering
- ✅ Return top 20 documents in final results
- ✅ Access control via memberCode and partnerCode
- ✅ 1-based pagination (pageIndex starts at 1)
