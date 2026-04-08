import { query, queryOne } from "./client";

/**
 * Get the agent session ID for a specific chat conversation.
 */
export async function getSessionId(
	userId: string,
	chatKey: string,
): Promise<string | null> {
	const row = await queryOne<{ session_id: string }>(
		`SELECT session_id
		 FROM user_sandbox_sessions
		 WHERE user_id = $1 AND chat_key = $2`,
		[userId, chatKey],
	);
	return row?.session_id ?? null;
}

/**
 * Persist an agent session ID for a specific chat conversation.
 * Atomic upsert — no read-modify-write race.
 */
export async function upsertSessionId(
	userId: string,
	chatKey: string,
	sessionId: string,
): Promise<void> {
	await query(
		`INSERT INTO user_sandbox_sessions (user_id, chat_key, session_id)
		 VALUES ($1, $2, $3)
		 ON CONFLICT (user_id, chat_key) DO UPDATE
		 SET session_id = $3, updated_at = now()`,
		[userId, chatKey, sessionId],
	);
}

/**
 * Clear all sessions for a user.
 * Called when a sandbox is killed or recreated.
 */
export async function clearUserSessions(userId: string): Promise<void> {
	await query(
		`DELETE FROM user_sandbox_sessions WHERE user_id = $1`,
		[userId],
	);
}
