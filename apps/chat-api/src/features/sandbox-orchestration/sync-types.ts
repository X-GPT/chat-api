/**
 * Trimmed projection of ProtectedSummary — only fields needed for materialization.
 * Used by the internal sync endpoint and the sandbox-side sync runner.
 */
export interface SyncDocument {
	summaryId: string;
	type: number;
	title: string | null;
	content: string | null;
	parseContent: string | null;
	fileType: string | null;
	collections: string[];
	/** Pre-computed content checksum (stored in DB) */
	checksum: string;
}

export interface SyncDocumentsResponse {
	documents: SyncDocument[];
	nextCursor: number | null;
	total: number;
}

export type SyncStatus =
	| {
			status: "ready";
			documentCount: number;
			created: number;
			updated: number;
			deleted: number;
			unchanged: number;
			timestamp: string;
	  }
	| { status: "syncing"; pid: number; timestamp: string }
	| { status: "error"; message: string; timestamp: string };
