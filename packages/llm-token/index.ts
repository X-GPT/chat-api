/**
 * Stateless session token for the LLM control plane.
 *
 * chat-api mints a short-lived token per turn; llm-gateway verifies it before
 * proxying to Anthropic with the real key. The token is a signed, self-describing
 * blob — no database lookup — so the gateway can stay stateless and horizontally
 * scalable. The signing secret is passed in by the caller (read from each app's
 * env) so this package has no dependency on a particular env shape.
 *
 * Wire format: `<base64url(payload)>.<base64url(hmac-sha256)>`.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface LlmTokenClaims {
	userId: string;
	sandboxId: string;
	requestId: string;
	/** Expiry as ms since epoch. */
	exp: number;
}

const DEFAULT_TTL_MS = 10 * 60_000;

function sign(body: string, secret: string): string {
	return createHmac("sha256", secret).update(body).digest("base64url");
}

function isLlmTokenClaims(value: unknown): value is LlmTokenClaims {
	if (typeof value !== "object" || value === null) return false;
	const c = value as Record<string, unknown>;
	return (
		typeof c.userId === "string" &&
		typeof c.sandboxId === "string" &&
		typeof c.requestId === "string" &&
		typeof c.exp === "number"
	);
}

export function mintLlmToken(
	claims: Omit<LlmTokenClaims, "exp">,
	secret: string,
	ttlMs: number = DEFAULT_TTL_MS,
): string {
	const payload: LlmTokenClaims = { ...claims, exp: Date.now() + ttlMs };
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	return `${body}.${sign(body, secret)}`;
}

export function verifyLlmToken(
	token: string,
	secret: string,
): LlmTokenClaims | null {
	const dot = token.indexOf(".");
	if (dot < 1) return null;

	const body = token.slice(0, dot);
	const presented = Buffer.from(token.slice(dot + 1));
	const expected = Buffer.from(sign(body, secret));
	if (
		presented.length !== expected.length ||
		!timingSafeEqual(presented, expected)
	) {
		return null;
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.from(body, "base64url").toString());
	} catch {
		return null;
	}
	// A valid signature only proves the secret-holder produced the payload; it
	// does not guarantee shape. Reject anything that isn't well-formed claims so
	// callers never see a non-object or a missing/non-numeric exp (which would
	// make `exp < Date.now()` falsy and silently "never expire").
	if (!isLlmTokenClaims(parsed)) return null;
	return parsed.exp < Date.now() ? null : parsed;
}
