import type { FetchOptions } from "@/features/chat/api/client";
import type { ManifestEntry } from "@/features/chat/api/manifest";
import type { FullSummary, ProtectedSummary } from "@/features/chat/api/types";
import type { CollectionSymlink, MaterializedFile, SyncLogger } from "@/features/sandbox";

export interface SyncOptions {
	memberCode: string;
	partnerCode: string;
	memberAuthToken: string;
}

export interface StoredSyncEntry {
	id: string;
	checksum: string;
	relativePath: string;
	type: number;
	collectionIds?: string[];
}

export interface InitialSyncPlan {
	docsRoot: string;
	primaryFiles: MaterializedFile[];
	collectionSymlinks: CollectionSymlink[];
	nextState: StoredSyncEntry[];
	isEmpty: boolean;
}

export interface IncrementalSyncPlan {
	docsRoot: string;
	writeFiles: MaterializedFile[];
	removeFiles: string[];
	removeCollectionLinksByFilename: string[];
	createCollectionLinks: CollectionSymlink[];
	nextState: StoredSyncEntry[];
	stats: {
		contentChanged: number;
		collectionChanged: number;
		deleted: number;
	};
}

export type SyncStatus = "idle" | "synced" | "error";

export interface SyncFetchers {
	fetchAllFullSummaries(
		memberCode: string,
		partnerCode: string,
		fetchOptions: FetchOptions,
		logger: SyncLogger,
	): Promise<FullSummary[]>;
	fetchSummariesManifest(
		memberCode: string,
		partnerCode: string,
		options: FetchOptions,
		logger: SyncLogger,
	): Promise<ManifestEntry[]>;
	fetchProtectedSummaries(
		ids: Array<string | number>,
		options: FetchOptions,
		logger: SyncLogger,
	): Promise<ProtectedSummary[]>;
}

export interface IncrementalSyncDiff {
	contentChangedIds: string[];
	collectionChangedIds: string[];
	allChangedIds: string[];
	deletedEntries: StoredSyncEntry[];
	manifestMap: Map<
		string,
		{ checksum: string; collectionIds: string[] | undefined; entry: ManifestEntry }
	>;
}
