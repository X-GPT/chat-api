import {
	getProtectedFileDetailEndpoint,
	getProtectedFilesEndpoint,
} from "@/config/env";
import type { ChatLogger } from "../chat.logger";
import { buildHeaders, type FetchOptions } from "./client";
import {
	type FetchProtectedFilesParams,
	type ProtectedFileMetadata,
	protectedFileDetailResponseSchema,
	protectedFilesResponseSchema,
	type RawProtectedFileData,
} from "./types";

export async function fetchProtectedFiles(
	params: FetchProtectedFilesParams,
	options: FetchOptions = {},
	logger: ChatLogger,
): Promise<ProtectedFileMetadata[]> {
	const { partnerCode, collectionId } = params;
	const endpoint = getProtectedFilesEndpoint({
		partnerCode,
		collectionId: collectionId ?? null,
	});

	try {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch files: ${response.status}`);
		}

		const rawBody = await response.json();
		const parseResult = protectedFilesResponseSchema.safeParse(rawBody);

		if (!parseResult.success) {
			logger.error({
				message: "Invalid files response",
				target: endpoint,
				errors: parseResult.error,
				rawBody,
				partnerCode,
				collectionId,
			});
			throw new Error("Invalid files response structure");
		}

		const body = parseResult.data;
		if (body.code !== 200) {
			logger.error({
				message: "Protected service returned error when fetching files",
				code: body.code,
				msg: body.msg,
				partnerCode,
				collectionId,
				rawBody,
			});
			throw new Error(`Failed to fetch files: ${body.msg}`);
		}

		return body.data ?? [];
	} catch (error) {
		if (error instanceof Error) {
			logger.error({
				message: "Error fetching files from protected service",
				error: error.message,
				partnerCode,
				collectionId,
			});
			throw error;
		}

		logger.error({
			message: "Error fetching files from protected service",
			error: String(error),
			partnerCode,
			collectionId,
		});
		throw new Error(String(error));
	}
}

export async function fetchProtectedFileDetail(
	type: number | string,
	id: number | string,
	options: FetchOptions = {},
	logger: ChatLogger,
): Promise<RawProtectedFileData | null> {
	const endpoint = getProtectedFileDetailEndpoint(type, id);

	try {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(
				`Failed to fetch file detail for ${type}/${id}: ${response.status}`,
			);
		}

		const rawBody = await response.json();
		const parseResult = protectedFileDetailResponseSchema.safeParse(rawBody);

		if (!parseResult.success) {
			logger.error({
				message: "Invalid file detail response",
				target: endpoint,
				errors: parseResult.error,
				type,
				id,
			});
			throw new Error("Invalid file detail response structure");
		}

		const body = parseResult.data;
		if (body.code !== 200) {
			logger.error({
				message: "Protected service returned error when fetching file detail",
				code: body.code,
				msg: body.msg,
				type,
				id,
			});
			throw new Error(`Failed to fetch file detail: ${body.msg}`);
		}

		const data = body.data;
		if (!data) {
			return null;
		}

		return data;
	} catch (error) {
		if (error instanceof Error) {
			logger.error({
				message: "Error fetching file detail from protected service",
				error: error.message,
				type,
				id,
			});
			throw error;
		}

		logger.error({
			message: "Error fetching file detail from protected service",
			error: String(error),
			type,
			id,
		});
		throw new Error(String(error));
	}
}
