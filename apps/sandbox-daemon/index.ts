import { Hono } from "hono";
import currentRoutes from "./routes/current";
import healthRoutes from "./routes/health";
import turnRoutes from "./routes/turn";

const app = new Hono();

app.route("/", healthRoutes);
app.route("/", currentRoutes);
app.route("/", turnRoutes);

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
	idleTimeout: 120,
};
