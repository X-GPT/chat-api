export {
	computeChecksum,
	getDocsRoot,
	type MaterializationConfig,
	type MaterializedFile,
	materializeSummaries,
	materializeSummary,
	resolveContent,
	resolveSourceKind,
	sanitizePathSegment,
} from "./materialization";
export { diffManifest, listSandboxFiles } from "./sandbox-manifest";
export {
	SandboxSyncService,
	type SandboxSyncServiceDeps,
	type SyncLogger,
} from "./sandbox-sync.service";
export type { SyncStateRepository } from "./sync-state.repository";
export { InMemorySyncStateRepository } from "./sync-state.repository.memory";
export type {
	ManifestDiff,
	ReconciliationAction,
	ReconciliationPlan,
	SyncStateRecord,
	SyncStatus,
} from "./sync-state.types";
