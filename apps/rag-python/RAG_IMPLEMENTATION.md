# RAG Implementation Documentation

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Core Components](#core-components)
4. [Document Ingestion Pipeline](#document-ingestion-pipeline)
5. [Hybrid Search System](#hybrid-search-system)
6. [API Endpoints](#api-endpoints)
7. [Event-Driven Processing](#event-driven-processing)
8. [Technology Stack](#technology-stack)
9. [Data Flow](#data-flow)
10. [Configuration](#configuration)

## Overview

This RAG (Retrieval-Augmented Generation) system provides intelligent document search and retrieval capabilities using a hybrid approach that combines semantic vector search with keyword-based search. The system is designed to handle user-generated summaries with multi-tenant isolation via member codes.

### Key Features

- **Hybrid Search**: Combines dense vector embeddings (semantic) with sparse BM25 vectors (keyword)
- **Parent-Child Chunking**: Hierarchical document chunking for better context retrieval
- **Multi-tenant Support**: Isolated data per member using member codes
- **Event-Driven Ingestion**: Async processing via AWS SQS
- **Scalable Architecture**: Async operations with FastAPI and Qdrant vector database

## Architecture

The system follows a service-oriented architecture with three main layers:

```
┌─────────────────────────────────────────────────────────┐
│                     API Layer (FastAPI)                  │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐ │
│  │  Search API   │  │  Health API   │  │  Other APIs │ │
│  └───────────────┘  └───────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│                    Service Layer                         │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐ │
│  │ SearchService │  │  RAGService   │  │   Qdrant    │ │
│  │               │  │  (Ingestion)  │  │   Service   │ │
│  └───────────────┘  └───────────────┘  └─────────────┘ │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│              Data Layer (Qdrant Vector DB)               │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Collection: "summaries"                         │   │
│  │  - Dense Vectors (1536 dim, OpenAI embeddings)  │   │
│  │  - Sparse Vectors (BM25, Qdrant/fastembed)      │   │
│  │  - Metadata (summary_id, member_code, etc.)     │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
                          ↑
┌─────────────────────────────────────────────────────────┐
│          Event Processing Layer (SQS Worker)             │
│  ┌──────────────┐   ┌─────────────────────────────┐    │
│  │  SQS Client  │→→→│  Message Handler Registry   │    │
│  └──────────────┘   └─────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

## Core Components

### 1. RAGService (`services/rag_service.py`)

**Purpose**: Manages document ingestion with hierarchical parent-child chunking strategy.

**Key Responsibilities**:
- Document ingestion with parent-child chunking
- Document updates (delete + re-ingest)
- Document deletion
- Chunk generation and metadata management

**Chunking Strategy**:

```
Original Document
       ↓
┌────────────────────┐
│  Semantic Splitter │  → Creates semantically coherent parent chunks
│  (Parent Chunks)   │     Buffer: 1, Threshold: 95%
└────────────────────┘
       ↓
┌────────────────────┐
│ Sentence Splitter  │  → Creates smaller, searchable child chunks
│  (Child Chunks)    │     Size: 512 tokens, Overlap: 128 tokens
└────────────────────┘
       ↓
   Qdrant Storage
```

**Implementation Details**:

```python
# Parent chunker: Semantic splitter for larger, context-rich chunks
parent_parser = SemanticSplitterNodeParser(
    buffer_size=1,
    breakpoint_percentile_threshold=95,
    embed_model=OpenAIEmbedding()
)

# Child chunker: Sentence splitter for smaller, searchable chunks
child_parser = SentenceSplitter(
    chunk_size=512,      # Child chunk size
    chunk_overlap=128    # Overlap for continuity
)
```

**Chunk Hierarchy**:
- **Parent Chunks**: Larger semantic units (~2048 tokens) that provide broader context
- **Child Chunks**: Smaller searchable units (512 tokens) that enable precise retrieval
- **Linking**: Each child stores its `parent_id` in metadata for context expansion

### 2. SearchService (`services/search_service.py`)

**Purpose**: Performs hybrid search combining semantic and keyword search.

**Key Features**:
- Hybrid search (dense + sparse vectors)
- Multi-tenant filtering by member_code
- Result aggregation by summary_id
- Automatic query embedding

**Search Process**:

```
User Query
    ↓
Generate Embedding (OpenAI text-embedding-3-small)
    ↓
Hybrid Search (via Qdrant)
    ├─→ Dense Vector Search (Semantic similarity)
    └─→ Sparse Vector Search (BM25 keyword matching)
    ↓
Merge & Rank Results
    ↓
Apply Filters (member_code, node_type=child)
    ↓
Aggregate by summary_id
    ↓
Return Structured Response
```

### 3. QdrantService (`services/qdrant_service.py`)

**Purpose**: Low-level interface to Qdrant vector database.

**Key Operations**:
- Collection management
- Node storage with hybrid indexing
- Hybrid search execution
- CRUD operations by summary_id or node_id
- Parent node retrieval by ID

**Hybrid Search Configuration**:

```python
vector_store = QdrantVectorStore(
    collection_name="summaries",
    aclient=AsyncQdrantClient(...),
    enable_hybrid=True,           # Enable hybrid search
    fastembed_sparse_model="Qdrant/bm25",  # BM25 for keyword search
    batch_size=20
)
```

**Vector Storage**:
- **Dense Vectors**: 1536 dimensions (OpenAI `text-embedding-3-small`)
- **Sparse Vectors**: BM25 tokens (automatically generated by Qdrant)
- **Metadata**: `summary_id`, `member_code`, `parent_id`, `chunk_index`, `node_type`

## Document Ingestion Pipeline

### Step-by-Step Process

#### 1. Document Reception
```python
await rag_service.ingest_document(
    summary_id=12345,
    member_code="user123",
    content="Long document content..."
)
```

#### 2. Parent Chunk Creation
- Uses `SemanticSplitterNodeParser` to create semantically coherent parent chunks
- Each parent gets a unique ID: `{summary_id}_parent_{index}`
- Parent metadata includes: `summary_id`, `member_code`, `node_type="parent"`

#### 3. Child Chunk Creation
- For each parent chunk, create child chunks using `SentenceSplitter`
- Each child gets a unique ID: `{summary_id}_child_{parent_idx}_{child_idx}`
- Child metadata includes:
  - `parent_id`: Reference to parent chunk
  - `summary_id`: Document identifier
  - `member_code`: Tenant identifier
  - `node_type`: "child" (for filtering)
  - `chunk_index`: Sequential index

#### 4. Embedding Generation
- OpenAI `text-embedding-3-small` generates 1536-dim vectors
- Both parent and child chunks get embeddings
- Sparse (BM25) vectors generated automatically by Qdrant

#### 5. Storage in Qdrant
```python
# Store child chunks (searchable)
await qdrant_service.add_nodes(all_child_nodes)

# Store parent chunks (for context retrieval)
await qdrant_service.add_nodes(parent_nodes_list)
```

#### 6. Return Statistics
```python
IngestionStats(
    summary_id=12345,
    member_code="user123",
    parent_chunks=5,
    child_chunks=23,
    total_nodes=28,
    operation="ingest"
)
```

### Update and Delete Operations

**Update Flow**:
1. Delete all chunks for the `summary_id`
2. Re-ingest the new content
3. Return updated statistics

**Delete Flow**:
1. Query Qdrant for all points with `summary_id`
2. Delete all matching points (parent + child chunks)
3. Return deletion statistics

## Hybrid Search System

### Search Architecture

The hybrid search combines two complementary approaches:

| Aspect | Dense (Semantic) | Sparse (BM25) |
|--------|------------------|---------------|
| **Type** | Vector similarity | Keyword matching |
| **Model** | OpenAI embeddings | BM25 algorithm |
| **Strength** | Understands meaning | Exact term matching |
| **Use Case** | "Similar concepts" | "Specific keywords" |

### Search Process

#### 1. Query Embedding
```python
query_embedding = await embed_model.aget_text_embedding(query)
```

#### 2. Build Filters
```python
filters = MetadataFilters(
    filters=[
        MetadataFilter(key="member_code", value="user123"),
        MetadataFilter(key="node_type", value="child")
    ],
    condition=FilterCondition.AND
)
```

#### 3. Execute Hybrid Search
```python
query = VectorStoreQuery(
    query_embedding=query_embedding,
    similarity_top_k=10,           # Final result limit
    mode=VectorStoreQueryMode.HYBRID,
    sparse_top_k=10,               # BM25 candidates
    filters=filters
)

results = await vector_store.aquery(query)
```

#### 4. Result Aggregation
Results are grouped by `summary_id`:

```python
{
    "12345": SummaryResults(
        summary_id=12345,
        member_code="user123",
        chunks=[...],              # Matched child chunks
        total_chunks=5,
        max_score=0.95
    )
}
```

### Search API Request/Response

**Request**:
```json
{
    "query": "machine learning algorithms",
    "member_code": "user123",
    "summary_id": 12345,
    "limit": 10,
    "sparse_top_k": 10
}
```

**Response**:
```json
{
    "query": "machine learning algorithms",
    "results": {
        "12345": {
            "summary_id": 12345,
            "member_code": "user123",
            "chunks": [
                {
                    "id": "12345_child_0_1",
                    "text": "Machine learning algorithms...",
                    "score": 0.95,
                    "parent_id": "12345_parent_0",
                    "chunk_index": 1
                }
            ],
            "total_chunks": 5,
            "max_score": 0.95
        }
    },
    "total_results": 5
}
```

## API Endpoints

### Search Endpoint

**Endpoint**: `POST /api/v1/search`

**Description**: Performs hybrid semantic + keyword search on ingested documents.

**Features**:
- Multi-tenant filtering by `member_code`
- Document-specific search by `summary_id`
- Configurable result limits
- Automatic result aggregation by summary

**Example**:
```bash
curl -X POST "http://localhost:8000/api/v1/search" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "user authentication",
    "member_code": "user123",
    "limit": 10
  }'
```

### Health Endpoint

**Endpoint**: `GET /api/v1/health`

**Description**: Health check endpoint for monitoring.

## Event-Driven Processing

### SQS Message Processing

The system uses AWS SQS for asynchronous document ingestion triggered by lifecycle events.

### Message Format

```json
{
    "type": "summary:lifecycle",
    "data": {
        "id": 12345,
        "memberCode": "user123",
        "teamCode": "team456",
        "parseContent": "Document content...",
        "action": "CREATED",
        "timestamp": "2025-10-01T12:30:45.123Z"
    }
}
```

### Supported Actions

| Action | Description | RAG Operation |
|--------|-------------|---------------|
| `CREATED` | New summary created | `ingest_document()` |
| `UPDATED` | Existing summary updated | `update_document()` |
| `DELETED` | Summary deleted | `delete_document()` |

### Worker Architecture

```
SQS Queue
    ↓
┌────────────────────────┐
│   Queue Processor      │
│  - Poll SQS            │
│  - Parse messages      │
│  - Route to handlers   │
└────────────────────────┘
    ↓
┌────────────────────────┐
│  Handler Registry      │
│  - summary:lifecycle   │
│  - [future handlers]   │
└────────────────────────┘
    ↓
┌────────────────────────┐
│ SummaryLifecycleHandler│
│  - CREATED  → ingest   │
│  - UPDATED  → update   │
│  - DELETED  → delete   │
└────────────────────────┘
    ↓
  RAGService
```

### Worker Configuration

```python
# Worker settings
worker_poll_interval: 0           # Continuous polling
worker_max_retries: 3             # Retry failed messages
worker_shutdown_timeout: 30       # Graceful shutdown

# SQS settings
sqs_max_messages: 10              # Batch size
sqs_wait_time_seconds: 20         # Long polling
sqs_visibility_timeout: 300       # 5 minutes
```

### Error Handling

1. **Parsing Errors**: Invalid message format → logged and skipped
2. **Processing Errors**: Ingestion failures → retry up to max_retries
3. **Fatal Errors**: After max retries → message sent to DLQ (if configured)

## Technology Stack

### Core Technologies

| Component | Technology | Purpose |
|-----------|------------|---------|
| **Web Framework** | FastAPI | Async API server |
| **Vector Database** | Qdrant | Hybrid vector search |
| **Embeddings** | OpenAI API | Dense vector generation |
| **Sparse Vectors** | Qdrant BM25 | Keyword search |
| **Message Queue** | AWS SQS | Async event processing |
| **LLM Framework** | LlamaIndex | RAG orchestration |

### Python Libraries

```toml
# Key dependencies
fastapi = "^0.110.0"
qdrant-client = "^1.9.0"
llama-index-core = "^0.10.0"
llama-index-vector-stores-qdrant = "^0.2.0"
llama-index-embeddings-openai = "^0.1.0"
aioboto3 = "^13.1.1"
pydantic = "^2.7.0"
pydantic-settings = "^2.2.0"
```

### Deployment

- **Containerization**: Docker
- **Orchestration**: Docker Compose (preview, staging, production)
- **Worker**: Separate container for SQS processing

## Data Flow

### 1. Ingestion Flow (Event-Driven)

```
Backend Service
    ↓
Publishes SummaryEvent to SQS
    ↓
Worker polls SQS
    ↓
Parses message → Routes to handler
    ↓
SummaryLifecycleHandler
    ↓
RAGService.ingest_document()
    ↓
┌─────────────────────────────┐
│  1. Create parent chunks    │
│  2. Create child chunks     │
│  3. Generate embeddings     │
│  4. Store in Qdrant         │
└─────────────────────────────┘
    ↓
Return IngestionStats
    ↓
Delete SQS message (if successful)
```

### 2. Search Flow (API-Driven)

```
Client Application
    ↓
POST /api/v1/search
    ↓
SearchService.search()
    ↓
┌─────────────────────────────┐
│  1. Generate query embedding│
│  2. Build metadata filters  │
│  3. Execute hybrid search   │
│  4. Aggregate by summary_id │
│  5. Sort by relevance       │
└─────────────────────────────┘
    ↓
Return SearchResponse
    ↓
Client receives results
```

### 3. Context Retrieval Flow (Future)

```
Search returns child chunks
    ↓
Client requests more context
    ↓
QdrantService.get_node_by_id(parent_id)
    ↓
Return parent chunk with full context
```

## Configuration

### Environment Variables

```bash
# Application
APP_NAME="RAG Python API"
ENVIRONMENT="production"
DEBUG=false

# OpenAI
OPENAI_API_KEY="sk-..."
OPENAI_EMBEDDING_MODEL="text-embedding-3-small"

# Qdrant
QDRANT_URL="https://your-cluster.qdrant.io"
QDRANT_API_KEY="..."
QDRANT_COLLECTION_NAME="summaries"
QDRANT_PREFER_GRPC=false

# RAG Configuration
CHUNK_SIZE=512                    # Child chunk size
CHUNK_OVERLAP=128                 # Child overlap
PARENT_CHUNK_SIZE=2048            # Parent chunk size

# Hybrid Search
SPARSE_TOP_K=10                   # BM25 candidates
HYBRID_ALPHA=0.5                  # Fusion weight (0=sparse, 1=dense)

# AWS SQS
AWS_REGION="us-east-1"
AWS_ACCESS_KEY_ID="..."
AWS_SECRET_ACCESS_KEY="..."
SQS_QUEUE_URL="https://sqs.us-east-1.amazonaws.com/..."
SQS_MAX_MESSAGES=10
SQS_WAIT_TIME_SECONDS=20
SQS_VISIBILITY_TIMEOUT=300

# Worker
WORKER_POLL_INTERVAL=0
WORKER_MAX_RETRIES=3
WORKER_SHUTDOWN_TIMEOUT=30
```

### Tuning Parameters

#### Chunking Strategy

| Parameter | Default | Description | Impact |
|-----------|---------|-------------|--------|
| `chunk_size` | 512 | Child chunk size | Smaller = more precise, larger = more context |
| `chunk_overlap` | 128 | Child overlap | Higher = better continuity, more storage |
| `parent_chunk_size` | 2048 | Parent chunk size | Larger = broader context |

#### Search Parameters

| Parameter | Default | Description | Impact |
|-----------|---------|-------------|--------|
| `limit` | 10 | Total results | Higher = more results, slower |
| `sparse_top_k` | 10 | BM25 candidates | Higher = more keyword matches |
| `hybrid_alpha` | 0.5 | Dense/sparse weight | 0=keyword only, 1=semantic only |

#### Performance Optimization

1. **Batch Size**: Increase for bulk ingestion (default: 20)
2. **Sparse Top-K**: Tune based on query length and domain
3. **Hybrid Alpha**: Adjust based on use case:
   - 0.3-0.5: Technical docs with specific terms
   - 0.5-0.7: General content
   - 0.7-1.0: Conceptual queries

## Best Practices

### 1. Document Ingestion

- **Batch Processing**: Ingest documents in batches when possible
- **Content Size**: Keep documents under 10,000 tokens for optimal chunking
- **Metadata**: Always include `member_code` for multi-tenancy

### 2. Search Optimization

- **Query Length**: Keep queries under 200 tokens for best performance
- **Filtering**: Use `member_code` filter for tenant isolation
- **Limits**: Start with `limit=10`, increase only if needed

### 3. Error Handling

- **Retry Logic**: Implement exponential backoff for transient failures
- **Logging**: Monitor worker logs for ingestion errors
- **Dead Letter Queue**: Configure DLQ for persistent failures

### 4. Monitoring

- **Metrics to Track**:
  - Ingestion rate and latency
  - Search latency and throughput
  - Vector storage utilization
  - SQS queue depth
  - Error rates by type

## Future Enhancements

1. **Context Expansion API**: Endpoint to retrieve parent chunks for expanded context
2. **Batch Search**: Support searching multiple queries in one request
3. **Re-ranking**: Add cross-encoder re-ranking for improved relevance
4. **Caching**: Implement query result caching for common searches
5. **Analytics**: Add search analytics and relevance feedback
6. **Custom Embeddings**: Support for domain-specific embedding models
7. **Metadata Enrichment**: Add custom metadata fields for advanced filtering

## Troubleshooting

### Common Issues

#### 1. No Search Results

**Possible Causes**:
- Incorrect `member_code` filter
- Documents not ingested yet
- Query too specific

**Solutions**:
- Verify member_code matches ingested documents
- Check Qdrant collection for documents
- Try broader search queries

#### 2. Slow Search Performance

**Possible Causes**:
- Large result set
- High `sparse_top_k` value
- Network latency to Qdrant

**Solutions**:
- Reduce `limit` parameter
- Tune `sparse_top_k` (try 5-10)
- Use closer Qdrant instance

#### 3. Ingestion Failures

**Possible Causes**:
- OpenAI API errors
- Qdrant connection issues
- Invalid content format

**Solutions**:
- Check OpenAI API key and quota
- Verify Qdrant connectivity
- Validate document content structure

## Conclusion

This RAG implementation provides a robust, scalable solution for semantic document search with the following key advantages:

- **Hybrid Search**: Best of both semantic understanding and keyword matching
- **Hierarchical Chunking**: Balance between granular search and contextual retrieval
- **Multi-tenant**: Isolated data per user via member codes
- **Event-Driven**: Scalable async processing via SQS
- **Production-Ready**: Comprehensive error handling, logging, and monitoring

The system is designed to grow with your needs, supporting future enhancements while maintaining performance and reliability.

