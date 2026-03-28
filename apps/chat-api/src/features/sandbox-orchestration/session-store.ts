/**
 * In-memory store for Claude Agent SDK session IDs.
 * Maps chatKey → sessionId to enable session resume across queries.
 */
export class SessionStore {
	private sessions = new Map<string, string>();
	private chatKeysByUser = new Map<string, Set<string>>();

	getSessionId(chatKey: string): string | null {
		return this.sessions.get(chatKey) ?? null;
	}

	setSessionId(chatKey: string, sessionId: string, userId: string): void {
		this.sessions.set(chatKey, sessionId);
		let keys = this.chatKeysByUser.get(userId);
		if (!keys) {
			keys = new Set();
			this.chatKeysByUser.set(userId, keys);
		}
		keys.add(chatKey);
	}

	removeSession(chatKey: string): void {
		this.sessions.delete(chatKey);
		for (const keys of this.chatKeysByUser.values()) {
			keys.delete(chatKey);
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
