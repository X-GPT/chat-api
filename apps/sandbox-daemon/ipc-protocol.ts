/**
 * Wire protocol between the daemon and its sync.js / agent.js children.
 *
 * The three bundles are built and deployed independently, so the only
 * thing keeping them in sync is this types module — imported by both
 * producers (sync-entry, agent-entry) and the consumer (child-spawn).
 * A typo in either side becomes a TypeScript error rather than a silent
 * IPC mismatch at runtime.
 */

export type SyncEvent =
	| { type: "synced"; changed: boolean; dataRoot: string }
	| { type: "failed"; message: string };

export type AgentEvent =
	| { type: "text_delta"; text: string }
	| { type: "session_id"; sessionId: string }
	| { type: "completed" }
	| { type: "failed"; message: string };
