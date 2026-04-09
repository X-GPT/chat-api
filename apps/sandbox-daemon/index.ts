import { Hono } from "hono";
import currentRoutes from "./routes/current";
import healthRoutes from "./routes/health";
import turnRoutes from "./routes/turn";

const app = new Hono();

app.route("/", healthRoutes);
app.route("/", currentRoutes);
app.route("/", turnRoutes);

app.onError((err, c) => {
	console.error("Hono error:", err);
	return c.json(
		{ error: err instanceof Error ? err.message : String(err) },
		500,
	);
});

process.on("uncaughtException", (err) => {
	console.error("Uncaught exception:", err);
	// Do not exit — keep the daemon alive for health checks and future turns
});
process.on("unhandledRejection", (err) => {
	console.error("Unhandled rejection:", err);
});

const port = Number(process.env.DAEMON_PORT) || 8080;

console.log(`Sandbox daemon starting on port ${port}`);

export default {
	port,
	fetch: app.fetch,
	idleTimeout: 120,
};
