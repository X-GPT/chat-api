import { describe, expect, it } from "bun:test";
import { createHmac } from "node:crypto";
import { type LlmTokenClaims, mintLlmToken, verifyLlmToken } from "./index";

const SECRET = "test-secret";
const claims: Omit<LlmTokenClaims, "exp"> = {
	userId: "u1",
	sandboxId: "sbx-1",
	requestId: "req-1",
};

// Craft a token with a VALID signature over an arbitrary payload, to prove that
// a correct signature alone is not accepted without well-formed claims.
function signedToken(payload: unknown): string {
	const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
	const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
	return `${body}.${sig}`;
}

describe("llm-token", () => {
	it("round-trips a freshly minted token", () => {
		const token = mintLlmToken(claims, SECRET);
		const verified = verifyLlmToken(token, SECRET);
		expect(verified).toMatchObject(claims);
		expect(verified?.exp).toBeGreaterThan(Date.now());
	});

	it("rejects a token signed with a different secret", () => {
		const token = mintLlmToken(claims, SECRET);
		expect(verifyLlmToken(token, "other-secret")).toBeNull();
	});

	it("rejects a tampered payload", () => {
		const token = mintLlmToken(claims, SECRET);
		const [, sig] = token.split(".");
		const forged = `${Buffer.from(
			JSON.stringify({ ...claims, userId: "attacker", exp: Date.now() + 1000 }),
		).toString("base64url")}.${sig}`;
		expect(verifyLlmToken(forged, SECRET)).toBeNull();
	});

	it("rejects an expired token", () => {
		const token = mintLlmToken(claims, SECRET, -1);
		expect(verifyLlmToken(token, SECRET)).toBeNull();
	});

	it("rejects malformed tokens", () => {
		expect(verifyLlmToken("", SECRET)).toBeNull();
		expect(verifyLlmToken("nodot", SECRET)).toBeNull();
		expect(verifyLlmToken(".sig", SECRET)).toBeNull();
	});

	it("rejects a validly-signed payload that is not an object", () => {
		// `(12345).exp` is undefined → `undefined < Date.now()` is false, which
		// would "never expire" without the shape guard.
		expect(verifyLlmToken(signedToken(12345), SECRET)).toBeNull();
		expect(verifyLlmToken(signedToken("hello"), SECRET)).toBeNull();
		expect(verifyLlmToken(signedToken(null), SECRET)).toBeNull();
		expect(verifyLlmToken(signedToken([1, 2, 3]), SECRET)).toBeNull();
	});

	it("rejects a validly-signed object with a missing or non-numeric exp", () => {
		expect(
			verifyLlmToken(
				signedToken({ userId: "u", sandboxId: "s", requestId: "r" }),
				SECRET,
			),
		).toBeNull();
		expect(
			verifyLlmToken(
				signedToken({
					userId: "u",
					sandboxId: "s",
					requestId: "r",
					exp: "soon",
				}),
				SECRET,
			),
		).toBeNull();
	});

	it("rejects a validly-signed object missing claim fields", () => {
		expect(
			verifyLlmToken(signedToken({ exp: Date.now() + 1000 }), SECRET),
		).toBeNull();
	});

	it("rejects a validly-signed payload whose exp is non-finite (Infinity)", () => {
		// JSON.stringify(Infinity) === "null", so craft raw JSON: 1e999 → Infinity,
		// which `Infinity < Date.now()` would treat as never-expiring.
		const body = Buffer.from(
			'{"userId":"u","sandboxId":"s","requestId":"r","exp":1e999}',
		).toString("base64url");
		const sig = createHmac("sha256", SECRET).update(body).digest("base64url");
		expect(verifyLlmToken(`${body}.${sig}`, SECRET)).toBeNull();
	});
});
