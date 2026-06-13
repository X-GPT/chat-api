/**
 * Daemon: long-running HTTP server in the E2B sandbox. Owns /turn, request
 * locking, and streaming. Spawns agent.js per turn — never imports the Claude
 * Agent SDK directly, so the daemon bundle's transitive graph stays minimal.
 *
 * Env:
 *   DAEMON_PORT       — HTTP port (default 8080).
 *   DAEMON_VERSION    — surfaced by /health for the chat-api bundle check.
 *   DAEMON_AUTH_TOKEN — required bearer secret for /turn.
 *
 * The daemon holds no provider key: the agent's LLM gateway URL and bearer
 * token arrive per turn in the /turn body and are forwarded into agent.js's env.
 */

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
});
process.on("unhandledRejection", (err) => {
	console.error("Unhandled rejection:", err);
});

const port = Number(process.env.DAEMON_PORT) || 8080;

console.log(`Sandbox daemon starting on port ${port}`);

export default {
	port,
	fetch: app.fetch,
	// Per-connection idle timeout (Bun caps this at 255s). Must sit above the
	// agent idle watchdog (120s in child-spawn.ts) so that on a genuine hang the
	// daemon emits its own `failed` event before Bun silently drops the socket.
	// During a healthy long tool the agent's `heartbeat` events keep this armed.
	idleTimeout: 240,
};
