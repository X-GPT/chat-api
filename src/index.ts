import { Hono } from "hono";
import routes from "./routes";

const app = new Hono();

app.get("/", (c) => {
	return c.text("Hello Hono!");
});

app.get("/health", (c) => {
	return c.json({ status: "ok" });
});

app.route("/", routes);

export default app;
