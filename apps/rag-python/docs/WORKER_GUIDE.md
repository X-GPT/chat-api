# SQS Worker Implementation Guide

## Overview

This guide covers the production-ready SQS worker implementation for processing asynchronous events from AWS SQS.

## Architecture

### Components

```
worker/
├── worker.py         # Main worker with event loop and graceful shutdown
├── sqs_client.py     # Async AWS SQS client wrapper
├── processor.py      # Message processing orchestration
└── handlers.py       # Event-specific business logic handlers
```

### Design Principles

1. **Separation of Concerns**: Each component has a single responsibility
2. **Async/Await**: Fully asynchronous for high performance
3. **Type Safety**: Complete type hints with Pydantic validation
4. **Error Handling**: Comprehensive error handling at each layer
5. **Testability**: Easily testable with dependency injection

## Best Practices Implemented

### 1. Long Polling

```python
# Reduces API calls and costs
SQS_WAIT_TIME_SECONDS=20  # Max is 20 seconds
```

### 2. Batch Processing

```python
# Process multiple messages concurrently
SQS_MAX_MESSAGES=10  # Max is 10
```

### 3. Visibility Timeout

```python
# Prevents message re-processing during handling
SQS_VISIBILITY_TIMEOUT=300  # 5 minutes
```

### 4. Graceful Shutdown

```python
# Handles SIGINT (Ctrl+C) and SIGTERM signals
# Allows current messages to complete processing
WORKER_SHUTDOWN_TIMEOUT=30  # seconds
```

### 5. Message Deletion Strategy

- Messages are **only deleted after successful processing**
- Failed messages remain in queue for retry
- Uses batch deletion for efficiency

### 6. Error Handling

- **Parse errors**: Invalid JSON → logged and skipped
- **Validation errors**: Invalid schema → logged and skipped
- **Processing errors**: Handler failure → message returns to queue
- **AWS errors**: Connection issues → logged and retried

## Event Flow

```
1. SQS Queue
   ↓
2. Worker polls (long polling)
   ↓
3. Receive messages (batch of up to 10)
   ↓
4. Parse & validate (Pydantic schemas)
   ↓
5. Route to handler (based on event_type)
   ↓
6. Process event (business logic)
   ↓
7. Delete message (if successful)
   ↓
8. Repeat
```

## Adding New Event Types

### Step 1: Define Event Type

```python
# src/rag_python/schemas/events.py

class EventType(str, Enum):
    DOCUMENT_PROCESSED = "document.processed"
```

### Step 2: Create Event Schema (Optional)

```python
class DocumentProcessedEvent(BaseEvent):
    event_type: EventType = Field(default=EventType.DOCUMENT_PROCESSED)
    payload: dict[str, Any] = Field(...)  # Define your payload structure
```

### Step 3: Create Handler

```python
# src/rag_python/worker/handlers.py

class DocumentProcessedHandler(EventHandler):
    async def handle(self, event: BaseEvent) -> bool:
        logger.info(f"Processing document: {event.event_id}")

        # Your business logic here
        document_id = event.payload.get("document_id")

        # Example: Store to database, send notification, etc.

        return True  # Return True on success
```

### Step 4: Register Handler

```python
# In EventHandlerRegistry.__init__

self._handlers[EventType.DOCUMENT_PROCESSED] = DocumentProcessedHandler()
```

## Configuration

### Environment Variables

```bash
# Required
AWS_REGION=us-east-1
SQS_QUEUE_URL=https://sqs.us-east-1.amazonaws.com/123456789/queue-name

# Optional (uses IAM role if not set)
AWS_ACCESS_KEY_ID=your_key
AWS_SECRET_ACCESS_KEY=your_secret

# Worker Settings (with defaults)
SQS_MAX_MESSAGES=10
SQS_WAIT_TIME_SECONDS=20
SQS_VISIBILITY_TIMEOUT=300
WORKER_POLL_INTERVAL=0
WORKER_MAX_RETRIES=3
WORKER_SHUTDOWN_TIMEOUT=30
```

## Running the Worker

### Development

```bash
# Copy and configure environment
cp .env.example .env
# Edit .env with your AWS credentials

# Run worker
uv run python -m rag_python.worker.worker
```

### Testing

```bash
# Send a test message
uv run python scripts/send_test_message.py

# Run tests
uv run pytest tests/test_worker.py -v
```

### Production (Docker)

```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY .. .

# Install dependencies
RUN pip install uv && uv sync --no-dev

# Run worker
CMD ["uv", "run", "python", "-m", "rag_python.worker.worker"]
```

### Production (Kubernetes)

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: sqs-worker
spec:
  replicas: 3  # Scale based on queue depth
  template:
    spec:
      containers:
      - name: worker
        image: your-image:latest
        env:
        - name: SQS_QUEUE_URL
          value: "https://sqs.us-east-1.amazonaws.com/..."
        - name: AWS_REGION
          value: "us-east-1"
        resources:
          requests:
            memory: "256Mi"
            cpu: "250m"
          limits:
            memory: "512Mi"
            cpu: "500m"
```

## Monitoring

### Key Metrics to Track

1. **Messages Processed**: Count of successful/failed messages
2. **Processing Time**: Average time per message
3. **Queue Depth**: SQS ApproximateNumberOfMessages
4. **Error Rate**: Failed message percentage
5. **Worker Health**: Process uptime and memory usage

### Logging

The worker logs important events:

```python
# Examples of log output
INFO: Starting SQS Worker...
INFO: Received 5 messages from SQS
INFO: Processing event evt_123 (type: hello)
INFO: Successfully processed event evt_123
INFO: Batch complete: 5 succeeded, 0 failed
ERROR: Failed to process event evt_456: ValueError
```

## Scaling

### Horizontal Scaling

- Run multiple worker instances
- Each worker polls independently
- SQS ensures no duplicate processing (within visibility timeout)

### Vertical Scaling

- Increase `SQS_MAX_MESSAGES` for larger batches
- Adjust worker resources (CPU/memory)

### Auto-scaling

Scale based on SQS queue depth:

```python
# CloudWatch Alarm → Auto Scaling Group
if queue_depth > 100:
    scale_out()
elif queue_depth < 10:
    scale_in()
```

## Troubleshooting

### Messages Not Processing

1. Check queue URL: `echo $SQS_QUEUE_URL`
2. Verify AWS credentials: `aws sqs get-queue-attributes ...`
3. Check visibility timeout vs processing time
4. Review worker logs for errors

### High Error Rate

1. Check event schema validation
2. Review handler business logic
3. Verify external service availability
4. Check for timeouts

### Messages Reappearing

- Processing time exceeds visibility timeout
- Solution: Increase `SQS_VISIBILITY_TIMEOUT`

### Worker Crashes

- Check memory limits
- Review error logs
- Ensure graceful shutdown is working

## Performance Tips

1. **Use batch operations**: Delete messages in batches
2. **Concurrent processing**: Process messages concurrently with asyncio
3. **Connection pooling**: Reuse HTTP connections
4. **Dead letter queues**: Configure for failed messages
5. **Monitoring**: Track metrics and set up alerts

## Security Best Practices

1. **IAM Roles**: Use IAM roles instead of access keys in production
2. **Least Privilege**: Grant minimum required SQS permissions
3. **Encryption**: Enable SQS encryption at rest
4. **VPC**: Run workers in private subnets
5. **Secrets**: Use AWS Secrets Manager for sensitive data

## Related Documentation

- [AWS SQS Best Practices](https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-best-practices.html)
- [Python asyncio](https://docs.python.org/3/library/asyncio.html)
- [Pydantic Validation](https://docs.pydantic.dev/)

