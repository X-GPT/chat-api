import * as z from "zod";
import { getProtectedManifestEndpoint } from "@/config/env";
import type { SyncLogger } from "@/features/sandbox";
import { buildHeaders, type FetchOptions } from "./client";
import { parseJsonSafely } from "./json-parser";

const manifestEntrySchema = z.object({
	id: z.string(),
	checksum: z.string(),
	type: z.number(),
	collectionIds: z.array(z.string()).optional(),
});

const manifestResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: z.array(manifestEntrySchema).optional(),
});

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

export async function fetchSummariesManifest(
	memberCode: string,
	partnerCode: string,
	options: FetchOptions = {},
	logger: SyncLogger,
): Promise<ManifestEntry[]> {
	const endpoint = getProtectedManifestEndpoint(memberCode, partnerCode);

	try {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch manifest: ${response.status}`);
		}

		const rawBody = await parseJsonSafely(response);
		const parseResult = manifestResponseSchema.safeParse(rawBody);

		if (!parseResult.success) {
			logger.error({
				message: "Invalid manifest response",
				target: endpoint,
				errors: parseResult.error,
				memberCode,
				rawBody,
			});
			throw new Error("Invalid manifest response structure");
		}

		const body = parseResult.data;
		if (body.code !== 200) {
			logger.error({
				message: "Protected service returned error when fetching manifest",
				code: body.code,
				msg: body.msg,
				memberCode,
			});
			throw new Error(`Failed to fetch manifest: ${body.msg}`);
		}

		if (!body.data) {
			throw new Error("Manifest response missing data field");
		}
		return body.data;
	} catch (error) {
		if (error instanceof Error) {
			logger.error({
				message: "Error fetching manifest from protected service",
				error: error.message,
				memberCode,
			});
			throw error;
		}

		logger.error({
			message: "Error fetching manifest from protected service",
			error: String(error),
			memberCode,
		});
		throw new Error(String(error));
	}
}
