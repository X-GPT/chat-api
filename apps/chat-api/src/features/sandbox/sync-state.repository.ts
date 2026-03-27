import type { SyncStateRecord, SyncStatus } from "./sync-state.types";

export interface SyncStateRepository {
	upsert(record: SyncStateRecord): Promise<void>;
	bulkUpsert(records: SyncStateRecord[]): Promise<void>;

	delete(userId: string, summaryId: string): Promise<void>;
	bulkDelete(userId: string, summaryIds: string[]): Promise<void>;
	deleteAllForUser(userId: string): Promise<void>;

	findByUserAndSandbox(
		userId: string,
		sandboxId: string,
	): Promise<SyncStateRecord[]>;
	findByUserId(userId: string): Promise<SyncStateRecord[]>;
	findBySummaryId(
		userId: string,
		summaryId: string,
	): Promise<SyncStateRecord | null>;

	findByStatus(userId: string, status: SyncStatus): Promise<SyncStateRecord[]>;
	updateStatus(
		userId: string,
		summaryId: string,
		status: SyncStatus,
		timestamp?: string,
	): Promise<void>;
}
