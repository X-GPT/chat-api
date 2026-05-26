import { verifyLlmToken } from "@mymemo/llm-token";
import { type Context, Hono } from "hono";
import { gwEnv } from "./env";

/**
 * LLM gateway — the control plane for sandboxed agents.
 *
 * Sandboxed agents point the Claude binary at this service via ANTHROPIC_BASE_URL
 * and authenticate with a short-lived ANTHROPIC_AUTH_TOKEN (Bearer). The agent
 * therefore holds no provider key: we validate the token, inject the real
 * `x-api-key`, and stream the upstream response straight back.
 *
 * The gateway is a transparent, token-gated reverse proxy: it forwards whatever
 * path/method/headers the client sends (so SDK features and any Anthropic
 * endpoint keep working) and only rewrites auth. Everything except /health is
 * proxied.
 */

// Client request headers we must NOT forward upstream: authorization is replaced
// by x-api-key; host/content-length/connection are recomputed by fetch (the body
// is re-streamed with chunked encoding).
const REQUEST_DROP_HEADERS = new Set([
	"authorization",
	"host",
	"content-length",
	"connection",
]);

// Response headers fetch already decoded for us; forwarding them would mislead
// the client into decompressing again or mismatching the streamed length.
const RESPONSE_DROP_HEADERS = new Set([
	"content-encoding",
	"content-length",
	"transfer-encoding",
	"connection",
]);

export const app = new Hono();

app.get("/health", (c) => c.json({ status: "ok" }));

// Token-gated transparent proxy for everything else.
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

	// Cost-cap / metering hook: claims.userId identifies the end user, and
	// X-Claude-Code-Session-Id aggregates a session without parsing the body.

	const headers = new Headers();
	c.req.raw.headers.forEach((value, name) => {
		if (!REQUEST_DROP_HEADERS.has(name.toLowerCase())) headers.set(name, value);
	});
	headers.set("x-api-key", gwEnv.ANTHROPIC_API_KEY);

	const url = new URL(c.req.url);
	// Collapse duplicate slashes (a trailing-slash base URL yields `//v1/messages`)
	// and preserve the query string.
	const path = url.pathname.replace(/\/{2,}/g, "/");
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
