"""Search request and response schemas."""

from pydantic import BaseModel, Field


class SearchRequest(BaseModel):
    """Request model for search endpoint."""

    query: str = Field(..., description="Search query text", min_length=1)
    member_code: str | None = Field(None, description="Optional member code to filter results")
    summary_id: int | None = Field(None, description="Optional summary ID to filter results")
    limit: int = Field(10, description="Maximum number of total results to return", ge=1, le=100)
    sparse_top_k: int = Field(
        10, description="Number of results from sparse (BM25) search", ge=1, le=100
    )


class SearchResultItem(BaseModel):
    """Individual search result item."""

    id: str = Field(..., description="Chunk ID")
    text: str = Field(..., description="Chunk text content")
    score: float = Field(..., description="Relevance score")
    parent_id: str | None = Field(None, description="Parent chunk ID")
    chunk_index: int = Field(..., description="Index of the chunk")


class SummaryResults(BaseModel):
    """Results for a specific summary."""

    summary_id: int = Field(..., description="Summary ID")
    member_code: str = Field(..., description="Member code")
    chunks: list[SearchResultItem] = Field(..., description="Matched chunks")
    total_chunks: int = Field(..., description="Total number of chunks for this summary")
    max_score: float = Field(..., description="Highest relevance score")


class SearchResponse(BaseModel):
    """Response model for search endpoint."""

    query: str = Field(..., description="Original search query")
    results: dict[str, SummaryResults] = Field(..., description="Results aggregated by summary_id")
    total_results: int = Field(..., description="Total number of results across all summaries")
