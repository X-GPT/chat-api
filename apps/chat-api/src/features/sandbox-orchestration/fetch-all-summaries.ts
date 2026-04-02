import type { FetchOptions } from "@/features/chat/api/client";
import { fetchProtectedFullSummaries } from "@/features/chat/api/summaries";
import type { FullSummary } from "@/features/chat/api/types";
import type { SyncLogger } from "@/features/sandbox";

const PAGE_SIZE = 100;
const MAX_PAGES = 1000;

export async function fetchAllFullSummaries(
	memberCode: string,
	partnerCode: string,
	fetchOptions: FetchOptions,
	logger: SyncLogger,
): Promise<FullSummary[]> {
	const allSummaries: FullSummary[] = [];
	let pageIndex = 1;
	let totalPages = 1;

	while (pageIndex <= Math.min(totalPages, MAX_PAGES)) {
		const result = await fetchProtectedFullSummaries(
			memberCode,
			{ partnerCode, pageIndex, pageSize: PAGE_SIZE },
			fetchOptions,
			logger,
		);

		allSummaries.push(...result.list);
		totalPages = result.totalPages;
		pageIndex++;
	}

	return allSummaries;
}
