export type SyncStatus =
	| "synced"
	| "pending_create"
	| "pending_update"
	| "pending_delete"
	| "error";

export interface SyncStateRecord {
	userId: string;
	sandboxId: string;
	summaryId: string;
	type: number;
	/** Full sandbox-relative path, e.g. "docs/{userId}/{type}/{sanitizedId}.txt" */
	expectedPath: string;
	/** SHA-256 hex of the materialized file content (frontmatter + body) */
	contentChecksum: string;
	/** ISO 8601 from ProtectedSummary.updateTime */
	sourceUpdatedAt: string;
	lastSyncedAt: string | null;
	syncStatus: SyncStatus;
}

export type ReconciliationAction =
	| {
			kind: "create";
			record: SyncStateRecord;
			content: string;
	  }
	| {
			kind: "update";
			record: SyncStateRecord;
			content: string;
			reason: "content_changed" | "checksum_mismatch";
	  }
	| {
			kind: "delete";
			record: SyncStateRecord;
	  }
	| {
			kind: "noop";
			record: SyncStateRecord;
	  };

export interface ReconciliationPlan {
	creates: Extract<ReconciliationAction, { kind: "create" }>[];
	updates: Extract<ReconciliationAction, { kind: "update" }>[];
	deletes: Extract<ReconciliationAction, { kind: "delete" }>[];
	unchanged: number;
}

export interface ManifestDiff {
	/** Expected by sync-state but not found on sandbox disk */
	missingInSandbox: SyncStateRecord[];
	/** Found on sandbox disk but not in sync-state */
	orphanedInSandbox: string[];
	/** On disk but content checksum differs from sync-state */
	checksumMismatches: SyncStateRecord[];
}
