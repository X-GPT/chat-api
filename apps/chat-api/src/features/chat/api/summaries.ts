import {
	getProtectedMemberSummariesEndpoint,
	getProtectedSummariesEndpoint,
} from "@/config/env";
import type { ChatLogger } from "../chat.logger";
import { buildHeaders, type FetchOptions } from "./client";
import {
	type FetchProtectedMemberSummariesParams,
	type PaginatedSummariesData,
	type ProtectedSummary,
	protectedMemberSummariesResponseSchema,
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
		if ("error" in body) {
			logger.error({
				message: "Protected service returned error when fetching summaries",
				code: body.error.code,
				msg: body.error.message,
				status: body.error.status,
				ids,
			});
			throw new Error(`Failed to fetch summaries: ${body.error.message}`);
		}

		return body.list ?? [];
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

export async function fetchProtectedMemberSummaries(
	memberCode: string,
	params: FetchProtectedMemberSummariesParams,
	options: FetchOptions = {},
	logger: ChatLogger,
): Promise<PaginatedSummariesData> {
	const endpoint = getProtectedMemberSummariesEndpoint(memberCode, params);

	try {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch member summaries: ${response.status}`);
		}

		const rawBody = await response.json();
		const parseResult =
			protectedMemberSummariesResponseSchema.safeParse(rawBody);

		if (!parseResult.success) {
			logger.error({
				message: "Invalid member summaries response",
				target: endpoint,
				errors: parseResult.error,
				memberCode,
				params,
				rawBody,
			});
			throw new Error("Invalid member summaries response structure");
		}

		const body = parseResult.data;

		// Handle error response format
		if ("error" in body) {
			logger.error({
				message:
					"Protected service returned error when fetching member summaries",
				code: body.error.code,
				msg: body.error.message,
				status: body.error.status,
				memberCode,
				params,
			});
			throw new Error(`Failed to fetch member summaries: ${body.error.message}`);
		}

		// Handle standard response format with code/msg/data
		if (body.code !== 200) {
			logger.error({
				message:
					"Protected service returned error when fetching member summaries",
				code: body.code,
				msg: body.msg,
				memberCode,
				params,
				rawBody,
			});
			throw new Error(`Failed to fetch member summaries: ${body.msg}`);
		}

		// Return pagination data or default empty structure
		return (
			body.data ?? {
				list: [],
				total: 0,
				totalPages: 0,
				page: params.pageIndex ?? 1,
				pageSize: params.pageSize ?? 10,
			}
		);
	} catch (error) {
		if (error instanceof Error) {
			logger.error({
				message: "Error fetching member summaries from protected service",
				error: error.message,
				memberCode,
				params,
			});
			throw error;
		}

		logger.error({
			message: "Error fetching member summaries from protected service",
			error: String(error),
			memberCode,
			params,
		});
		throw new Error(String(error));
	}
}
