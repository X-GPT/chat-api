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
	| { type: "completed" }
	| { type: "failed"; message: string };
