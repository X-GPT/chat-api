# Testing Guide

## Quick Start

### Run All Tests (CI/CD default)
```bash
cd apps/rag-python
uv run pytest tests/ -v
# Runs unit tests, skips integration tests by default
```

### Run Only Integration Tests
```bash
# Start Qdrant first
docker run -p 6333:6333 qdrant/qdrant:latest

# Run with .env.local (contains OPENAI_API_KEY)
uv run --env-file .env.local pytest tests/ -v -m integration
```

## Test Categories

### Unit Tests (Fast, No Dependencies)
- ✅ Run in CI/CD automatically
- ✅ No external services required
- ✅ Fast execution

Examples:
- `test_collection_filter_operators.py` - Filter construction tests (8 tests)
- `test_api.py` - API endpoint tests with mocks
- `test_services.py` - Service layer tests

### Integration Tests (Slow, Requires Services)
- ⏭️ Skipped in CI/CD by default
- ⚠️ Requires Qdrant + OpenAI API key
- ⏱️ Slower (~25 seconds for 7 tests - network calls, embeddings)

Examples:
- `test_collection_filtering_integration.py` - End-to-end filtering tests (7 tests)

## Running Tests

### Default (Unit Tests Only)
```bash
uv run pytest tests/
```

### With Integration Tests
```bash
# Load environment from .env.local
uv run --env-file .env.local pytest tests/ -v -m integration
```

### Specific Test File
```bash
uv run pytest tests/test_collection_filter_operators.py -v
```

### Run All Tests (Including Integration)
```bash
uv run --env-file .env.local pytest tests/ -v -m ""
```

## Configuration

Integration tests are marked with `@pytest.mark.integration` and configured in `pyproject.toml`:

```toml
[tool.pytest.ini_options]
markers = [
    "integration: marks tests as integration tests (require external services)",
]
addopts = "-m 'not integration'"  # Skip integration tests by default
```

## Environment Setup

### .env.local Structure
```bash
# Required for integration tests
OPENAI_API_KEY=sk-...

# Qdrant settings (defaults work for local docker)
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=dummy-key  # Not needed for local Qdrant
```

## CI/CD

Tests run automatically in CI/CD:
- ✅ Unit tests run
- ⏭️ Integration tests skipped (require external services)
- ✅ Fast pipeline

## Troubleshooting

### "N deselected" Message
This is normal! Integration tests are skipped by default.

### Integration Tests Fail Locally
Check:
1. Qdrant is running: `curl http://localhost:6333/healthz`
2. `.env.local` has valid `OPENAI_API_KEY`
3. Using `--env-file .env.local` flag

### Tests Pass Locally But Fail in CI
Likely using integration tests that require external services.
Make sure they're marked with `@pytest.mark.integration`.

## More Information

- [pytest documentation](https://docs.pytest.org/) - General pytest info
- [Collection Relationship Implementation](../COLLECTION_RELATIONSHIP_IMPLEMENTATION.md) - Feature overview
