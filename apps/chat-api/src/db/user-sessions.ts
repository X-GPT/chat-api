import { userSandboxSessions } from "@mymemo/db";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "./client";

/**
 * Get the agent session ID for a specific chat conversation.
 */
export async function getSessionId(
	userId: string,
	chatKey: string,
): Promise<string | null> {
	const rows = await getDb()
		.select({ sessionId: userSandboxSessions.sessionId })
		.from(userSandboxSessions)
		.where(
			and(
				eq(userSandboxSessions.userId, userId),
				eq(userSandboxSessions.chatKey, chatKey),
			),
		);
	return rows[0]?.sessionId ?? null;
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
	await getDb()
		.insert(userSandboxSessions)
		.values({ userId, chatKey, sessionId })
		.onDuplicateKeyUpdate({
			set: { sessionId, updatedAt: sql`NOW()` },
		});
}

/**
 * Clear all sessions for a user.
 * Called when a sandbox is killed or recreated.
 */
export async function clearUserSessions(userId: string): Promise<void> {
	await getDb()
		.delete(userSandboxSessions)
		.where(eq(userSandboxSessions.userId, userId));
}
