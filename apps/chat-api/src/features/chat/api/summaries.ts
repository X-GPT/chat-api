import { getProtectedSummariesEndpoint } from "@/config/env";
import type { ChatLogger } from "../chat.logger";
import { buildHeaders, type FetchOptions } from "./client";
import {
	type ProtectedSummary,
	protectedSummariesResponseSchema,
} from "./types";

export async function fetchProtectedSummaries(
	ids: Array<string | number>,
	options: FetchOptions = {},
	logger: ChatLogger,
): Promise<ProtectedSummary[]> {
	const endpoint = getProtectedSummariesEndpoint(ids);

	try {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch summaries: ${response.status}`);
		}

		const rawBody = await response.json();
		const parseResult = protectedSummariesResponseSchema.safeParse(rawBody);

		if (!parseResult.success) {
			logger.error({
				message: "Invalid summaries response",
				target: endpoint,
				errors: parseResult.error,
				ids,
				rawBody,
			});
			throw new Error("Invalid summaries response structure");
		}

		const body = parseResult.data;
		if (body.code !== 200) {
			logger.error({
				message: "Protected service returned error when fetching summaries",
				code: body.code,
				msg: body.msg,
				ids,
				rawBody,
			});
			throw new Error(`Failed to fetch summaries: ${body.msg}`);
		}

		return body.data ?? [];
	} catch (error) {
		if (error instanceof Error) {
			logger.error({
				message: "Error fetching summaries from protected service",
				error: error.message,
				ids,
			});
			throw error;
		}

		logger.error({
			message: "Error fetching summaries from protected service",
			error: String(error),
			ids,
		});
		throw new Error(String(error));
	}
}
