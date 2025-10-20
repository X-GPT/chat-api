# Implementation Plan: AI-Powered Document Search Tool

## Overview
Create a new LLM tool that searches for relevant documents using AI-powered filtering across paginated summaries, then returns the most relevant document IDs in XML format.

## Architecture

### 1. **Add gpt-5-nano Model Support**
- **File**: `apps/chat-api/src/features/chat/chat.language-models.ts`
- **Action**: Add gpt-5-nano variants to the OpenAI model list:
  - `gpt-5-nano`
  - `gpt-5-nano-2025-08-07`

### 2. **Create New API Endpoint Configuration**
- **File**: `apps/chat-api/src/config/env.ts`
- **Action**: Add `getProtectedSummariesListEndpoint()` function
- **Details**: Create endpoint builder that supports pagination parameters (page, pageSize/limit)
- **Question**: What is the API endpoint URL pattern and pagination parameters for fetching all document summaries? (e.g., `/protected/summaries?page=1&limit=100`)

### 3. **Create API Client Function**
- **File**: `apps/chat-api/src/features/chat/chat.external.ts`
- **Action**: Add `fetchProtectedSummariesList()` function
- **Details**:
  - Fetch summaries with pagination support
  - Return type: `{ summaries: ProtectedSummary[], totalPages: number, currentPage: number }`
  - Use existing schema validation pattern

### 4. **Implement AI-Powered Document Ranking Module**
- **File**: New file `apps/chat-api/src/features/chat/tools/ai-document-ranker.ts`
- **Action**: Create reusable AI ranking logic
- **Functionality**:
  - Accept: user query + array of summaries
  - Use `generateText()` from AI SDK with gpt-5-nano
  - Prompt: "Given this query, identify the 10 most relevant document IDs from the following summaries"
  - Return: array of document IDs with relevance scores

### 5. **Create Core Tool Implementation**
- **File**: New file `apps/chat-api/src/features/chat/tools/search-documents.ts`
- **Components**:
  - **Tool Definition**: `searchDocumentsTool` using `tool()` from AI SDK
    - Input schema: `{ query: string }`
    - Description: "Find the most relevant documents by AI-analyzing document summaries"

  - **Handler Function**: `handleSearchDocuments()`
    - Parameters: query, memberCode, collectionId (optional), logger, onEvent
    - Logic:
      1. Emit `search_documents.started` event
      2. Fetch all pages of summaries with pagination
      3. For each page: call AI ranker to get top 10 IDs
      4. Combine results from all pages
      5. Deduplicate and rank final set
      6. Format as XML with `<documentIds>` tags
      7. Emit `search_documents.completed` event
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
- Fetch summaries in chunks (e.g., 50-100 per page)
- Process each page through AI ranker
- Aggregate top 10 results per page
- Final deduplication and ranking across all results

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

## Open Questions
1. What is the exact API endpoint and pagination parameters for fetching document summaries?
2. Should we support filtering by collectionId when fetching summaries?
3. What should the page size be? (recommendation: 50-100 documents per page)
4. Should we limit the total number of returned documents (e.g., top 20 across all pages)?
5. Do we need to filter summaries by memberCode/partnerCode for access control?
