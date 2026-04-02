import type { Sandbox } from "e2b";
import type { StoredSyncEntry } from "./sandbox-sync-types";

export const SYNC_COMPLETE_FILE = ".sync-complete";
export const SYNC_STATE_FILE = ".sync-state.json";
export const SYNC_ERROR_FILE = ".sync-error";

const syncCompleteCache = new Map<string, string>();
const initialSyncLocks = new Map<string, Promise<void>>();

export async function readStoredSyncState(
	sandbox: Sandbox,
	docsRoot: string,
): Promise<StoredSyncEntry[]> {
	try {
		const raw = await sandbox.files.read(`${docsRoot}/${SYNC_STATE_FILE}`);
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export async function writeStoredSyncState(
	sandbox: Sandbox,
	docsRoot: string,
	state: StoredSyncEntry[],
): Promise<void> {
	await sandbox.files.write(`${docsRoot}/${SYNC_STATE_FILE}`, JSON.stringify(state));
}

export async function isInitialSyncComplete(
	sandbox: Sandbox,
	docsRoot: string,
): Promise<boolean> {
	try {
		await sandbox.files.read(`${docsRoot}/${SYNC_COMPLETE_FILE}`);
		return true;
	} catch {
		return false;
	}
}

export async function writeSyncCompleteMarker(
	sandbox: Sandbox,
	docsRoot: string,
): Promise<void> {
	await sandbox.files.write(
		`${docsRoot}/${SYNC_COMPLETE_FILE}`,
		new Date().toISOString(),
	);
}

export async function readSyncErrorMessage(
	sandbox: Sandbox,
	docsRoot: string,
): Promise<string | null> {
	try {
		const content = await sandbox.files.read(`${docsRoot}/${SYNC_ERROR_FILE}`);
		return content || null;
	} catch {
		return null;
	}
}

export async function writeSyncErrorMessage(
	sandbox: Sandbox,
	docsRoot: string,
	message: string,
): Promise<void> {
	try {
		await sandbox.commands.run(`mkdir -p ${JSON.stringify(docsRoot)}`, {
			timeoutMs: 5_000,
		});
		await sandbox.files.write(`${docsRoot}/${SYNC_ERROR_FILE}`, message);
	} catch {
		// Best-effort.
	}
}

export async function clearSyncErrorMessage(
	sandbox: Sandbox,
	docsRoot: string,
): Promise<void> {
	try {
		await sandbox.commands.run(
			`rm -f ${JSON.stringify(`${docsRoot}/${SYNC_ERROR_FILE}`)}`,
			{ timeoutMs: 5_000 },
		);
	} catch {
		// Best-effort.
	}
}

export function isInitialSyncInFlight(userId: string): boolean {
	return initialSyncLocks.has(userId);
}

export function trackInitialSync(userId: string, promise: Promise<void>): void {
	initialSyncLocks.set(
		userId,
		promise.finally(() => {
			initialSyncLocks.delete(userId);
		}),
	);
}

export function rememberCompletedSync(userId: string, sandboxId: string): void {
	syncCompleteCache.set(userId, sandboxId);
}

export function hasCompletedSyncCache(
	userId: string,
	sandboxId: string,
): boolean {
	return syncCompleteCache.get(userId) === sandboxId;
}

export async function hasCompletedSync(
	userId: string,
	sandbox: Sandbox,
	docsRoot: string,
): Promise<boolean> {
	if (hasCompletedSyncCache(userId, sandbox.sandboxId)) {
		return true;
	}

	const complete = await isInitialSyncComplete(sandbox, docsRoot);
	if (complete) {
		rememberCompletedSync(userId, sandbox.sandboxId);
	}
	return complete;
}

export function _resetSyncState(): void {
	syncCompleteCache.clear();
	initialSyncLocks.clear();
}
