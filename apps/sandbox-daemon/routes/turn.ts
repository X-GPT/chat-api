import { Hono } from "hono";
import { stream } from "hono/streaming";
import { runAgent } from "../agent";
import {
	createEphemeralDocumentScope,
	getDataRoot,
	removeEphemeralDocumentScope,
	resolveScopeCwd,
} from "../materialization";
import { reconcile } from "../reconcile";
import { readLocalManifest } from "../state";
import { acquireTurn } from "../turn-lock";

const app = new Hono();

interface TurnRequest {
	request_id: string;
	user_id: string;
	required_version: number;
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
	const body = await c.req.json<TurnRequest>();

	if (
		!body.request_id ||
		!body.user_id ||
		!body.message ||
		!body.system_prompt ||
		typeof body.required_version !== "number"
	) {
		return c.json({ error: "Missing required fields" }, 400);
	}

	const {
		request_id,
		user_id,
		required_version,
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

				await reconcile({
					userId: user_id,
					requiredVersion: required_version,
				});

				let cwd: string;
				if (scope_type === "document" && summary_id) {
					const manifest = readLocalManifest(dataRoot);
					const doc = manifest.find((e) => e.document_id === summary_id);
					if (doc) {
						ephemeralScope = createEphemeralDocumentScope(
							dataRoot,
							summary_id,
							doc,
						);
						cwd = ephemeralScope;
					} else {
						cwd = resolveScopeCwd(dataRoot, "global");
					}
				} else {
					cwd = resolveScopeCwd(
						dataRoot,
						scope_type,
						collection_id ?? undefined,
					);
				}

				let turnFailed = false;

				await runAgent(
					{
						userQuery: message,
						systemPrompt: system_prompt,
						cwd,
						sessionId: agent_session_id,
					},
					{
						onTextDelta: async (text) => {
							await s.write(ndjsonLine({ type: "text_delta", text }));
						},
						onSessionId: async (sessionId) => {
							await s.write(ndjsonLine({ type: "session_id", sessionId }));
						},
						onCompleted: async () => {
							// Session ID persistence handled by the chat-api caller
						},
						onFailed: async (errorMessage) => {
							turnFailed = true;
							await s.write(
								ndjsonLine({ type: "failed", message: errorMessage }),
							);
						},
					},
				);

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
