import { Hono } from "hono";
import { validator as zValidator } from "hono-openapi";
import type { Env as PinoEnv } from "hono-pino";
import * as z from "zod";
import {
	ensureInitialSync,
	getSyncStatus,
} from "./sandbox-sync-service";
import { sandboxManager } from "./singleton";

const SyncRequestBody = z.object({
	partnerCode: z.string().min(1),
});

const app = new Hono<PinoEnv>();

app.post(
	"/sync",
	zValidator("json", SyncRequestBody, (result, c) => {
		if (!result.success) {
			return c.json({ error: "partnerCode is required" }, 400);
		}
	}),
	async (c) => {
		const memberAuthToken = c.req.header("X-Member-Auth");
		if (!memberAuthToken) {
			return c.json({ error: "X-Member-Auth is required" }, 400);
		}
		const memberCode = c.req.header("X-Member-Code");
		if (!memberCode) {
			return c.json({ error: "X-Member-Code is required" }, 400);
		}

		const { partnerCode } = c.req.valid("json");
		const logger = c.var.logger;

		try {
			const sandbox = await sandboxManager.getOrCreateSandbox(
				memberCode,
				logger,
			);
			await ensureInitialSync({
				userId: memberCode,
				sandbox,
				options: { memberCode, partnerCode, memberAuthToken },
				logger,
			});

			return c.json({ status: "synced" });
		} catch (err) {
			logger.error({
				msg: "Failed to start sync",
				memberCode,
				error: err instanceof Error ? err.message : String(err),
			});
			return c.json(
				{
					status: "error",
					message: err instanceof Error ? err.message : String(err),
				},
				500,
			);
		}
	},
);

app.get("/sync", async (c) => {
	const memberAuthToken = c.req.header("X-Member-Auth");
	if (!memberAuthToken) {
		return c.json({ error: "X-Member-Auth is required" }, 400);
	}
	const memberCode = c.req.header("X-Member-Code");
	if (!memberCode) {
		return c.json({ error: "X-Member-Code is required" }, 400);
	}

	// Slow path — need sandbox to read filesystem state
	try {
		const sandbox = await sandboxManager.getOrCreateSandbox(
			memberCode,
			c.var.logger,
		);
		const docsRoot = sandboxManager.getDocsRoot(memberCode);
		const status = await getSyncStatus({
			sandbox,
			docsRoot,
		});

		return c.json(status);
	} catch (err) {
		return c.json(
			{
				status: "error",
				message: err instanceof Error ? err.message : String(err),
			},
			500,
		);
	}
});

export default app;
