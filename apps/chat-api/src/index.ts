import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { pinoLogger } from "hono-pino";
// Import apiEnv to validate required environment variables at module load time
import { apiEnv } from "./config/env";
import routes from "./routes";

const app = new Hono();
app.use(requestId());
app.use(pinoLogger());

app.get("/", (c) => {
	return c.text("Hello Hono!");
});

app.get("/health", (c) => {
	return c.json({ status: "ok" });
});

app.route("/", routes);

if (apiEnv.SANDBOX_ENABLED) {
	const { documentRepository } = await import(
		"./features/sandbox-orchestration/singleton"
	);
	const { createSyncEndpoint } = await import(
		"./features/sandbox-orchestration/sync-endpoint"
	);
	app.route("/internal/sync", createSyncEndpoint(documentRepository));
}

export default app;
