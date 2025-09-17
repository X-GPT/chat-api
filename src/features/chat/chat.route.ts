import type { UIMessage } from "ai";
import { Hono } from "hono";
import { complete } from "./chat.controller";

const app = new Hono();

app.post("/", async (c) => {
	const { messages }: { messages: UIMessage[] } = await c.req.json();
	return complete(messages);
});

export default app;
