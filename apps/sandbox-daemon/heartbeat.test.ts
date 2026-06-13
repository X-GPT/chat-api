import { describe, expect, it } from "bun:test";
import { createHeartbeatController } from "./heartbeat";

const NEVER = 1_000_000; // interval long enough to never fire mid-test

describe("createHeartbeatController", () => {
	it("does not beat until a tool starts", () => {
		let beats = 0;
		createHeartbeatController(() => beats++, NEVER);
		expect(beats).toBe(0);
	});

	it("beats immediately on the first in-flight tool", () => {
		let beats = 0;
		const hb = createHeartbeatController(() => beats++, NEVER);
		hb.onToolStart("a");
		// Immediate beat so a tool that runs long from t=0 re-arms the watchdog.
		expect(beats).toBe(1);
		hb.stop();
	});

	it("keeps beating until the LAST parallel tool ends", () => {
		let beats = 0;
		const hb = createHeartbeatController(() => beats++, NEVER);
		hb.onToolStart("a"); // immediate beat (1)
		hb.onToolStart("b"); // already beating — no extra immediate beat
		expect(beats).toBe(1);
		hb.onToolEnd("a"); // b still in flight — interval stays armed
		const stillArmed = beats;
		hb.onToolStart("c"); // already beating — still no extra immediate beat
		expect(beats).toBe(stillArmed);
		hb.onToolEnd("b");
		hb.onToolEnd("c"); // last one out
		hb.stop();
	});

	it("runs the interval while in flight and clears it on the last end", async () => {
		let beats = 0;
		const hb = createHeartbeatController(() => beats++, 20);
		hb.onToolStart("a");
		await new Promise((r) => setTimeout(r, 90));
		expect(beats).toBeGreaterThanOrEqual(2); // immediate + interval ticks
		hb.onToolEnd("a");
		const afterEnd = beats;
		await new Promise((r) => setTimeout(r, 60));
		// Interval must be cleared — no beats after the tool finished.
		expect(beats).toBe(afterEnd);
	});

	it("stop() halts an in-flight heartbeat", async () => {
		let beats = 0;
		const hb = createHeartbeatController(() => beats++, 20);
		hb.onToolStart("a");
		await new Promise((r) => setTimeout(r, 50));
		hb.stop();
		const afterStop = beats;
		await new Promise((r) => setTimeout(r, 60));
		expect(beats).toBe(afterStop);
	});

	it("an unmatched onToolEnd is a no-op", () => {
		let beats = 0;
		const hb = createHeartbeatController(() => beats++, NEVER);
		expect(() => hb.onToolEnd("never-started")).not.toThrow();
		expect(beats).toBe(0);
	});
});
