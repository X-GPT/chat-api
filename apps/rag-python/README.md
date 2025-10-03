# rag-python

RAG (Retrieval-Augmented Generation) Python project.

## Setup

This project uses [uv](https://github.com/astral-sh/uv) for fast, reliable Python package management.

### Prerequisites

Install uv if you haven't already:

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

### Installation

```bash
# Create a virtual environment and install dependencies
uv sync

# Copy environment variables template (optional)
cp .env.example .env

# Activate the virtual environment
source .venv/bin/activate  # On Unix/macOS
# or
.venv\Scripts\activate  # On Windows
```

### Development

```bash
# Install development dependencies
uv sync --dev

# Run tests
uv run pytest

# Run linting
uv run ruff check .

# Format code
uv run ruff format .
```

## Project Structure

```
rag-python/
├── src/
│   └── rag_python/
│       ├── api/                  # API layer
│       │   └── v1/              # API version 1
│       │       ├── endpoints/   # API endpoints
│       │       │   ├── health.py
│       │       │   └── hello.py
│       │       └── router.py    # Main v1 router
│       ├── core/                # Core functionality
│       │   ├── exceptions.py    # Exception handlers
│       │   ├── logging.py       # Logging setup
│       │   └── security.py      # Security middleware
│       ├── schemas/             # Pydantic models
│       │   ├── health.py
│       │   └── hello.py
│       ├── services/            # Business logic
│       │   └── hello.py
│       ├── utils/               # Utility functions
│       ├── config.py            # Configuration management
│       ├── dependencies.py      # FastAPI dependencies
│       └── main.py             # Application entry point
├── tests/                       # Test files
│   ├── test_api.py
│   ├── test_config.py
│   ├── test_health.py
│   ├── test_hello.py
│   └── test_services.py
├── .env.example                 # Environment variables template
├── pyproject.toml              # Project configuration
└── README.md                   # This file
```

### Architecture

This project follows a **production-ready layered architecture**:

- **API Layer** (`api/`): REST endpoints organized by version
- **Schemas** (`schemas/`): Request/response validation models
- **Services** (`services/`): Business logic layer
- **Core** (`core/`): Cross-cutting concerns (logging, security, exceptions)
- **Config** (`config.py`): Centralized configuration management
- **Dependencies** (`dependencies.py`): Dependency injection

## Running the API

### Development Server

```bash
# Run the FastAPI development server
uv run fastapi dev src/rag_python/main.py

# Or using uvicorn directly
uv run uvicorn rag_python.main:app --reload --host 0.0.0.0 --port 8000
```

The API will be available at:
- API: http://localhost:8000
- Interactive API docs (Swagger UI): http://localhost:8000/docs
- Alternative API docs (ReDoc): http://localhost:8000/redoc

### Production Server

```bash
uv run fastapi run src/rag_python/main.py
```

## API Endpoints

All API endpoints are versioned under `/api/v1`.

### Health Check

Check API health and status:

```bash
curl http://localhost:8000/api/v1/health
```

Response:
```json
{
  "status": "healthy",
  "version": "0.1.0",
  "environment": "development"
}
```

### Hello World

Get a hello world message:

```bash
curl http://localhost:8000/api/v1/hello-world
```

Response:
```json
{
  "message": "Hello, World!"
}
```

## Configuration

The application is configured using environment variables. See `.env.example` for available options:

- `APP_NAME`: Application name
- `ENVIRONMENT`: Environment (development/staging/production)
- `API_V1_PREFIX`: API version 1 prefix path
- `LOG_LEVEL`: Logging level (DEBUG/INFO/WARNING/ERROR)
- `CORS_ORIGINS`: Allowed CORS origins

## SQS Worker

The project includes a production-ready SQS worker for processing asynchronous events.

### Running the Worker

```bash
# Run the worker
uv run python -m rag_python.worker.worker

# Or directly
uv run python src/rag_python/worker/worker.py
```

### Worker Architecture

The worker follows a **modular, event-driven architecture**:

```
worker/
├── worker.py         # Main worker loop with graceful shutdown
├── sqs_client.py     # Async SQS client wrapper
├── processor.py      # Message processing and orchestration
└── handlers.py       # Event-specific business logic handlers
```

### Key Features

- **Long Polling**: Efficient SQS long polling (20s wait time)
- **Batch Processing**: Process up to 10 messages concurrently
- **Graceful Shutdown**: Handles SIGINT/SIGTERM signals
- **Error Handling**: Automatic retry via SQS visibility timeout
- **Message Deletion**: Only deletes after successful processing
- **Event Registry**: Pluggable event handler system
- **Async/Await**: Fully asynchronous for high performance
- **Type Safety**: Full type hints and Pydantic validation

### Adding New Event Handlers

1. Define your event type in `schemas/events.py`:

```python
class EventType(str, Enum):
    MY_EVENT = "my.event"
```

2. Create a handler in `worker/handlers.py`:

```python
class MyEventHandler(EventHandler):
    async def handle(self, event: BaseEvent) -> bool:
        # Your business logic here
        return True
```

3. Register the handler:

```python
# In EventHandlerRegistry.__init__
self._handlers[EventType.MY_EVENT] = MyEventHandler()
```

### Sending Test Messages

Use the provided script to send test messages:

```bash
# Configure your AWS credentials and queue URL in .env
uv run python scripts/send_test_message.py
```

### Worker Configuration

Configure the worker via environment variables:

```bash
# AWS Configuration
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret
SQS_QUEUE_URL=https://sqs...

# Worker Settings
SQS_MAX_MESSAGES=10           # Batch size (1-10)
SQS_WAIT_TIME_SECONDS=20      # Long polling wait (0-20)
SQS_VISIBILITY_TIMEOUT=300    # Message visibility (seconds)
WORKER_POLL_INTERVAL=0        # Delay between polls (0=continuous)
WORKER_SHUTDOWN_TIMEOUT=30    # Graceful shutdown timeout
```

### Production Deployment

For production, run the worker as a separate service:

**Docker:**
```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY . .
RUN pip install uv && uv sync
CMD ["uv", "run", "python", "-m", "rag_python.worker.worker"]
```

**Systemd Service:**
```ini
[Unit]
Description=RAG Python SQS Worker
After=network.target

[Service]
Type=simple
User=worker
WorkingDirectory=/app
ExecStart=/usr/local/bin/uv run python -m rag_python.worker.worker
Restart=always

[Install]
WantedBy=multi-user.target
```

## Features

### Production-Ready Architecture

- ✅ **API Versioning**: `/api/v1` prefix for future compatibility
- ✅ **Layered Architecture**: Separation of concerns (API/Services/Schemas)
- ✅ **Configuration Management**: Environment-based settings
- ✅ **Exception Handling**: Global exception handlers
- ✅ **Security**: Security headers middleware
- ✅ **CORS**: Configurable CORS middleware
- ✅ **Logging**: Structured logging with configurable levels
- ✅ **Dependency Injection**: FastAPI dependencies
- ✅ **Type Safety**: Full type hints throughout
- ✅ **Testing**: Comprehensive test coverage
- ✅ **Documentation**: Auto-generated OpenAPI docs
- ✅ **SQS Worker**: Production-ready async event processing
- ✅ **Event Handlers**: Pluggable event handler system
- ✅ **Graceful Shutdown**: Signal handling for clean termination

## Usage

```python
from rag_python import __version__

print(f"RAG Python version: {__version__}")
```

