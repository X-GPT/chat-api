/**
 * Liveness heartbeat for long-running tool execution.
 *
 * The daemon's idle watchdog (child-spawn.ts) re-arms on every NDJSON event the
 * agent emits on stdout. But a tool actually executing — a Bash command, a
 * `mymemo-docs` fetch, local data processing — emits nothing on stdout for its
 * whole wall-clock duration. A single tool that runs longer than the idle window
 * would therefore be SIGKILLed mid-flight even though the turn is perfectly
 * healthy (the original watchdog bug).
 *
 * While any tool is in flight we emit a periodic `heartbeat` event so the
 * watchdog — and the chat-api↔daemon connection it travels over — stays armed.
 * Driven by the SDK's PreToolUse / PostToolUse hooks (see agent.ts). A Set keyed
 * by tool_use_id handles parallel tool calls and makes a duplicate / unmatched
 * stop a no-op.
 *
 * No SDK import here on purpose: this is pure timer logic so it is unit-testable
 * without standing up a real `query()`.
 */

export const HEARTBEAT_INTERVAL_MS = 15_000;

export interface HeartbeatController {
	/** A tool started executing. First in-flight tool starts the heartbeat. */
	onToolStart(toolUseId: string): void;
	/** A tool finished. Heartbeat stops once nothing is in flight. */
	onToolEnd(toolUseId: string): void;
	/** Hard stop — always call on turn teardown so the interval never leaks. */
	stop(): void;
}

export function createHeartbeatController(
	onHeartbeat: () => void,
	intervalMs: number = HEARTBEAT_INTERVAL_MS,
): HeartbeatController {
	const inFlight = new Set<string>();
	let timer: ReturnType<typeof setInterval> | undefined;

	return {
		onToolStart(toolUseId) {
			const wasIdle = inFlight.size === 0;
			inFlight.add(toolUseId);
			if (wasIdle) {
				// Beat immediately so a tool that runs long from its very first
				// moment re-arms the watchdog without waiting a full interval.
				onHeartbeat();
				timer = setInterval(onHeartbeat, intervalMs);
			}
		},
		onToolEnd(toolUseId) {
			inFlight.delete(toolUseId);
			if (inFlight.size === 0 && timer !== undefined) {
				clearInterval(timer);
				timer = undefined;
			}
		},
		stop() {
			inFlight.clear();
			if (timer !== undefined) {
				clearInterval(timer);
				timer = undefined;
			}
		},
	};
}
