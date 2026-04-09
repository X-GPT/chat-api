import { Hono } from "hono";
import { getCurrentTurn } from "../turn-lock";

const app = new Hono();

app.get("/current", (c) => {
	const { busy, turnId } = getCurrentTurn();
	return c.json({ busy, turnId });
});

export default app;
