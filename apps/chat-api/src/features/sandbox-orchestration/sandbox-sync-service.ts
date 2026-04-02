import type { Sandbox } from "e2b";
import type { FetchOptions } from "@/features/chat/api/client";
import { fetchSummariesManifest as defaultFetchManifest } from "@/features/chat/api/manifest";
import { fetchProtectedSummaries as defaultFetchSummaries } from "@/features/chat/api/summaries";
import { getDocsRoot, type SyncLogger } from "@/features/sandbox";
import { fetchAllFullSummaries as defaultFetchAllFull } from "./fetch-all-summaries";
import { WORKSPACE_ROOT } from "./sandbox-manager";
import {
	applyIncrementalSyncPlan,
	applyInitialSyncPlan,
} from "./sandbox-sync-apply";
import {
	buildIncrementalSyncPlan,
	buildInitialSyncPlan,
	diffIncrementalSync,
} from "./sandbox-sync-planner";
import {
	clearSyncErrorMessage,
	hasCompletedSync,
	isInitialSyncInFlight,
	readStoredSyncState,
	readSyncErrorMessage,
	rememberCompletedSync,
	trackInitialSync,
	writeSyncErrorMessage,
} from "./sandbox-sync-state";
import type { SyncFetchers, SyncOptions, SyncStatus } from "./sandbox-sync-types";

interface SyncContext {
	userId: string;
	sandbox: Sandbox;
	options: SyncOptions;
	logger: SyncLogger;
	fetchers?: Partial<SyncFetchers>;
}

export async function getSyncStatus(input: {
	userId: string;
	sandbox: Sandbox;
	docsRoot: string;
}): Promise<{ status: SyncStatus; message?: string }> {
	const { userId, sandbox, docsRoot } = input;

	if (isInitialSyncInFlight(userId)) {
		return { status: "syncing" };
	}

	const errorMessage = await readSyncErrorMessage(sandbox, docsRoot);
	if (errorMessage) {
		return { status: "error", message: errorMessage };
	}

	if (await hasCompletedSync(userId, sandbox, docsRoot)) {
		return { status: "synced" };
	}

	return { status: "idle" };
}

export async function startInitialSyncIfNeeded(
	input: SyncContext,
): Promise<{ status: "synced" | "syncing" }> {
	const { userId, sandbox, options, logger } = input;
	const docsRoot = getDocsRoot({
		workspaceRoot: WORKSPACE_ROOT,
		userId,
	});

	const status = await getSyncStatus({ userId, sandbox, docsRoot });
	if (status.status === "synced") {
		return { status: "synced" };
	}
	if (status.status === "syncing") {
		return { status: "syncing" };
	}

	await clearSyncErrorMessage(sandbox, docsRoot);

	const fetchOptions: FetchOptions = {
		memberAuthToken: options.memberAuthToken,
	};

	const promise = (async () => {
		try {
			const fetchAll = input.fetchers?.fetchAllFullSummaries ?? defaultFetchAllFull;
			const fullSummaries = await fetchAll(
				options.memberCode,
				options.partnerCode,
				fetchOptions,
				logger,
			);
			const plan = buildInitialSyncPlan({ userId, fullSummaries });

			logger.info({
				msg: "Initial sync: fetched summaries",
				userId,
				total: fullSummaries.length,
				active: plan.primaryFiles.length,
				collections: plan.collectionSymlinks.length,
			});

			await applyInitialSyncPlan(sandbox, plan);
			rememberCompletedSync(userId, sandbox.sandboxId);
			logger.info({
				msg: "Initial sync complete",
				userId,
				fileCount: plan.primaryFiles.length,
				symlinks: plan.collectionSymlinks.length,
			});
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await writeSyncErrorMessage(sandbox, docsRoot, message);
			logger.error({
				msg: "Initial sync failed",
				userId,
				error: message,
			});
		}
	})();

	trackInitialSync(userId, promise);
	return { status: "syncing" };
}

export async function runIncrementalSync(input: SyncContext): Promise<void> {
	const { userId, sandbox, options, logger } = input;
	const fetchOptions: FetchOptions = {
		memberAuthToken: options.memberAuthToken,
	};
	const docsRoot = getDocsRoot({
		workspaceRoot: WORKSPACE_ROOT,
		userId,
	});

	const fetchManifest = input.fetchers?.fetchSummariesManifest ?? defaultFetchManifest;
	const [manifest, storedState] = await Promise.all([
		fetchManifest(
			options.memberCode,
			options.partnerCode,
			fetchOptions,
			logger,
		),
		readStoredSyncState(sandbox, docsRoot),
	]);

	const diff = diffIncrementalSync(manifest, storedState);
	if (diff.allChangedIds.length === 0 && diff.deletedEntries.length === 0) {
		return;
	}

	logger.info({
		msg: "Incremental sync: changes detected",
		userId,
		contentChanged: diff.contentChangedIds.length,
		collectionChanged: diff.collectionChangedIds.length,
		deleted: diff.deletedEntries.length,
	});

	const fetchSummaries = input.fetchers?.fetchProtectedSummaries ?? defaultFetchSummaries;
	const changedSummaries =
		diff.contentChangedIds.length > 0
			? await fetchSummaries(
					diff.contentChangedIds,
					fetchOptions,
					logger,
				)
			: [];

	const plan = buildIncrementalSyncPlan({
		userId,
		manifest,
		storedState,
		changedSummaries,
		diff,
	});

	await applyIncrementalSyncPlan(sandbox, plan, logger, userId);
	logger.info({
		msg: "Incremental sync complete",
		userId,
		changed: diff.allChangedIds.length,
		deleted: diff.deletedEntries.length,
	});
}
