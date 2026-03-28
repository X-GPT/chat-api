import type { SyncDocument, SyncDocumentsResponse } from "./sync-types";

/**
 * Interface for fetching document source data for sandbox sync.
 * In-memory implementation for Phase 4; replaced with MySQL adapter later.
 */
export interface DocumentRepository {
	findAll(
		userId: string,
		cursor: number,
		limit: number,
	): Promise<SyncDocumentsResponse>;
}

/**
 * In-memory implementation seeded with test data.
 * Documents are stored per userId.
 */
export class InMemoryDocumentRepository implements DocumentRepository {
	private store = new Map<string, SyncDocument[]>();

	seed(userId: string, documents: SyncDocument[]): void {
		this.store.set(userId, documents);
	}

	async findAll(
		userId: string,
		cursor: number,
		limit: number,
	): Promise<SyncDocumentsResponse> {
		const all = this.store.get(userId) ?? [];
		const start = cursor;
		const end = Math.min(start + limit, all.length);
		const page = all.slice(start, end);
		const nextCursor = end < all.length ? end : null;

		return {
			documents: page,
			nextCursor,
			total: all.length,
		};
	}
}
