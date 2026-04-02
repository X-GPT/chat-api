import { Hono } from "hono";
import chatRoutes from "../features/chat/chat.route";
import sandboxSyncRoutes from "../features/sandbox-orchestration/sandbox-sync.route";

const app = new Hono();

/* ---------- feature routers ---------- */
app.route("/chat", chatRoutes);
app.route("/sandbox", sandboxSyncRoutes);

export default app;
