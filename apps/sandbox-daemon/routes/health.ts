import { Hono } from "hono";

const app = new Hono();

const startTime = Date.now();

app.get("/health", (c) => {
	return c.json({
		status: "ok",
		version: process.env.DAEMON_VERSION ?? "unknown",
		uptime: Math.floor((Date.now() - startTime) / 1000),
	});
});

export default app;
