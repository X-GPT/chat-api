import { Hono } from "hono";
import routes from "./routes";

const app = new Hono();

app.get("/", (c) => {
	return c.text("Hello Hono!");
});

app.route("/", routes);

export default app;
