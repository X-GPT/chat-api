import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { join } from "node:path";

// Run the real CLI binary against a stub gateway and capture the request the
// gateway receives. This exercises arg parsing end-to-end (the bug was that a
// query was mangled when --collection was absent).

const CLI = join(import.meta.dir, "mymemo-docs");

let lastSearch: { query?: string; collectionId?: string } | undefined;
let server: ReturnType<typeof Bun.serve>;

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/v1/documents/search") {
				lastSearch = await req.json();
				return Response.json({ documents: [] });
			}
			return new Response("not found", { status: 404 });
		},
	});
});

afterAll(() => server.stop(true));

async function runSearch(args: string[]) {
	lastSearch = undefined;
	const proc = Bun.spawn(["bun", CLI, "search", ...args], {
		env: {
			...process.env,
			MYMEMO_DOC_GATEWAY_URL: server.url.href.replace(/\/$/, ""),
			MYMEMO_DOC_TOKEN: "tok",
		},
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;
	return { exitCode, sent: lastSearch };
}

describe("mymemo-docs search arg parsing", () => {
	it("preserves a quoted multi-word query when --collection is absent", async () => {
		const { exitCode, sent } = await runSearch(["machine learning"]);
		expect(exitCode).toBe(0);
		expect(sent?.query).toBe("machine learning");
		expect(sent?.collectionId).toBeUndefined();
	});

	it("joins an unquoted multi-word query without dropping the first word", async () => {
		const { exitCode, sent } = await runSearch(["machine", "learning"]);
		expect(exitCode).toBe(0);
		expect(sent?.query).toBe("machine learning");
	});

	it("extracts --collection and keeps the surrounding query intact", async () => {
		const { exitCode, sent } = await runSearch([
			"neural",
			"--collection",
			"col-1",
			"nets",
		]);
		expect(exitCode).toBe(0);
		expect(sent?.query).toBe("neural nets");
		expect(sent?.collectionId).toBe("col-1");
	});
});
