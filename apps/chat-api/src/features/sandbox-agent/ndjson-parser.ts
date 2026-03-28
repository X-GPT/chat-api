export type AgentStreamEvent =
	| { type: "text_delta"; text: string }
	| { type: "result"; text: string }
	| { type: "error"; message: string };

/**
 * Create a line-buffered NDJSON parser for sandbox agent stdout.
 *
 * `onStdout` from E2B may deliver partial lines or multiple lines in one chunk.
 * This parser buffers until newline boundaries and emits parsed events.
 */
export function createNdjsonParser(
	onEvent: (event: AgentStreamEvent) => void,
): { feed(chunk: string): void; flush(): void } {
	let buffer = "";

	function processLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed) return;

		try {
			const parsed = JSON.parse(trimmed);

			if (
				typeof parsed !== "object" ||
				parsed === null ||
				typeof parsed.type !== "string"
			) {
				return;
			}

			switch (parsed.type) {
				case "text_delta":
					if (typeof parsed.text === "string") {
						onEvent({ type: "text_delta", text: parsed.text });
					}
					break;
				case "result":
					if (typeof parsed.text === "string") {
						onEvent({ type: "result", text: parsed.text });
					}
					break;
				case "error":
					if (typeof parsed.message === "string") {
						onEvent({ type: "error", message: parsed.message });
					}
					break;
				// Ignore unknown event types (e.g. tool_use for logging)
			}
		} catch {
			// Non-JSON output from sandbox — ignore (e.g. npm warnings)
		}
	}

	return {
		feed(chunk: string): void {
			buffer += chunk;

			let newlineIndex = buffer.indexOf("\n");
			while (newlineIndex !== -1) {
				const line = buffer.slice(0, newlineIndex);
				buffer = buffer.slice(newlineIndex + 1);
				processLine(line);
				newlineIndex = buffer.indexOf("\n");
			}
		},

		/** Flush any remaining buffered content. Call after the process exits. */
		flush(): void {
			if (buffer.trim()) {
				processLine(buffer);
				buffer = "";
			}
		},
	};
}
