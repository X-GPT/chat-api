#!/usr/bin/env bun
/**
 * Smoke test for the LLM-gateway credential path — no E2B, no sandbox required.
 *
 * Boots apps/llm-gateway locally and verifies the legs that no unit test covers,
 * against the REAL Anthropic API:
 *
 *   Layer A — gateway ⇄ Anthropic
 *     • a valid minted token → /v1/messages streams a real completion
 *     • garbage / expired / missing token → 401 (auth actually gates)
 *
 *   Layer B — claude binary → gateway   (the contract #106 is about)
 *     • the real `claude` binary, pointed at the gateway via ANTHROPIC_BASE_URL
 *       + ANTHROPIC_AUTH_TOKEN, completes a prompt — proving it sends the token
 *       as `Authorization: Bearer`. Skipped if `claude` isn't on PATH.
 *
 * Usage (from apps/chat-api):
 *   ANTHROPIC_API_KEY=sk-ant-… bun run scripts/smoke-gateway.ts
 *   ANTHROPIC_API_KEY=sk-ant-… bun run scripts/smoke-gateway.ts --port 8099 --model claude-sonnet-4-6 --no-binary
 *
 * Makes a few small, real (paid) Anthropic calls. Exits non-zero on any failure.
 */

import { mintLlmToken } from "@mymemo/llm-token";

const flags = new Set(Bun.argv.slice(2));
function argValue(flag: string, fallback: string): string {
	const i = Bun.argv.indexOf(flag);
	const v = i !== -1 ? Bun.argv[i + 1] : undefined;
	return v ?? fallback;
}

const PORT = Number(argValue("--port", "8099"));
const MODEL = argValue("--model", "claude-sonnet-4-6");
const RUN_BINARY = !flags.has("--no-binary");
const SECRET = Bun.env.LLM_TOKEN_SECRET || `smoke-${crypto.randomUUID()}`;
const BASE = `http://localhost:${PORT}`;
const GATEWAY_ENTRY = `${import.meta.dir}/../../llm-gateway/src/index.ts`;

const apiKey = Bun.env.ANTHROPIC_API_KEY;
if (!apiKey) {
	console.error(
		"✗ ANTHROPIC_API_KEY is required — a real key; this script makes live calls.",
	);
	process.exit(2);
}

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
	console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
	if (!ok) failures++;
}

function mint(ttlMs?: number): string {
	return mintLlmToken(
		{ userId: "smoke", sandboxId: "smoke-sbx", requestId: crypto.randomUUID() },
		SECRET,
		ttlMs,
	);
}

async function waitForHealth(timeoutMs = 10_000): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		try {
			const r = await fetch(`${BASE}/health`, {
				signal: AbortSignal.timeout(1000),
			});
			if (r.ok) return true;
		} catch {
			// not up yet
		}
		await Bun.sleep(150);
	}
	return false;
}

function postMessages(token: string): Promise<Response> {
	return fetch(`${BASE}/v1/messages`, {
		method: "POST",
		headers: {
			authorization: `Bearer ${token}`,
			"anthropic-version": "2023-06-01",
			"content-type": "application/json",
		},
		body: JSON.stringify({
			model: MODEL,
			max_tokens: 16,
			stream: true,
			messages: [{ role: "user", content: "Reply with the single word: pong" }],
		}),
	});
}

/** Drain an Anthropic SSE stream and concatenate the text deltas. */
async function readSseText(res: Response): Promise<string> {
	if (!res.body) return "";
	const reader = res.body.getReader();
	const decoder = new TextDecoder();
	let buf = "";
	let text = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		buf += decoder.decode(value, { stream: true });
		let nl = buf.indexOf("\n");
		while (nl !== -1) {
			const line = buf.slice(0, nl).trim();
			buf = buf.slice(nl + 1);
			if (line.startsWith("data:")) {
				try {
					const evt = JSON.parse(line.slice(5).trim());
					if (evt?.delta?.text) text += evt.delta.text;
				} catch {
					// non-JSON keepalive/comment line
				}
			}
			nl = buf.indexOf("\n");
		}
	}
	return text;
}

// ── boot the gateway as a subprocess (its real deployable entrypoint) ──
const gateway = Bun.spawn(["bun", "run", GATEWAY_ENTRY], {
	env: {
		...process.env,
		ANTHROPIC_API_KEY: apiKey,
		LLM_TOKEN_SECRET: SECRET,
		GATEWAY_PORT: String(PORT),
	},
	stdout: "pipe",
	stderr: "pipe",
});

let gwLog = "";
async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		gwLog += decoder.decode(value, { stream: true });
	}
}
drain(gateway.stdout);
drain(gateway.stderr);

async function run(): Promise<number> {
	console.log(`\n▶ booting llm-gateway on :${PORT} …`);
	if (!(await waitForHealth())) {
		console.error(
			`✗ gateway did not become healthy.\n--- gateway logs ---\n${gwLog}`,
		);
		return 1;
	}
	console.log("  ✓ /health ok");

	console.log("\nLayer A — gateway ⇄ Anthropic");
	const good = await postMessages(mint());
	const text = good.ok ? await readSseText(good) : "";
	check(
		"valid token streams a completion",
		good.ok && text.trim().length > 0,
		good.ok ? `"${text.trim().slice(0, 40)}"` : `status ${good.status}`,
	);

	const bad = await postMessages("not-a-real-token");
	check("garbage token → 401", bad.status === 401, `status ${bad.status}`);
	await bad.body?.cancel();

	const expired = await postMessages(mint(-1));
	check(
		"expired token → 401",
		expired.status === 401,
		`status ${expired.status}`,
	);
	await expired.body?.cancel();

	const noauth = await fetch(`${BASE}/v1/messages`, {
		method: "POST",
		body: "{}",
	});
	check(
		"missing token → 401",
		noauth.status === 401,
		`status ${noauth.status}`,
	);
	await noauth.body?.cancel();

	console.log("\nLayer B — claude binary → gateway (Authorization: Bearer)");
	const claudeBin = Bun.env.CLAUDE_CODE_PATH || Bun.which("claude");
	if (!RUN_BINARY) {
		console.log("  · skipped (--no-binary)");
	} else if (!claudeBin) {
		console.log(
			"  · skipped (claude not on PATH; set CLAUDE_CODE_PATH to run)",
		);
	} else {
		const proc = Bun.spawn(
			[claudeBin, "-p", "Reply with the single word: pong"],
			{
				// Scrubbed env: mirror the production agent, which holds NO provider
				// key — only the gateway base URL + bearer token. Spreading
				// process.env here would leak ANTHROPIC_API_KEY and let the binary
				// bypass the gateway, invalidating the contract this leg proves.
				env: {
					PATH: process.env.PATH ?? "",
					HOME: process.env.HOME ?? "",
					ANTHROPIC_BASE_URL: BASE,
					ANTHROPIC_AUTH_TOKEN: mint(),
				},
				stdout: "pipe",
				stderr: "pipe",
			},
		);
		const out = (await new Response(proc.stdout).text()).trim();
		const err = (await new Response(proc.stderr).text()).trim();
		const code = await proc.exited;
		check(
			"claude completes a prompt through the gateway",
			code === 0 && out.length > 0,
			code === 0
				? `"${out.slice(0, 40)}"`
				: `exit ${code}${err ? `: ${err.slice(0, 140)}` : ""}`,
		);
	}

	return failures;
}

let exitCode = 1;
try {
	exitCode = await run();
} catch (err) {
	console.error("✗ smoke errored:", err instanceof Error ? err.message : err);
	exitCode = 1;
} finally {
	gateway.kill();
}

console.log(
	`\n${exitCode === 0 ? "✓ smoke passed" : `✗ smoke failed (${failures} check${failures === 1 ? "" : "s"})`}`,
);
process.exit(exitCode === 0 ? 0 : 1);
