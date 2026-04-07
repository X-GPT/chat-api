import { query, queryOne } from "./client";

export interface UserSandboxRuntime {
	user_id: string;
	sandbox_id: string | null;
	agent_session_id: string | null;
	state_version: number;
	synced_version: number;
	sandbox_status: string;
	daemon_version: string | null;
	last_seen_at: string;
}

/**
 * Get the sandbox runtime state for a user.
 */
export async function getRuntime(
	userId: string,
): Promise<UserSandboxRuntime | null> {
	return queryOne<UserSandboxRuntime>(
		`SELECT user_id, sandbox_id, agent_session_id,
		        state_version::int, synced_version::int,
		        sandbox_status, daemon_version, last_seen_at::text
		 FROM user_sandbox_runtime
		 WHERE user_id = $1`,
		[userId],
	);
}

/**
 * Upsert sandbox runtime fields for a user.
 * Only provided fields are updated; null/undefined fields are left unchanged.
 */
export async function upsertRuntime(
	userId: string,
	fields: Partial<
		Pick<
			UserSandboxRuntime,
			| "sandbox_id"
			| "agent_session_id"
			| "synced_version"
			| "sandbox_status"
			| "daemon_version"
		>
	>,
): Promise<void> {
	const setClauses: string[] = ["last_seen_at = now()"];
	const values: unknown[] = [userId];
	let paramIndex = 2;

	if (fields.sandbox_id !== undefined) {
		setClauses.push(`sandbox_id = $${paramIndex++}`);
		values.push(fields.sandbox_id);
	}
	if (fields.agent_session_id !== undefined) {
		setClauses.push(`agent_session_id = $${paramIndex++}`);
		values.push(fields.agent_session_id);
	}
	if (fields.synced_version !== undefined) {
		setClauses.push(`synced_version = $${paramIndex++}`);
		values.push(fields.synced_version);
	}
	if (fields.sandbox_status !== undefined) {
		setClauses.push(`sandbox_status = $${paramIndex++}`);
		values.push(fields.sandbox_status);
	}
	if (fields.daemon_version !== undefined) {
		setClauses.push(`daemon_version = $${paramIndex++}`);
		values.push(fields.daemon_version);
	}

	await query(
		`INSERT INTO user_sandbox_runtime (user_id)
		 VALUES ($1)
		 ON CONFLICT (user_id) DO UPDATE
		 SET ${setClauses.join(", ")}`,
		values,
	);
}

/**
 * Get state_version and agent_session_id for a user (lightweight query for turn setup).
 */
export async function getTurnContext(
	userId: string,
): Promise<{ state_version: number; agent_session_id: string | null } | null> {
	return queryOne<{ state_version: number; agent_session_id: string | null }>(
		`SELECT state_version::int, agent_session_id
		 FROM user_sandbox_runtime
		 WHERE user_id = $1`,
		[userId],
	);
}
