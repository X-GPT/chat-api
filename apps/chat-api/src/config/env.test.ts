import { describe, expect, it } from "bun:test";
import { getProtectedManifestEndpoint } from "./env";

describe("getProtectedManifestEndpoint", () => {
	it("builds correct URL with memberCode and partnerCode", () => {
		const url = getProtectedManifestEndpoint("member-123", "partner-456");
		const parsed = new URL(url);
		expect(parsed.pathname).toContain(
			"/protected/members/member-123/summaries/manifest",
		);
		expect(parsed.searchParams.get("partnerCode")).toBe("partner-456");
	});

	it("encodes memberCode with special characters", () => {
		const url = getProtectedManifestEndpoint("user@foo/bar", "partner");
		const parsed = new URL(url);
		expect(parsed.pathname).toContain(
			`/protected/members/${encodeURIComponent("user@foo/bar")}/summaries/manifest`,
		);
	});

	it("omits partnerCode query param when empty string", () => {
		const url = getProtectedManifestEndpoint("member-1", "");
		const parsed = new URL(url);
		expect(parsed.searchParams.has("partnerCode")).toBe(false);
	});

	it("omits partnerCode query param when whitespace only", () => {
		const url = getProtectedManifestEndpoint("member-1", "   ");
		const parsed = new URL(url);
		expect(parsed.searchParams.has("partnerCode")).toBe(false);
	});
});
