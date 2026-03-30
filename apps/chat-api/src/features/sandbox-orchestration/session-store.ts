/**
 * In-memory store for Claude Agent SDK session IDs.
 * Maps chatKey → sessionId to enable session resume across queries.
 * Entries expire after 24 hours (matching E2B sandbox max lifetime).
 */
export class SessionStore {
	private static TTL_MS = 24 * 60 * 60 * 1000;
	private static MAX_ENTRIES = 10_000;

	private sessions = new Map<
		string,
		{ sessionId: string; userId: string; updatedAt: number }
	>();
	private chatKeysByUser = new Map<string, Set<string>>();

	getSessionId(chatKey: string): string | null {
		const entry = this.sessions.get(chatKey);
		if (!entry) return null;
		if (Date.now() - entry.updatedAt > SessionStore.TTL_MS) {
			this.sessions.delete(chatKey);
			this.removeChatKeyFromUser(entry.userId, chatKey);
			return null;
		}
		return entry.sessionId;
	}

	setSessionId(chatKey: string, sessionId: string, userId: string): void {
		if (this.sessions.size >= SessionStore.MAX_ENTRIES) {
			const oldest = this.sessions.entries().next();
			if (!oldest.done) {
				const [oldKey, oldEntry] = oldest.value;
				this.sessions.delete(oldKey);
				this.removeChatKeyFromUser(oldEntry.userId, oldKey);
			}
		}
		this.sessions.set(chatKey, { sessionId, userId, updatedAt: Date.now() });
		let keys = this.chatKeysByUser.get(userId);
		if (!keys) {
			keys = new Set();
			this.chatKeysByUser.set(userId, keys);
		}
		keys.add(chatKey);
	}

	private removeChatKeyFromUser(userId: string, chatKey: string): void {
		const keys = this.chatKeysByUser.get(userId);
		if (keys) {
			keys.delete(chatKey);
			if (keys.size === 0) this.chatKeysByUser.delete(userId);
		}
	}

	removeUserSessions(userId: string): void {
		const keys = this.chatKeysByUser.get(userId);
		if (keys) {
			for (const chatKey of keys) {
				this.sessions.delete(chatKey);
			}
			this.chatKeysByUser.delete(userId);
		}
	}
}
