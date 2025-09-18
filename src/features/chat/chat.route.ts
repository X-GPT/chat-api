import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validator as zValidator } from "hono-openapi";
import { complete } from "./chat.controller";
import { ChatRequest } from "./chat.schema";
import { HonoSSESender } from "./chat.streaming";

const app = new Hono();

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
					new HonoSSESender(stream),
				);
			},
			async (error, stream) => {
				console.error({
					message: "Error in messages route",
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
