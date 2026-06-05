import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { build } from "../build";

// Build the shipped bundle (citty inlined) and exercise THAT, not the source,
// so a bundling regression is caught too. The bundle is run against a stub
// gateway that captures the request, verifying arg parsing end-to-end.

interface SearchBody {
	query?: string;
}

let CLI: string;
let lastSearch: SearchBody | undefined;
let searchResponse: unknown = { documents: [] };
let server: ReturnType<typeof Bun.serve>;

beforeAll(async () => {
	CLI = await build();
	server = Bun.serve({
		port: 0,
		async fetch(req) {
			const url = new URL(req.url);
			if (url.pathname === "/v1/documents/search") {
				lastSearch = (await req.json()) as SearchBody;
				return Response.json(searchResponse);
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
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return {
		exitCode,
		stdout,
		stderr,
		sent: lastSearch as SearchBody | undefined,
	};
}

async function runHelp(args: string[]) {
	const proc = Bun.spawn(["bun", CLI, ...args], {
		// No MYMEMO_DOC_* env: citty handles --help before run, so help needs no
		// token. NO_COLOR strips ANSI codes for stable assertions.
		env: { PATH: process.env.PATH ?? "", NO_COLOR: "1" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const exitCode = await proc.exited;
	const stdout = await new Response(proc.stdout).text();
	return { exitCode, stdout };
}

describe("mymemo-docs --help (citty-generated)", () => {
	it("lists both subcommands without needing a token", async () => {
		const { exitCode, stdout } = await runHelp(["--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("search");
		expect(stdout).toContain("fetch");
		expect(stdout).toContain("Find passages matching a query");
		expect(stdout).toContain("Print a document's full content");
	});

	it("documents the search output format in --help (keeps the prompt's promise true)", async () => {
		const { exitCode, stdout } = await runHelp(["search", "--help"]);
		expect(exitCode).toBe(0);
		expect(stdout).toContain("QUERY");
		// The system prompt tells the agent to learn the output format from
		// --help, so the documented shape must actually appear here.
		expect(stdout).toContain("JSON object per line");
		expect(stdout).toContain("passageId");
		expect(stdout).toContain("documentId");
		expect(stdout).toContain("title");
		expect(stdout).toContain("snippet");
	});
});

describe("mymemo-docs search output (NDJSON)", () => {
	it("emits one parseable JSON object per hit and escapes newlines", async () => {
		searchResponse = {
			documents: [
				{
					passageId: "p1",
					documentId: "d1",
					title: "ML intro",
					snippet: "line one\nline two",
				},
				{
					passageId: "p2",
					documentId: "d2",
					title: "Neural\tnets",
					snippet: "s2",
				},
			],
		};
		const { exitCode, stdout } = await runSearch(["machine learning"]);
		searchResponse = { documents: [] };

		expect(exitCode).toBe(0);
		// A snippet/title containing \n or \t must NOT break the one-record-per-
		// line contract: exactly 2 non-empty lines, each valid JSON.
		const lines = stdout.split("\n").filter((l) => l.length > 0);
		expect(lines).toHaveLength(2);
		const first = JSON.parse(lines[0] as string) as {
			passageId?: string;
			documentId?: string;
		};
		expect(first.passageId).toBe("p1");
		expect(first.documentId).toBe("d1");
		expect((JSON.parse(lines[1] as string) as { title?: string }).title).toBe(
			"Neural\tnets",
		);
	});

	it("on zero results: empty stdout, exit 0, note on stderr", async () => {
		searchResponse = { documents: [] };
		const { exitCode, stdout, stderr } = await runSearch(["nothing matches"]);
		expect(exitCode).toBe(0);
		expect(stdout).toBe("");
		expect(stderr).toContain("(no documents found)");
	});

	it("tolerates a malformed upstream payload without crashing", async () => {
		// A null / non-array `documents` must be treated as zero results, not throw.
		searchResponse = { documents: null };
		const { exitCode, stdout } = await runSearch(["x"]);
		searchResponse = { documents: [] };
		expect(exitCode).toBe(0);
		expect(stdout).toBe("");
	});

	it("always emits passageId + documentId keys even if the hit omits them", async () => {
		searchResponse = { documents: [{ title: "no ids here" }] };
		const { exitCode, stdout } = await runSearch(["x"]);
		searchResponse = { documents: [] };
		expect(exitCode).toBe(0);
		const obj = JSON.parse(stdout.trim()) as Record<string, unknown>;
		expect(obj.passageId).toBe("");
		expect(obj.documentId).toBe("");
	});
});

describe("mymemo-docs search arg parsing", () => {
	it("preserves a quoted multi-word query", async () => {
		const { exitCode, sent } = await runSearch(["machine learning"]);
		expect(exitCode).toBe(0);
		expect(sent?.query).toBe("machine learning");
	});

	it("joins an unquoted multi-word query without dropping the first word", async () => {
		const { exitCode, sent } = await runSearch(["machine", "learning"]);
		expect(exitCode).toBe(0);
		expect(sent?.query).toBe("machine learning");
	});
});
