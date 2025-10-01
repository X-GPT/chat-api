import {
	DeleteMessageBatchCommand,
	ReceiveMessageCommand,
	SQSClient,
} from "@aws-sdk/client-sqs";
import pLimit from "p-limit";
import invariant from "tiny-invariant";
import { getSqsQueueUrl, getSqsRegion } from "@/config/env";
import { SQSMessageSchema, type SummaryEvent } from "./events.schema";

const QUEUE_URL = getSqsQueueUrl();
const REGION = getSqsRegion();

// tune these
const MAX_BATCH = 10; // SQS max
const WAIT_TIME = 20; // seconds (long poll)
const VISIBILITY_TIMEOUT = 60; // seconds (queue default or per-message)
const CONCURRENCY = 5; // how many messages to process in parallel

const sqs = new SQSClient({ region: REGION });

type WorkResult = { receiptHandle: string; ok: boolean };

async function handleSummaryEvent(event: SummaryEvent): Promise<void> {
	console.log(`Processing summary ${event.action}:`, {
		id: event.id,
		memberCode: event.memberCode,
		teamCode: event.teamCode,
		action: event.action,
	});

	switch (event.action) {
		case "CREATED":
			// TODO: Handle summary creation
			// e.g., index in search, update cache, etc.
			break;
		case "UPDATED":
			// TODO: Handle summary update
			// e.g., reindex, invalidate cache, etc.
			break;
		case "DELETED":
			// TODO: Handle summary deletion
			// e.g., remove from index, clear cache, etc.
			break;
	}
}

async function handleMessage(
	body: string,
	_receiptHandle: string,
): Promise<void> {
	// Parse and validate JSON
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch (_err) {
		console.error("Invalid JSON in message body:", body);
		throw new Error("INVALID_JSON");
	}

	// Validate against schema
	const result = SQSMessageSchema.safeParse(parsed);
	if (!result.success) {
		console.error("Message validation failed:", {
			body,
			errors: result.error.issues,
		});
		throw new Error("INVALID_MESSAGE_SCHEMA");
	}

	const message = result.data;

	// If processing may exceed VISIBILITY_TIMEOUT, extend:
	// await extendVisibility(_receiptHandle, 120);

	// Route to appropriate handler
	switch (message.type) {
		case "summary:lifecycle": {
			await handleSummaryEvent(message.data);
			break;
		}
		// TypeScript ensures all cases are handled via discriminated union
	}
}

async function processBatch() {
	const res = await sqs.send(
		new ReceiveMessageCommand({
			QueueUrl: QUEUE_URL,
			MaxNumberOfMessages: MAX_BATCH,
			WaitTimeSeconds: WAIT_TIME, // long polling
			VisibilityTimeout: VISIBILITY_TIMEOUT, // optional override
			MessageAttributeNames: ["All"],
		}),
	);

	const messages = res.Messages ?? [];
	if (messages.length === 0) {
		return;
	}

	const limit = pLimit(CONCURRENCY);
	const results = await Promise.allSettled(
		messages.map((m) =>
			limit(async (): Promise<WorkResult> => {
				const receiptHandle = m.ReceiptHandle;
				invariant(receiptHandle, "Receipt handle is required");
				try {
					invariant(m.Body, "Message body is required");
					await handleMessage(m.Body, receiptHandle);
					return { receiptHandle, ok: true };
				} catch (err) {
					console.error("Message failed:", err);
					return { receiptHandle, ok: false };
				}
			}),
		),
	);

	// Ack only the successes
	const toDelete = results
		.filter(
			(r): r is PromiseFulfilledResult<WorkResult> =>
				r.status === "fulfilled" && r.value.ok,
		)
		.map((r) => ({
			Id: r.value.receiptHandle, // Use receiptHandle as ID (unique per message)
			ReceiptHandle: r.value.receiptHandle,
		}));

	if (toDelete.length > 0) {
		try {
			await sqs.send(
				new DeleteMessageBatchCommand({
					QueueUrl: QUEUE_URL,
					Entries: toDelete,
				}),
			);
		} catch (err) {
			console.error("Failed to delete messages:", err);
			// Messages will be reprocessed - ensure idempotency in handlers
		}
	}
}

async function run({ signal }: { signal: AbortSignal }) {
	console.log("SQS worker starting...");
	while (!signal.aborted) {
		try {
			await processBatch();
		} catch (e) {
			console.error("Batch error:", e);
			// small backoff after unexpected errors
			await new Promise((r) => setTimeout(r, 2000));
		}
	}
	console.log("SQS worker stopped.");
}

export async function runWorker({ signal }: { signal: AbortSignal }) {
	await run({ signal });
}
