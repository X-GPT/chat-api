import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";

const app = new Hono();

let cachedVersion: string | null = null;
const startTime = Date.now();

function getVersion(): string {
	if (!cachedVersion) {
		try {
			const pkg = JSON.parse(
				readFileSync(resolve(import.meta.dirname, "../package.json"), "utf-8"),
			);
			cachedVersion = pkg.version ?? "unknown";
		} catch {
			cachedVersion = "unknown";
		}
	}
	return cachedVersion;
}

app.get("/health", (c) => {
	return c.json({
		status: "ok",
		version: getVersion(),
		uptime: Math.floor((Date.now() - startTime) / 1000),
	});
});

export default app;
