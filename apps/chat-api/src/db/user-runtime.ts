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
 * Both INSERT and UPDATE paths include all supplied fields.
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
	const insertCols = ["user_id"];
	const insertVals = ["$1"];
	const setClauses: string[] = ["last_seen_at = now()"];
	const values: unknown[] = [userId];
	let paramIndex = 2;

	const fieldMap: Array<[keyof typeof fields, string]> = [
		["sandbox_id", "sandbox_id"],
		["agent_session_id", "agent_session_id"],
		["synced_version", "synced_version"],
		["sandbox_status", "sandbox_status"],
		["daemon_version", "daemon_version"],
	];

	for (const [key, col] of fieldMap) {
		if (fields[key] !== undefined) {
			insertCols.push(col);
			insertVals.push(`$${paramIndex}`);
			setClauses.push(`${col} = $${paramIndex}`);
			values.push(fields[key]);
			paramIndex++;
		}
	}

	await query(
		`INSERT INTO user_sandbox_runtime (${insertCols.join(", ")})
		 VALUES (${insertVals.join(", ")})
		 ON CONFLICT (user_id) DO UPDATE
		 SET ${setClauses.join(", ")}`,
		values,
	);
}

/**
 * Get state_version and the agent session ID for a specific chat.
 * agent_session_id stores a JSON map of { chatKey: sessionId }.
 */
export async function getTurnContext(
	userId: string,
	chatKey: string,
): Promise<{ state_version: number; agent_session_id: string | null }> {
	const row = await queryOne<{
		state_version: number;
		agent_session_id: string | null;
	}>(
		`SELECT state_version::int, agent_session_id
		 FROM user_sandbox_runtime
		 WHERE user_id = $1`,
		[userId],
	);

	if (!row) {
		return { state_version: 0, agent_session_id: null };
	}

	// Parse chatKey-scoped session from JSON map
	let sessionId: string | null = null;
	if (row.agent_session_id) {
		try {
			const sessions = JSON.parse(row.agent_session_id);
			if (typeof sessions === "object" && sessions !== null) {
				sessionId =
					typeof sessions[chatKey] === "string"
						? sessions[chatKey]
						: null;
			}
		} catch {
			// Legacy single-value format or corrupt — ignore
		}
	}

	return { state_version: row.state_version, agent_session_id: sessionId };
}

/**
 * Persist an agent session ID scoped by chatKey.
 * Reads the existing JSON map, updates the entry, writes back.
 */
export async function upsertSessionId(
	userId: string,
	chatKey: string,
	sessionId: string,
): Promise<void> {
	// Read current sessions map
	const row = await queryOne<{ agent_session_id: string | null }>(
		`SELECT agent_session_id FROM user_sandbox_runtime WHERE user_id = $1`,
		[userId],
	);

	let sessions: Record<string, string> = {};
	if (row?.agent_session_id) {
		try {
			const parsed = JSON.parse(row.agent_session_id);
			if (typeof parsed === "object" && parsed !== null) {
				sessions = parsed;
			}
		} catch {
			// Legacy or corrupt — start fresh
		}
	}

	sessions[chatKey] = sessionId;

	await upsertRuntime(userId, {
		agent_session_id: JSON.stringify(sessions),
	});
}
