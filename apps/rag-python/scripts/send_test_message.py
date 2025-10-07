#!/usr/bin/env python3
"""Script to send a test message to SQS for testing the worker."""

import asyncio
import json
from datetime import datetime
from uuid import uuid4

from rag_python.config import get_settings
from rag_python.worker.sqs_client import SQSClient


async def send_test_message():
    """Send a test hello event message to SQS."""
    settings = get_settings()

    if not settings.sqs_queue_url:
        print("Error: SQS_QUEUE_URL not configured")
        return

    sqs_client = SQSClient(settings)

    # Create a test event
    event = {
        "event_type": "hello",
        "event_id": str(uuid4()),
        "timestamp": datetime.utcnow().isoformat(),
        "payload": {"message": "Hello from test script!"},
    }

    print(f"Sending test message to: {settings.sqs_queue_url}")
    print(f"Event: {json.dumps(event, indent=2)}")

    message_id = await sqs_client.send_message(event)

    if message_id:
        print(f"✓ Message sent successfully! Message ID: {message_id}")
    else:
        print("✗ Failed to send message")


if __name__ == "__main__":
    asyncio.run(send_test_message())
