import type { Sandbox } from "e2b";
import type { SyncLogger } from "@/features/sandbox";
import type { StoredSyncEntry } from "./sandbox-sync-types";

export const SYNC_COMPLETE_FILE = ".sync-complete";
export const SYNC_STATE_FILE = ".sync-state.json";
export const SYNC_ERROR_FILE = ".sync-error";

export async function readStoredSyncState(
	sandbox: Sandbox,
	docsRoot: string,
	logger?: SyncLogger,
): Promise<StoredSyncEntry[]> {
	let raw: string;
	try {
		raw = await sandbox.files.read(`${docsRoot}/${SYNC_STATE_FILE}`);
	} catch {
		return [];
	}
	try {
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		logger?.error({ msg: "Corrupt .sync-state.json, treating as empty", docsRoot });
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
