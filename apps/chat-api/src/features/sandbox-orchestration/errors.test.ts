import { describe, expect, it } from "bun:test";
import { SandboxCreationError } from "./errors";

describe("SandboxCreationError", () => {
	it("has correct name", () => {
		const error = new SandboxCreationError("sandbox failed");
		expect(error.name).toBe("SandboxCreationError");
		expect(error.message).toBe("sandbox failed");
		expect(error).toBeInstanceOf(Error);
	});
});
