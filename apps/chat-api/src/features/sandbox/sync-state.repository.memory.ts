import type { SyncStateRepository } from "./sync-state.repository";
import type { SyncStateRecord, SyncStatus } from "./sync-state.types";

export class InMemorySyncStateRepository implements SyncStateRepository {
	private store = new Map<string, SyncStateRecord>();

	private key(userId: string, summaryId: string): string {
		return `${userId}:${summaryId}`;
	}

	async upsert(record: SyncStateRecord): Promise<void> {
		this.store.set(this.key(record.userId, record.summaryId), record);
	}

	async bulkUpsert(records: SyncStateRecord[]): Promise<void> {
		for (const record of records) {
			this.store.set(this.key(record.userId, record.summaryId), record);
		}
	}

	async delete(userId: string, summaryId: string): Promise<void> {
		this.store.delete(this.key(userId, summaryId));
	}

	async bulkDelete(userId: string, summaryIds: string[]): Promise<void> {
		for (const summaryId of summaryIds) {
			this.store.delete(this.key(userId, summaryId));
		}
	}

	async deleteAllForUser(userId: string): Promise<void> {
		for (const [key, record] of this.store) {
			if (record.userId === userId) {
				this.store.delete(key);
			}
		}
	}

	async findByUserAndSandbox(
		userId: string,
		sandboxId: string,
	): Promise<SyncStateRecord[]> {
		const results: SyncStateRecord[] = [];
		for (const record of this.store.values()) {
			if (record.userId === userId && record.sandboxId === sandboxId) {
				results.push(record);
			}
		}
		return results;
	}

	async findByUserId(userId: string): Promise<SyncStateRecord[]> {
		const results: SyncStateRecord[] = [];
		for (const record of this.store.values()) {
			if (record.userId === userId) {
				results.push(record);
			}
		}
		return results;
	}

	async findBySummaryId(
		userId: string,
		summaryId: string,
	): Promise<SyncStateRecord | null> {
		return this.store.get(this.key(userId, summaryId)) ?? null;
	}

	async findByStatus(
		userId: string,
		status: SyncStatus,
	): Promise<SyncStateRecord[]> {
		const results: SyncStateRecord[] = [];
		for (const record of this.store.values()) {
			if (record.userId === userId && record.syncStatus === status) {
				results.push(record);
			}
		}
		return results;
	}

	async updateStatus(
		userId: string,
		summaryId: string,
		status: SyncStatus,
		timestamp?: string,
	): Promise<void> {
		const record = this.store.get(this.key(userId, summaryId));
		if (!record) return;

		record.syncStatus = status;
		if (timestamp) {
			record.lastSyncedAt = timestamp;
		}
	}
}
