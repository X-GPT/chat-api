import type { FullSummary, ProtectedSummary } from "@/features/chat/api/types";
import type { ManifestEntry } from "@/features/chat/api/manifest";
import {
	getDocsRoot,
	type MaterializationConfig,
	materializeSummaries,
	materializeSummary,
	resolveCollectionSymlinks,
} from "@/features/sandbox";
import { WORKSPACE_ROOT } from "./sandbox-manager";
import type {
	IncrementalSyncDiff,
	IncrementalSyncPlan,
	InitialSyncPlan,
	StoredSyncEntry,
} from "./sandbox-sync-types";

function isDeleted(summary: { delFlag?: number | string | null }): boolean {
	return summary.delFlag === 1 || summary.delFlag === "1";
}

function normalizeCollectionIds(collectionIds?: string[]): string[] {
	return collectionIds ?? [];
}

function buildCollectionMapFromManifest(
	manifest: ManifestEntry[],
): Map<string, string[]> {
	const collectionMap = new Map<string, string[]>();
	for (const entry of manifest) {
		if (entry.collectionIds && entry.collectionIds.length > 0) {
			collectionMap.set(entry.id, entry.collectionIds);
		}
	}
	return collectionMap;
}

export function diffIncrementalSync(
	manifest: ManifestEntry[],
	storedState: StoredSyncEntry[],
): IncrementalSyncDiff {
	const storedMap = new Map(
		storedState.map((entry) => [
			entry.id,
			{ checksum: entry.checksum, type: entry.type, collectionIds: normalizeCollectionIds(entry.collectionIds) },
		]),
	);
	const manifestMap = new Map(
		manifest.map((entry) => [
			entry.id,
			{
				checksum: entry.checksum,
				collectionIds: entry.collectionIds,
				entry,
			},
		]),
	);

	const contentChangedIds = manifest
		.filter((entry) => {
			const stored = storedMap.get(entry.id);
			if (!stored) return true;
			return stored.checksum !== entry.checksum || stored.type !== entry.type;
		})
		.map((entry) => entry.id);

	const deletedEntries = storedState.filter((entry) => !manifestMap.has(entry.id));

	const collectionChangedIds = manifest
		.filter((entry) => {
			const stored = storedMap.get(entry.id);
			if (!stored) return false;
			if (stored.checksum !== entry.checksum) return false;
			if (stored.type !== entry.type) return false;
			const storedCols = [...stored.collectionIds].sort().join(",");
			const manifestCols = [...normalizeCollectionIds(entry.collectionIds)].sort().join(",");
			return storedCols !== manifestCols;
		})
		.map((entry) => entry.id);

	return {
		contentChangedIds,
		collectionChangedIds,
		allChangedIds: [...new Set([...contentChangedIds, ...collectionChangedIds])],
		deletedEntries,
		manifestMap,
	};
}

export function buildInitialSyncPlan(input: {
	userId: string;
	fullSummaries: FullSummary[];
}): InitialSyncPlan {
	const { userId, fullSummaries } = input;
	const activeSummaries = fullSummaries.filter((summary) => !isDeleted(summary));

	const collectionMap = new Map<string, string[]>();
	const checksumMap = new Map<string, string>();
	for (const summary of fullSummaries) {
		if (summary.collectionIds.length > 0) {
			collectionMap.set(summary.id, summary.collectionIds);
		}
		checksumMap.set(summary.id, summary.checksum);
	}

	const config: MaterializationConfig = {
		workspaceRoot: WORKSPACE_ROOT,
		userId,
		collectionMap: collectionMap.size > 0 ? collectionMap : undefined,
	};
	const docsRoot = getDocsRoot(config);

	if (activeSummaries.length === 0) {
		return {
			docsRoot,
			primaryFiles: [],
			collectionSymlinks: [],
			nextState: [],
			isEmpty: true,
		};
	}

	const primaryFiles = materializeSummaries(activeSummaries, config);
	const collectionSymlinks = resolveCollectionSymlinks(activeSummaries, config);
	const nextState: StoredSyncEntry[] = primaryFiles.map((file) => ({
		id: file.summaryId,
		checksum: checksumMap.get(file.summaryId) ?? file.checksum,
		relativePath: file.relativePath,
		type: file.type,
		collectionIds: collectionMap.get(file.summaryId) ?? [],
	}));

	return {
		docsRoot,
		primaryFiles,
		collectionSymlinks,
		nextState,
		isEmpty: false,
	};
}

export function buildIncrementalSyncPlan(input: {
	userId: string;
	manifest: ManifestEntry[];
	storedState: StoredSyncEntry[];
	changedSummaries: ProtectedSummary[];
	diff: IncrementalSyncDiff;
}): IncrementalSyncPlan {
	const { userId, manifest, storedState, changedSummaries, diff } = input;
	const docsRoot = getDocsRoot({ workspaceRoot: WORKSPACE_ROOT, userId });
	const collectionMap = buildCollectionMapFromManifest(manifest);
	const config: MaterializationConfig = {
		workspaceRoot: WORKSPACE_ROOT,
		userId,
		collectionMap: collectionMap.size > 0 ? collectionMap : undefined,
	};
	const storedStateById = new Map(storedState.map((entry) => [entry.id, entry]));

	const writeFiles = changedSummaries.map((summary) =>
		materializeSummary(summary, config),
	);

	const newSyncEntries: StoredSyncEntry[] = writeFiles.map((file) => ({
		id: file.summaryId,
		checksum: diff.manifestMap.get(file.summaryId)?.checksum ?? file.checksum,
		relativePath: file.relativePath,
		type: diff.manifestMap.get(file.summaryId)?.entry.type ?? 0,
		collectionIds: collectionMap.get(file.summaryId) ?? [],
	}));

	for (const id of diff.collectionChangedIds) {
		const existing = storedStateById.get(id);
		if (!existing) continue;
		newSyncEntries.push({
			...existing,
			collectionIds: collectionMap.get(id) ?? [],
		});
	}

	const removeFiles = diff.deletedEntries.map(
		(entry) => `${docsRoot}/${entry.relativePath}`,
	);
	for (const file of writeFiles) {
		const previous = storedStateById.get(file.summaryId);
		if (previous && previous.relativePath !== file.relativePath) {
			removeFiles.push(`${docsRoot}/${previous.relativePath}`);
		}
	}

	const removeCollectionLinksByFilename = [
		...new Set(
			[...diff.allChangedIds, ...diff.deletedEntries.map((entry) => entry.id)]
				.map((id) => {
					const entry = storedStateById.get(id);
					return entry?.relativePath.split("/").pop() ?? null;
				})
				.filter((filename): filename is string => filename !== null),
		),
	];

	const newEntriesById = new Map(newSyncEntries.map((entry) => [entry.id, entry]));
	const symlinkInputs = diff.allChangedIds
		.map((id) => {
			const entry = newEntriesById.get(id) ?? storedStateById.get(id);
			if (!entry) return null;
			const type = Number.parseInt(entry.relativePath.split("/")[0] ?? "0", 10);
			return { id, type: Number.isNaN(type) ? 0 : type };
		})
		.filter((value): value is { id: string; type: number } => value !== null);

	const createCollectionLinks = resolveCollectionSymlinks(symlinkInputs, config);
	const deletedIds = new Set(diff.deletedEntries.map((entry) => entry.id));
	const changedIds = new Set(diff.allChangedIds);
	const nextState: StoredSyncEntry[] = [
		...storedState.filter(
			(entry) => !deletedIds.has(entry.id) && !changedIds.has(entry.id),
		),
		...newSyncEntries,
	];

	return {
		docsRoot,
		writeFiles,
		removeFiles,
		removeCollectionLinksByFilename,
		createCollectionLinks,
		nextState,
		stats: {
			contentChanged: diff.contentChangedIds.length,
			collectionChanged: diff.collectionChangedIds.length,
			deleted: diff.deletedEntries.length,
		},
	};
}
