import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	mock,
} from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import type {
	AgentEvent,
	SpawnAgentInput,
	SpawnAgentResult,
	SyncResult,
} from "../child-spawn";

// Mock spawnSync / spawnAgent — turn route no longer runs sync/agent
// in-process. Sync now executes inside sync.js (spawned), agent inside
// agent.js (spawned). The test stubs both functions to control behavior.
const mockSpawnSync = mock(
	async (_input: { userId: string }): Promise<SyncResult> => ({
		type: "synced",
		changed: false,
		dataRoot: "/tmp/data",
	}),
);
const mockSpawnAgent = mock(
	async (_input: SpawnAgentInput): Promise<SpawnAgentResult> => ({
		exitCode: 0,
	}),
);
mock.module("../child-spawn", () => ({
	spawnSync: mockSpawnSync,
	spawnAgent: mockSpawnAgent,
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
		process.env.DAEMON_AUTH_TOKEN = "daemon-token";
		mockSpawnSync.mockReset();
		mockSpawnSync.mockImplementation(async () => ({
			type: "synced",
			changed: false,
			dataRoot: "/tmp/data",
		}));
		mockSpawnAgent.mockReset();
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
			scope_type: "global",
			message: "hello",
			system_prompt: "you are helpful",
			llm_base_url: "https://gateway.test",
			llm_token: "test-token",
			...overrides,
		};
	}

	function turnHeaders() {
		return {
			"Content-Type": "application/json",
			"x-daemon-auth-token": "daemon-token",
		};
	}

	function parseNdjson(text: string): Array<Record<string, unknown>> {
		return text
			.split("\n")
			.filter((line) => line.trim())
			.map((line) => JSON.parse(line));
	}

	async function emitAgent(
		input: SpawnAgentInput,
		events: AgentEvent[],
		exitCode = 0,
	): Promise<SpawnAgentResult> {
		for (const event of events) {
			await input.onEvent(event);
		}
		return { exitCode };
	}

	it("rejects requests without daemon auth token", async () => {
		const res = await app.request("/turn", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeTurnBody()),
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Unauthorized" });
		expect(mockSpawnSync).not.toHaveBeenCalled();
		expect(mockSpawnAgent).not.toHaveBeenCalled();
	});

	it("rejects requests with a wrong daemon auth token", async () => {
		const res = await app.request("/turn", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-daemon-auth-token": "wrong-token",
			},
			body: JSON.stringify(makeTurnBody()),
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Unauthorized" });
		expect(mockSpawnSync).not.toHaveBeenCalled();
		expect(mockSpawnAgent).not.toHaveBeenCalled();
	});

	it("rejects non-ASCII auth tokens without throwing", async () => {
		const res = await app.request("/turn", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"x-daemon-auth-token": "éééééééééééé",
			},
			body: JSON.stringify(makeTurnBody()),
		});

		expect(res.status).toBe(401);
		expect(await res.json()).toEqual({ error: "Unauthorized" });
		expect(mockSpawnSync).not.toHaveBeenCalled();
		expect(mockSpawnAgent).not.toHaveBeenCalled();
	});

	it("streams text_delta events forwarded from agent.js", async () => {
		mockSpawnAgent.mockImplementation((input) =>
			emitAgent(input, [
				{ type: "text_delta", text: "Hello " },
				{ type: "text_delta", text: "World" },
				{ type: "completed" },
			]),
		);

		const res = await app.request("/turn", {
			method: "POST",
			headers: turnHeaders(),
			body: JSON.stringify(makeTurnBody()),
		});

		expect(res.status).toBe(200);
		const events = parseNdjson(await res.text());

		const types = events.map((e) => e.type);
		expect(types).toContain("started");
		expect(types).toContain("text_delta");
		expect(types).toContain("completed");

		const deltas = events
			.filter((e) => e.type === "text_delta")
			.map((e) => e.text);
		expect(deltas).toEqual(["Hello ", "World"]);
	});

	it("forwards llm_base_url and llm_token from the body to spawnAgent", async () => {
		let captured: SpawnAgentInput | undefined;
		mockSpawnAgent.mockImplementation((input) => {
			captured = input;
			return emitAgent(input, [{ type: "completed" }]);
		});

		const res = await app.request("/turn", {
			method: "POST",
			headers: turnHeaders(),
			body: JSON.stringify(makeTurnBody()),
		});
		// Drain the stream so the turn completes and releases the lock before we
		// assert (and before the next test runs).
		await res.text();

		expect(captured?.llmBaseUrl).toBe("https://gateway.test");
		expect(captured?.llmToken).toBe("test-token");
	});

	it("forwards session_id from agent.js", async () => {
		mockSpawnAgent.mockImplementation((input) =>
			emitAgent(input, [
				{ type: "session_id", sessionId: "sess-xyz" },
				{ type: "completed" },
			]),
		);

		const res = await app.request("/turn", {
			method: "POST",
			headers: turnHeaders(),
			body: JSON.stringify(makeTurnBody()),
		});

		const events = parseNdjson(await res.text());

		const sessionEvent = events.find((e) => e.type === "session_id");
		expect(sessionEvent).toBeDefined();
		expect(sessionEvent?.sessionId).toBe("sess-xyz");
	});

	it("emits failed when spawnAgent throws", async () => {
		mockSpawnAgent.mockRejectedValue(new Error("agent exploded"));

		const res = await app.request("/turn", {
			method: "POST",
			headers: turnHeaders(),
			body: JSON.stringify(makeTurnBody()),
		});

		const events = parseNdjson(await res.text());
		const failed = events.find((e) => e.type === "failed");
		expect(failed).toBeDefined();
		expect(failed?.message).toContain("agent exploded");
	});

	it("emits failed when agent.js emits a failed event", async () => {
		mockSpawnAgent.mockImplementation((input) =>
			emitAgent(input, [{ type: "failed", message: "agent ended badly" }], 1),
		);

		const res = await app.request("/turn", {
			method: "POST",
			headers: turnHeaders(),
			body: JSON.stringify(makeTurnBody()),
		});

		const events = parseNdjson(await res.text());
		const failed = events.find((e) => e.type === "failed");
		expect(failed).toBeDefined();
		expect(failed?.message).toBe("agent ended badly");
	});

	it("emits failed when sync.js fails", async () => {
		mockSpawnSync.mockImplementation(async () => ({
			type: "failed",
			message: "DB unreachable",
		}));

		const res = await app.request("/turn", {
			method: "POST",
			headers: turnHeaders(),
			body: JSON.stringify(makeTurnBody()),
		});

		const events = parseNdjson(await res.text());
		const failed = events.find((e) => e.type === "failed");
		expect(failed).toBeDefined();
		expect(failed?.message).toContain("DB unreachable");
		// Agent must not be spawned if sync failed
		expect(mockSpawnAgent).not.toHaveBeenCalled();
	});

	it("returns 409 when a turn is already in progress", async () => {
		let resolveAgent!: () => void;
		const agentPromise = new Promise<void>((resolve) => {
			resolveAgent = resolve;
		});
		mockSpawnAgent.mockImplementation(async () => {
			await agentPromise;
			return { exitCode: 0 };
		});

		const body1 = makeTurnBody();
		const body2 = makeTurnBody();

		const req1Promise = app.request("/turn", {
			method: "POST",
			headers: turnHeaders(),
			body: JSON.stringify(body1),
		});

		// Give the first request time to acquire the lock
		await new Promise((r) => setTimeout(r, 100));

		const res2 = await app.request("/turn", {
			method: "POST",
			headers: turnHeaders(),
			body: JSON.stringify(body2),
		});

		expect(res2.status).toBe(409);
		const errorBody = await res2.json();
		expect(errorBody.error).toContain("Turn already in progress");

		resolveAgent();
		await req1Promise;
	});
});
