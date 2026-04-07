import { afterEach, describe, expect, it, mock } from "bun:test";

Bun.env.OPENAI_API_KEY = Bun.env.OPENAI_API_KEY ?? "test-openai-key";
Bun.env.ANTHROPIC_API_KEY = Bun.env.ANTHROPIC_API_KEY ?? "test-anthropic-key";
Bun.env.PROTECTED_API_TOKEN = Bun.env.PROTECTED_API_TOKEN ?? "test-token";

import { ConversationBusyError } from "./errors";
import { forwardChatTurnToSandbox, type TurnRequest } from "./sandbox-proxy";

function makeTurnRequest(overrides: Partial<TurnRequest> = {}): TurnRequest {
	return {
		request_id: "req-1",
		user_id: "user-1",
		required_version: 1,
		scope_type: "global",
		message: "hello",
		system_prompt: "you are helpful",
		db_connection_string: "postgresql://localhost/test",
		...overrides,
	};
}

function ndjsonBody(events: Array<Record<string, unknown>>): string {
	return `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
}

describe("forwardChatTurnToSandbox", () => {
	afterEach(() => {
		mock.restore();
	});

	it("throws ConversationBusyError on 409", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response(null, { status: 409 })),
		) as unknown as typeof fetch;

		try {
			await expect(
				forwardChatTurnToSandbox({
					daemonUrl: "http://localhost:8080",
					turnRequest: makeTurnRequest(),
					onTextDelta: () => {},
					onTextEnd: async () => {},
					onSessionId: () => {},
				}),
			).rejects.toBeInstanceOf(ConversationBusyError);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("throws on non-ok response", async () => {
		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response("server error", { status: 500 })),
		) as unknown as typeof fetch;

		try {
			await expect(
				forwardChatTurnToSandbox({
					daemonUrl: "http://localhost:8080",
					turnRequest: makeTurnRequest(),
					onTextDelta: () => {},
					onTextEnd: async () => {},
					onSessionId: () => {},
				}),
			).rejects.toThrow("Daemon returned 500");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("parses text_delta events and calls onTextDelta", async () => {
		const body = ndjsonBody([
			{ type: "started", turn_id: "t1" },
			{ type: "text_delta", text: "hello " },
			{ type: "text_delta", text: "world" },
			{ type: "completed" },
		]);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response(body, { status: 200 })),
		) as unknown as typeof fetch;

		const deltas: string[] = [];
		let textEndCalled = false;

		try {
			await forwardChatTurnToSandbox({
				daemonUrl: "http://localhost:8080",
				turnRequest: makeTurnRequest(),
				onTextDelta: (text) => deltas.push(text),
				onTextEnd: async () => {
					textEndCalled = true;
				},
				onSessionId: () => {},
			});

			expect(deltas).toEqual(["hello ", "world"]);
			expect(textEndCalled).toBe(true);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("parses session_id events", async () => {
		const body = ndjsonBody([
			{ type: "started", turn_id: "t1" },
			{ type: "session_id", sessionId: "sess-abc" },
			{ type: "completed" },
		]);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response(body, { status: 200 })),
		) as unknown as typeof fetch;

		let capturedSessionId = "";

		try {
			await forwardChatTurnToSandbox({
				daemonUrl: "http://localhost:8080",
				turnRequest: makeTurnRequest(),
				onTextDelta: () => {},
				onTextEnd: async () => {},
				onSessionId: (id) => {
					capturedSessionId = id;
				},
			});

			expect(capturedSessionId).toBe("sess-abc");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("throws on failed event from daemon", async () => {
		const body = ndjsonBody([
			{ type: "started", turn_id: "t1" },
			{ type: "failed", message: "agent crashed" },
		]);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response(body, { status: 200 })),
		) as unknown as typeof fetch;

		try {
			await expect(
				forwardChatTurnToSandbox({
					daemonUrl: "http://localhost:8080",
					turnRequest: makeTurnRequest(),
					onTextDelta: () => {},
					onTextEnd: async () => {},
					onSessionId: () => {},
				}),
			).rejects.toThrow("agent crashed");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("handles error event type from agent", async () => {
		const body = ndjsonBody([
			{ type: "started", turn_id: "t1" },
			{ type: "error", message: "agent error" },
		]);

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response(body, { status: 200 })),
		) as unknown as typeof fetch;

		try {
			await expect(
				forwardChatTurnToSandbox({
					daemonUrl: "http://localhost:8080",
					turnRequest: makeTurnRequest(),
					onTextDelta: () => {},
					onTextEnd: async () => {},
					onSessionId: () => {},
				}),
			).rejects.toThrow("agent error");
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	it("ignores non-JSON lines", async () => {
		const body =
			"not json\n" +
			JSON.stringify({ type: "started", turn_id: "t1" }) +
			"\n" +
			JSON.stringify({ type: "text_delta", text: "ok" }) +
			"\n" +
			JSON.stringify({ type: "completed" }) +
			"\n";

		const originalFetch = globalThis.fetch;
		globalThis.fetch = mock(() =>
			Promise.resolve(new Response(body, { status: 200 })),
		) as unknown as typeof fetch;

		const deltas: string[] = [];

		try {
			await forwardChatTurnToSandbox({
				daemonUrl: "http://localhost:8080",
				turnRequest: makeTurnRequest(),
				onTextDelta: (text) => deltas.push(text),
				onTextEnd: async () => {},
				onSessionId: () => {},
			});

			expect(deltas).toEqual(["ok"]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});
});
