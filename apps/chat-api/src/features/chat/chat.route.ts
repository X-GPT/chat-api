import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { validator as zValidator } from "hono-openapi";
import type { Env as PinoEnv } from "hono-pino";
import { ConversationBusyError } from "@/features/sandbox-orchestration";
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

		return streamSSE(
			c,
			async (stream) => {
				const sender = new HonoSSESender(stream);

				// Start keepalive ping interval (5 seconds)
				const keepaliveInterval = setInterval(() => {
					sender.sendPing().catch((err) => {
						console.error({
							message: "Failed to send keepalive ping",
							error: err,
						});
					});
				}, 5000);

				try {
					await complete(
						request,
						sender,
						new ChatLogger(c.var.logger, request.memberCode, request.chatKey),
					);
				} catch (err) {
					if (err instanceof ConversationBusyError) {
						await sender.send({
							id: crypto.randomUUID(),
							message: {
								type: "error",
								message:
									"Sandbox is busy processing another request. Please try again shortly.",
							},
						});
						return;
					}
					throw err;
				} finally {
					// Always clear the interval when complete finishes
					clearInterval(keepaliveInterval);
				}
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
