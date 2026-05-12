import { mkdirSync } from "node:fs";
import { Hono } from "hono";
import { stream } from "hono/streaming";
import { spawnAgent, spawnSync } from "../child-spawn";
import {
	createEphemeralDocumentScope,
	findCanonicalDoc,
	getDataRoot,
	removeEphemeralDocumentScope,
	resolveScopeCwd,
} from "../materialization";
import { acquireTurn } from "../turn-lock";

const app = new Hono();
const DAEMON_AUTH_HEADER = "x-daemon-auth-token";

interface TurnRequest {
	request_id: string;
	user_id: string;
	scope_type: "global" | "collection" | "document";
	collection_id?: string;
	summary_id?: string;
	message: string;
	agent_session_id?: string;
	system_prompt: string;
}

function ndjsonLine(obj: Record<string, unknown>): string {
	return `${JSON.stringify(obj)}\n`;
}

app.post("/turn", async (c) => {
	const expectedToken = process.env.DAEMON_AUTH_TOKEN;
	if (!expectedToken || c.req.header(DAEMON_AUTH_HEADER) !== expectedToken) {
		return c.json({ error: "Unauthorized" }, 401);
	}

	const body = await c.req.json<TurnRequest>();

	if (
		!body.request_id ||
		!body.user_id ||
		!body.message ||
		!body.system_prompt
	) {
		return c.json({ error: "Missing required fields" }, 400);
	}

	const {
		request_id,
		user_id,
		scope_type,
		collection_id,
		summary_id,
		message,
		agent_session_id,
		system_prompt,
	} = body;

	const lock = acquireTurn(request_id);
	if (!lock) {
		return c.json({ error: "Turn already in progress" }, 409);
	}

	return stream(
		c,
		async (s) => {
			c.header("Content-Type", "application/x-ndjson");

			const dataRoot = getDataRoot(user_id);
			let ephemeralScope: string | null = null;

			try {
				await s.write(ndjsonLine({ type: "started", turn_id: request_id }));

				const syncResult = await spawnSync({ userId: user_id });
				if (syncResult.type === "failed") {
					await s.write(
						ndjsonLine({
							type: "failed",
							message: `sync failed: ${syncResult.message}`,
						}),
					);
					return;
				}

				if (scope_type === "collection" && !collection_id) {
					await s.write(
						ndjsonLine({
							type: "failed",
							message: "collection_id required for collection scope",
						}),
					);
					return;
				}
				if (scope_type === "document" && !summary_id) {
					await s.write(
						ndjsonLine({
							type: "failed",
							message: "summary_id required for document scope",
						}),
					);
					return;
				}

				let cwd: string;
				if (scope_type === "document" && summary_id) {
					const doc = findCanonicalDoc(dataRoot, summary_id);
					if (!doc) {
						await s.write(
							ndjsonLine({
								type: "failed",
								message: `Document ${summary_id} not found`,
							}),
						);
						return;
					}
					ephemeralScope = createEphemeralDocumentScope(
						dataRoot,
						summary_id,
						doc,
					);
					cwd = ephemeralScope;
				} else {
					cwd = resolveScopeCwd(
						dataRoot,
						scope_type,
						collection_id ?? undefined,
					);
					mkdirSync(cwd, { recursive: true });
				}

				let turnFailed = false;
				const agentResult = await spawnAgent({
					userQuery: message,
					systemPrompt: system_prompt,
					cwd,
					sessionId: agent_session_id,
					onEvent: async (event) => {
						if (event.type === "completed") {
							// We emit our own `completed` below.
							return;
						}
						if (event.type === "failed") {
							turnFailed = true;
						}
						await s.write(ndjsonLine(event));
					},
				});

				if (agentResult.exitCode !== 0 && !turnFailed) {
					turnFailed = true;
					await s.write(
						ndjsonLine({
							type: "failed",
							message: `agent exited with code ${agentResult.exitCode}`,
						}),
					);
				}

				if (!turnFailed) {
					await s.write(ndjsonLine({ type: "completed" }));
				}
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				await s.write(ndjsonLine({ type: "failed", message: errorMessage }));
			} finally {
				if (ephemeralScope && summary_id) {
					removeEphemeralDocumentScope(dataRoot, summary_id);
				}
				lock.release();
			}
		},
		async (err, stream) => {
			const message = err instanceof Error ? err.message : String(err);
			console.error("Stream error in /turn:", message);
			await stream.write(ndjsonLine({ type: "failed", message }));
			lock.release();
		},
	);
});

export default app;
