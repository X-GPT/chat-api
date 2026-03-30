/**
 * In-memory store for Claude Agent SDK session IDs.
 * Keys are scoped by userId to prevent cross-user session collisions.
 * Entries expire after 24 hours (matching E2B sandbox max lifetime).
 */
export class SessionStore {
	private static TTL_MS = 24 * 60 * 60 * 1000;
	private static MAX_ENTRIES = 10_000;

	private sessions = new Map<
		string,
		{ sessionId: string; userId: string; updatedAt: number }
	>();
	private keysByUser = new Map<string, Set<string>>();

	private static scopedKey(userId: string, chatKey: string): string {
		return `${userId}:${chatKey}`;
	}

	getSessionId(chatKey: string, userId: string): string | null {
		const key = SessionStore.scopedKey(userId, chatKey);
		const entry = this.sessions.get(key);
		if (!entry) return null;
		if (Date.now() - entry.updatedAt > SessionStore.TTL_MS) {
			this.sessions.delete(key);
			this.removeKeyFromUser(userId, key);
			return null;
		}
		return entry.sessionId;
	}

	setSessionId(chatKey: string, sessionId: string, userId: string): void {
		const key = SessionStore.scopedKey(userId, chatKey);
		if (this.sessions.size >= SessionStore.MAX_ENTRIES) {
			const oldest = this.sessions.entries().next();
			if (!oldest.done) {
				const [oldKey, oldEntry] = oldest.value;
				this.sessions.delete(oldKey);
				this.removeKeyFromUser(oldEntry.userId, oldKey);
			}
		}
		this.sessions.set(key, { sessionId, userId, updatedAt: Date.now() });
		let keys = this.keysByUser.get(userId);
		if (!keys) {
			keys = new Set();
			this.keysByUser.set(userId, keys);
		}
		keys.add(key);
	}

	private removeKeyFromUser(userId: string, key: string): void {
		const keys = this.keysByUser.get(userId);
		if (keys) {
			keys.delete(key);
			if (keys.size === 0) this.keysByUser.delete(userId);
		}
	}

	removeUserSessions(userId: string): void {
		const keys = this.keysByUser.get(userId);
		if (keys) {
			for (const key of keys) {
				this.sessions.delete(key);
			}
			this.keysByUser.delete(userId);
		}
	}
}
