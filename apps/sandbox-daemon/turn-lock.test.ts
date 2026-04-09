import { describe, expect, it } from "bun:test";
import { acquireTurn, getCurrentTurn } from "./turn-lock";

describe("turn-lock", () => {
	it("reports current state", () => {
		const state = getCurrentTurn();
		expect(state).toHaveProperty("busy");
		expect(state).toHaveProperty("turnId");
	});

	it("acquires and releases a turn", () => {
		const lock = acquireTurn("turn-1");
		expect(lock).not.toBeNull();

		const state = getCurrentTurn();
		expect(state.busy).toBe(true);
		expect(state.turnId).toBe("turn-1");

		lock?.release();

		const after = getCurrentTurn();
		expect(after.busy).toBe(false);
		expect(after.turnId).toBeNull();
	});

	it("rejects concurrent turn", () => {
		const lock1 = acquireTurn("turn-a");
		expect(lock1).not.toBeNull();

		const lock2 = acquireTurn("turn-b");
		expect(lock2).toBeNull();

		lock1?.release();

		// Now a new turn can be acquired
		const lock3 = acquireTurn("turn-c");
		expect(lock3).not.toBeNull();
		lock3?.release();
	});

	it("release is idempotent", () => {
		const lock = acquireTurn("turn-x");
		expect(lock).not.toBeNull();

		lock?.release();
		lock?.release(); // second release should be safe

		expect(getCurrentTurn().busy).toBe(false);
	});

	it("release only releases matching turn", () => {
		const lock1 = acquireTurn("turn-1");
		expect(lock1).not.toBeNull();
		lock1?.release();

		const lock2 = acquireTurn("turn-2");
		expect(lock2).not.toBeNull();

		// Releasing lock1 again should NOT release lock2
		lock1?.release();
		expect(getCurrentTurn().busy).toBe(true);
		expect(getCurrentTurn().turnId).toBe("turn-2");

		lock2?.release();
	});
});
