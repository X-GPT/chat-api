import { Hono } from "hono";
import type { DocumentRepository } from "./document-repository";

/**
 * Internal sync endpoint — serves source data for sandbox-side sync.
 *
 * GET /internal/sync/:userId?cursor=0&limit=100
 *
 * Response: { documents: SyncDocument[], nextCursor: number | null, total: number }
 *
 * No auth for Phase 4 (internal only). Add API key check in Phase 5.
 */
export function createSyncEndpoint(repository: DocumentRepository) {
	const app = new Hono();

	app.get("/:userId", async (c) => {
		const userId = c.req.param("userId");
		const cursor = Number(c.req.query("cursor") ?? "0");
		const limit = Math.min(
			Math.max(Number(c.req.query("limit") ?? "100"), 1),
			500,
		);

		const result = await repository.findAll(userId, cursor, limit);
		return c.json(result);
	});

	return app;
}
