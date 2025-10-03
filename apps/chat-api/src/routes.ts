import { Hono } from "hono";
import v1Routes from "./routes/v1";

const app = new Hono();

app.route("/v1", v1Routes);

export default app;
