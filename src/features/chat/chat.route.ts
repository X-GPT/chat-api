import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validator as zValidator } from "hono-openapi";
import type { Env as PinoEnv } from "hono-pino";
import { complete } from "./chat.controller";
import { ChatLogger } from "./chat.logger";
import { ChatRequest } from "./chat.schema";
import { HonoSSESender } from "./chat.streaming";

const app = new Hono<PinoEnv>();

app.post(
	"/",
	zValidator("json", ChatRequest, (result, c) => {
		if (!result.success) {
			console.error({
				message: "Invalid request body",
				error: result.error,
			});
			return c.json({ error: result.error }, 400);
		}
	}),
	async (c) => {
		const request = c.req.valid("json");

		const memberAuthToken = c.req.header("X-Member-Auth");
		if (!memberAuthToken) {
			console.error({
				message: "X-Member-Auth is required",
			});
			return c.json({ error: "X-Member-Auth-Token is required" }, 400);
		}

		const memberCode = c.req.header("X-Member-Code");
		if (!memberCode) {
			console.error({
				message: "X-Member-Code is required",
			});
			return c.json({ error: "X-Member-Code is required" }, 400);
		}

		return streamSSE(
			c,
			async (stream) => {
				await complete(
					{
						chatContent: request.chatContent,
						chatKey: request.chatKey,
						chatType: request.chatType,
						collectionId: request.collectionId,
						summaryId: request.summaryId,
					},
					{
						memberAuthToken,
						memberCode,
					},
					new HonoSSESender(stream),
					new ChatLogger(c.var.logger, memberCode, request.chatKey),
				);
			},
			async (error, stream) => {
				console.error({
					message: "Error in chat route",
					error,
				});
				// TODO: enrich error with more details
				const sender = new HonoSSESender(stream);
				await sender.send({
					id: crypto.randomUUID(),
					message: {
						type: "error",
						message: error.message,
					},
				});
			},
		);
	},
);

export default app;
