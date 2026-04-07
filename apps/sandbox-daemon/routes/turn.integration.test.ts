import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";

// Mock the agent module before importing the route
const mockRunAgent = mock();
mock.module("../agent", () => ({
	runAgent: mockRunAgent,
}));

// Mock reconcile to avoid needing a real Postgres
mock.module("../reconcile", () => ({
	reconcile: mock(() => Promise.resolve(false)),
}));

// Override getDataRoot to use a temp directory
const testRoot = join(tmpdir(), `turn-integration-${Date.now()}`);
mock.module("../materialization", () => {
	const actual = require("../materialization");
	return {
		...actual,
		getDataRoot: (userId: string) => join(testRoot, userId),
	};
});

// Ensure turn-lock module is loaded
require("../turn-lock");

import turnRoutes from "./turn";

describe("POST /turn integration", () => {
	const app = new Hono();
	app.route("/", turnRoutes);
	let reqCounter = 0;

	beforeAll(() => {
		mkdirSync(testRoot, { recursive: true });
		const userRoot = join(testRoot, "user-1");
		mkdirSync(join(userRoot, "scopes", "global"), { recursive: true });
	});

	beforeEach(() => {
		mockRunAgent.mockReset();
	});

	afterAll(() => {
		rmSync(testRoot, { recursive: true, force: true });
		mock.restore();
	});

	function makeTurnBody(overrides: Record<string, unknown> = {}) {
		reqCounter++;
		return {
			request_id: `req-${reqCounter}-${Date.now()}`,
			user_id: "user-1",
			required_version: 0,
			scope_type: "global",
			message: "hello",
			system_prompt: "you are helpful",
			db_connection_string: "postgresql://localhost/test",
			...overrides,
		};
	}

	function parseNdjson(text: string): Array<Record<string, unknown>> {
		return text
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line));
	}

	it("streams text_delta events from agent", async () => {
		mockRunAgent.mockImplementation(
			async (
				_opts: unknown,
				callbacks: {
					onTextDelta: (text: string) => void;
					onCompleted: () => void;
				},
			) => {
				callbacks.onTextDelta("Hello ");
				callbacks.onTextDelta("World");
				callbacks.onCompleted();
			},
		);

		const res = await app.request("/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeTurnBody()),
		});

		expect(res.status).toBe(200);
		const text = await res.text();
		const events = parseNdjson(text);

		const types = events.map((e) => e.type);
		expect(types).toContain("started");
		expect(types).toContain("text_delta");
		expect(types).toContain("completed");

		const deltas = events
			.filter((e) => e.type === "text_delta")
			.map((e) => e.text);
		expect(deltas).toEqual(["Hello ", "World"]);
	});

	it("streams session_id event", async () => {
		mockRunAgent.mockImplementation(
			async (
				_opts: unknown,
				callbacks: {
					onSessionId: (id: string) => void;
					onCompleted: () => void;
				},
			) => {
				callbacks.onSessionId("sess-xyz");
				callbacks.onCompleted();
			},
		);

		const res = await app.request("/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeTurnBody()),
		});

		const text = await res.text();
		const events = parseNdjson(text);

		const sessionEvent = events.find((e) => e.type === "session_id");
		expect(sessionEvent).toBeDefined();
		expect(sessionEvent?.sessionId).toBe("sess-xyz");
	});

	it("emits failed event when agent throws", async () => {
		mockRunAgent.mockRejectedValue(new Error("agent exploded"));

		const res = await app.request("/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeTurnBody()),
		});

		const text = await res.text();
		const events = parseNdjson(text);

		const failedEvent = events.find((e) => e.type === "failed");
		expect(failedEvent).toBeDefined();
		expect(failedEvent?.message).toContain("agent exploded");
	});

	it("emits failed event from onFailed callback", async () => {
		mockRunAgent.mockImplementation(
			async (
				_opts: unknown,
				callbacks: { onFailed: (msg: string) => void },
			) => {
				callbacks.onFailed("agent ended badly");
			},
		);

		const res = await app.request("/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeTurnBody()),
		});

		const text = await res.text();
		const events = parseNdjson(text);

		const failedEvent = events.find((e) => e.type === "failed");
		expect(failedEvent).toBeDefined();
		expect(failedEvent?.message).toBe("agent ended badly");
	});

	it("returns 409 when a turn is already in progress", async () => {
		let resolveAgent!: () => void;
		const agentPromise = new Promise<void>((resolve) => {
			resolveAgent = resolve;
		});
		mockRunAgent.mockImplementation(async () => {
			await agentPromise;
		});

		const body1 = makeTurnBody();
		const body2 = makeTurnBody();

		// Start first turn (don't await — it blocks on the agent)
		const req1Promise = app.request("/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body1),
		});

		// Give the first request time to acquire the lock
		await new Promise((r) => setTimeout(r, 100));

		// Second request should get 409
		const res2 = await app.request("/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body2),
		});

		expect(res2.status).toBe(409);
		const errorBody = await res2.json();
		expect(errorBody.error).toContain("Turn already in progress");

		// Clean up: resolve the agent to release the lock
		resolveAgent();
		await req1Promise;
	});
});
