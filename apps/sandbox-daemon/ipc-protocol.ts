/**
 * Wire protocol between the daemon and its agent.js child.
 *
 * The two bundles are built and deployed independently, so the only thing
 * keeping them in sync is this types module — imported by both the producer
 * (agent-entry) and the consumer (child-spawn). A typo in either side becomes
 * a TypeScript error rather than a silent IPC mismatch at runtime.
 */

export type AgentEvent =
	| { type: "text_delta"; text: string }
	| { type: "session_id"; sessionId: string }
	// Internal liveness signal emitted while a tool is executing. Re-arms the
	// daemon's idle watchdog and keeps the chat-api↔daemon connection warm; it
	// carries no payload and is never surfaced to the end client as text.
	| { type: "heartbeat" }
	| { type: "completed" }
	| { type: "failed"; message: string };
