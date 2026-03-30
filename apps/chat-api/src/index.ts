import { Hono } from "hono";
import { requestId } from "hono/request-id";
import { pinoLogger } from "hono-pino";
// Import apiEnv to validate required environment variables at module load time
import "./config/env";
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

export default app;
