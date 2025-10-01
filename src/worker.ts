#!/usr/bin/env bun
/**
 * Worker entry point for SQS queue processing
 * Run separately from the API server for independent scaling
 */
import { runWorker } from "./worker/queue-worker";

const controller = new AbortController();

// Graceful shutdown handlers
process.on("SIGINT", () => {
	console.log("\nReceived SIGINT, shutting down gracefully...");
	controller.abort();
});

process.on("SIGTERM", () => {
	console.log("Received SIGTERM, shutting down gracefully...");
	controller.abort();
});

// Start the worker
await runWorker({ signal: controller.signal });
process.exit(0);
