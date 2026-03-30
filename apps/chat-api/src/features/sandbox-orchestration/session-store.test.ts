import { beforeEach, describe, expect, it } from "bun:test";
import { SessionStore } from "./session-store";

describe("SessionStore", () => {
	let store: SessionStore;

	beforeEach(() => {
		store = new SessionStore();
	});

	it("returns null for unknown chatKey", () => {
		expect(store.getSessionId("unknown", "user-1")).toBeNull();
	});

	it("stores and retrieves a session ID", () => {
		store.setSessionId("chat-1", "session-abc", "user-1");
		expect(store.getSessionId("chat-1", "user-1")).toBe("session-abc");
	});

	it("overwrites session ID for the same chatKey and user", () => {
		store.setSessionId("chat-1", "session-1", "user-1");
		store.setSessionId("chat-1", "session-2", "user-1");
		expect(store.getSessionId("chat-1", "user-1")).toBe("session-2");
	});

	it("scopes sessions by userId — same chatKey, different users", () => {
		store.setSessionId("chat-1", "session-a", "user-1");
		store.setSessionId("chat-1", "session-b", "user-2");

		expect(store.getSessionId("chat-1", "user-1")).toBe("session-a");
		expect(store.getSessionId("chat-1", "user-2")).toBe("session-b");
	});

	it("returns null after TTL expires", () => {
		store.setSessionId("chat-1", "session-1", "user-1");

		// Manually expire the entry by reaching into internals
		const sessions = (store as any).sessions;
		const key = sessions.keys().next().value;
		const entry = sessions.get(key);
		entry.updatedAt = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago

		expect(store.getSessionId("chat-1", "user-1")).toBeNull();
	});

	it("cleans up reverse index on TTL expiry", () => {
		store.setSessionId("chat-1", "session-1", "user-1");

		const sessions = (store as any).sessions;
		const key = sessions.keys().next().value;
		sessions.get(key).updatedAt = Date.now() - 25 * 60 * 60 * 1000;

		store.getSessionId("chat-1", "user-1");

		const keysByUser = (store as any).keysByUser as Map<string, Set<string>>;
		expect(keysByUser.has("user-1")).toBe(false);
	});

	it("evicts oldest entry when MAX_ENTRIES is reached", () => {
		// Fill to capacity using a store with a small limit
		const smallStore = new SessionStore();
		const maxEntries = (SessionStore as any).MAX_ENTRIES as number;

		// Add two entries, then simulate being at capacity
		smallStore.setSessionId("chat-old", "session-old", "user-1");
		smallStore.setSessionId("chat-new", "session-new", "user-1");

		// Manually set size to MAX_ENTRIES to trigger eviction on next set
		const sessions = (smallStore as any).sessions as Map<string, unknown>;
		for (let i = sessions.size; i < maxEntries; i++) {
			sessions.set(`pad-${i}`, {
				sessionId: "pad",
				userId: "pad",
				updatedAt: Date.now(),
			});
		}

		smallStore.setSessionId("chat-trigger", "session-trigger", "user-2");

		// "chat-old" was the oldest insertion, should be evicted
		expect(smallStore.getSessionId("chat-old", "user-1")).toBeNull();
		expect(smallStore.getSessionId("chat-trigger", "user-2")).toBe(
			"session-trigger",
		);
	});

	it("removeUserSessions clears all sessions for a user", () => {
		store.setSessionId("chat-1", "session-1", "user-1");
		store.setSessionId("chat-2", "session-2", "user-1");
		store.setSessionId("chat-3", "session-3", "user-2");

		store.removeUserSessions("user-1");

		expect(store.getSessionId("chat-1", "user-1")).toBeNull();
		expect(store.getSessionId("chat-2", "user-1")).toBeNull();
		expect(store.getSessionId("chat-3", "user-2")).toBe("session-3");
	});

	it("removeUserSessions is safe to call for unknown user", () => {
		store.removeUserSessions("nonexistent");
		// No throw
	});
});
