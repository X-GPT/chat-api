import { verifyLlmToken } from "@mymemo/llm-token";
import { type Context, Hono } from "hono";
import { gwEnv } from "./env";

/**
 * LLM gateway — the control plane for sandboxed agents.
 *
 * Sandboxed agents point the Claude binary at this service via ANTHROPIC_BASE_URL
 * and authenticate with a short-lived ANTHROPIC_AUTH_TOKEN (Bearer). The agent
 * holds no provider key: we validate the token, inject the real `x-api-key`, and
 * stream the upstream response straight back.
 *
 * Scope is intentionally narrow: only the Anthropic Messages endpoints are
 * proxied, and only an allowlist of request headers is forwarded. A leaked token
 * therefore cannot reach files/batches/admin endpoints with the org key, and no
 * arbitrary client headers (cookies, x-forwarded-*, accept-encoding) leak
 * upstream.
 */

// Paths the gateway will proxy (after slash-normalization). Everything else 404s
// even with a valid token.
const ALLOWED_PATHS = new Set(["/v1/messages", "/v1/messages/count_tokens"]);

// The only request headers forwarded upstream. Authorization is replaced by
// x-api-key; everything else (host, content-length, accept-encoding, cookie, …)
// is dropped so fetch controls compression and nothing leaks to Anthropic.
const FORWARD_REQUEST_HEADERS = [
	"anthropic-version",
	"anthropic-beta",
	"content-type",
	"accept",
	"x-claude-code-session-id",
];

// Response headers fetch already decoded for us; forwarding them would mislead
// the client into decompressing again or mismatching the streamed length.
const RESPONSE_DROP_HEADERS = new Set([
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
]);

export const app = new Hono();

// GET and HEAD so load-balancer / k8s probes (which often use HEAD) don't fall
// through to the token-gated proxy and 401.
app.on(["GET", "HEAD"], "/health", (c) => c.json({ status: "ok" }));

// Token-gated proxy for the messages endpoints. Catch-all so a trailing-slash
// base URL (`…//v1/messages`) still routes here and gets normalized below.
app.all("*", proxyToAnthropic);

function bearerToken(c: Context): string {
	const auth = c.req.header("authorization")?.trim() ?? "";
	const match = /^Bearer\s+(.+)$/i.exec(auth);
	return match?.[1] ?? "";
}

async function proxyToAnthropic(c: Context) {
	const claims = verifyLlmToken(bearerToken(c), gwEnv.LLM_TOKEN_SECRET);
	if (!claims) {
		return c.json(
			{
				type: "error",
				error: {
					type: "authentication_error",
					message: "invalid or expired session token",
				},
			},
			401,
		);
	}

	// Normalize the path before the scope check / forwarding: collapse duplicate
	// slashes (a trailing-slash base URL yields `//v1/messages`) and drop a single
	// trailing slash (`/v1/messages/` → `/v1/messages`) so exact-match still holds.
	const url = new URL(c.req.url);
	let path = url.pathname.replace(/\/{2,}/g, "/");
	if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
	if (!ALLOWED_PATHS.has(path)) {
		return c.json(
			{
				type: "error",
				error: {
					type: "not_found_error",
					message: `unsupported path: ${path}`,
				},
			},
			404,
		);
	}

	// Cost-cap / metering hook: claims.userId identifies the end user, and
	// x-claude-code-session-id aggregates a session without parsing the body.

	const headers = new Headers();
	for (const name of FORWARD_REQUEST_HEADERS) {
		const value = c.req.header(name);
		if (value) headers.set(name, value);
	}
	headers.set("x-api-key", gwEnv.ANTHROPIC_API_KEY);

	const target = `${gwEnv.UPSTREAM_BASE_URL}${path}${url.search}`;
	const method = c.req.method;
	const hasBody = method !== "GET" && method !== "HEAD";
	const init: RequestInit & { duplex?: "half" } = { method, headers };
	if (hasBody) {
		init.body = c.req.raw.body;
		// `duplex` is required to stream a request body in undici/Bun but is
		// missing from the RequestInit lib type.
		init.duplex = "half";
	}

	let upstream: Response;
	try {
		upstream = await fetch(target, init);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return c.json(
			{
				type: "error",
				error: {
					type: "api_error",
					message: `upstream request failed: ${message}`,
				},
			},
			502,
		);
	}

	const responseHeaders = new Headers();
	upstream.headers.forEach((value, name) => {
		if (!RESPONSE_DROP_HEADERS.has(name.toLowerCase())) {
			responseHeaders.set(name, value);
		}
	});

	return new Response(upstream.body, {
		status: upstream.status,
		headers: responseHeaders,
	});
}

export default {
	port: gwEnv.GATEWAY_PORT,
	fetch: app.fetch,
};
