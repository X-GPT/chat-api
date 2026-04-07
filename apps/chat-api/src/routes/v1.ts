import { Hono } from "hono";
import chatRoutes from "../features/chat/chat.route";

const app = new Hono();

/* ---------- feature routers ---------- */
app.route("/chat", chatRoutes);

export default app;
