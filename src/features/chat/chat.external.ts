import * as z from "zod";
import {
	type ChatMessagesScope,
	getProtectedChatContextEndpoint,
	getProtectedChatEndpoint,
	getProtectedChatIdEndpoint,
	getProtectedChatMessagesEndpoint,
	getProtectedFileDetailEndpoint,
	getProtectedFilesEndpoint,
	getProtectedSummariesEndpoint,
} from "../../config/env";
import type { ChatEntity } from "./chat.events";
import type { ChatLogger } from "./chat.logger";

export interface FetchOptions {
	headers?: Record<string, string>;
	memberAuthToken?: string;
}

const defaultHeaders = {
	"content-type": "application/json",
	Authorization: `Bearer ${Bun.env.PROTECTED_API_TOKEN}`,
};

const buildHeaders = (options?: FetchOptions) => {
	const headers: Record<string, string> = {
		...defaultHeaders,
	};

	if (options?.memberAuthToken) {
		// m_Authorization is the header key required by the protected service
		headers.m_Authorization = options.memberAuthToken;
	}

	if (options?.headers) {
		Object.assign(headers, options.headers);
	}

	return headers;
};

interface ProtectedChatIdResponse {
	code: number;
	msg: string;
	data?: {
		chatId?: string;
	};
}

const chatDataSchema = z.object({
	teamCode: z.string().optional().nullable(),
	memberCode: z.string().optional().nullable(),
	nickName: z.string().optional().nullable(),
	partnerName: z.string().optional().nullable(),
	partnerCode: z.string().optional().nullable(),
	enableKnowledge: z.number().optional().nullable(),
	modelType: z.string().optional().nullable(),
});

const chatContextSchema = z
	.object({
		chatKey: z.string(),
		chatData: chatDataSchema.optional(),
		timestamp: z.string().optional(),
	})
	.loose();

const protectedChatContextResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: chatContextSchema.optional(),
});

export type ProtectedChatContext = z.infer<typeof chatContextSchema>;
export type ProtectedChatContextData = z.infer<typeof chatDataSchema>;

const chatMessageSchema = z
	.object({
		chatContent: z.string().optional().nullable(),
		senderType: z.string().optional().nullable(),
	})
	.loose();

const protectedChatMessagesResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: z.array(chatMessageSchema).optional(),
});

export type ProtectedChatMessage = z.infer<typeof chatMessageSchema>;

const protectedFileCollectionSchema = z.object({
	id: z.string(),
	name: z.string(),
});

const protectedFileMetadataSchema = z.object({
	fileLink: z.string().nullable(),
	fileName: z.string().nullable(),
	fileType: z.string().nullable(),
	summaryId: z.string(),
	type: z.number(),
	collections: z.array(protectedFileCollectionSchema),
});

const protectedFilesResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: z.array(protectedFileMetadataSchema).optional(),
});

export type ProtectedFileMetadata = z.infer<typeof protectedFileMetadataSchema>;

const protectedFileDataSchema = z.discriminatedUnion("fileType", [
	z.object({
		fileType: z.literal("application/pdf"),
		id: z.union([z.string(), z.number()]),
		parseContent: z.string(),
		fileName: z.string(),
	}),
	z.object({
		fileType: z.literal("link/normal"),
		id: z.union([z.string(), z.number()]),
		parseContent: z.string(),
		fileLink: z.string(),
	}),
	z.object({
		fileType: z.literal("link/video"),
		id: z.union([z.string(), z.number()]),
		parseContent: z.string(),
		fileLink: z.string(),
	}),
	z.object({
		fileType: z.literal("image/jpeg"),
		id: z.union([z.string(), z.number()]),
		content: z.string(),
		fileName: z.string(),
	}),
]);

const protectedFileDetailResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: protectedFileDataSchema.optional().nullable(),
});

type RawProtectedFileData = z.infer<typeof protectedFileDataSchema>;

const protectedSummarySchema = z.object({
	id: z.union([z.string(), z.number()]),
	memberCode: z.string().nullable().optional(),
	partnerCode: z.string().nullable().optional(),
	docId: z.union([z.string(), z.number()]).nullable().optional(),
	cosKey: z.string().nullable().optional(),
	fileType: z.string().nullable().optional(),
	fileName: z.string().nullable().optional(),
	fileLink: z.string().nullable().optional(),
	content: z.string().nullable().optional(),
	title: z.string().nullable().optional(),
	summaryTitle: z.string().nullable().optional(),
	parseContent: z.string().nullable().optional(),
	parseContentSlice: z.string().nullable().optional(),
	addKnowledge: z.string().nullable().optional(),
	delFlag: z.union([z.string(), z.number()]).nullable().optional(),
	coverUrl: z.string().nullable().optional(),
	contentCosKey: z.string().nullable().optional(),
	coverUrlCosKey: z.string().nullable().optional(),
	fileLinkCosKey: z.string().nullable().optional(),
	type: z.number().nullable().optional(),
	status: z.number().nullable().optional(),
	shareable: z.union([z.string(), z.number()]).nullable().optional(),
	taskId: z.string().nullable().optional(),
	errMsg: z.string().nullable().optional(),
	chatKey: z.string().nullable().optional(),
	imgWidth: z.number().nullable().optional(),
	imgHeight: z.number().nullable().optional(),
	createBy: z.union([z.string(), z.number()]).nullable().optional(),
	createTime: z.string().nullable().optional(),
	updateBy: z.union([z.string(), z.number()]).nullable().optional(),
	updateTime: z.string().nullable().optional(),
});

const protectedSummariesResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: z.array(protectedSummarySchema).optional().nullable(),
});

export type ProtectedSummary = z.infer<typeof protectedSummarySchema>;

const VALID_CHAT_MESSAGE_SCOPES = new Set<ChatMessagesScope>([
	"general",
	"collection",
	"document",
]);

const normalizeChatMessagesScope = (
	scope: ChatMessagesScope | null | undefined,
): ChatMessagesScope => {
	if (scope && VALID_CHAT_MESSAGE_SCOPES.has(scope)) {
		return scope;
	}

	return "general";
};

export async function fetchProtectedChatId(
	options: FetchOptions = {},
	logger: ChatLogger,
) {
	const endpoint = getProtectedChatIdEndpoint();

	try {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(`Failed to fetch chat id: ${response.status}`);
		}

		const body = (await response.json()) as ProtectedChatIdResponse;
		const chatId = body.data?.chatId;

		if (!chatId) {
			throw new Error("Response missing chatId");
		}

		return chatId;
	} catch (error) {
		if (error instanceof Error) {
			logger.error({
				message: "Error fetching chat id from protected service",
				error: error.message,
			});
			throw error;
		} else {
			logger.error({
				message: "Error fetching chat id from protected service",
				error: String(error),
			});
			throw new Error(String(error));
		}
	}
}

export async function fetchProtectedChatContext(
	chatKey: string,
	collectionId: string | null | undefined,
	summaryId: string | null | undefined,
	options: FetchOptions = {},
	logger: ChatLogger,
): Promise<ProtectedChatContext> {
	const endpoint = getProtectedChatContextEndpoint(chatKey, {
		collectionId,
		summaryId,
	});

	try {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(
				`Failed to fetch chat context for ${chatKey}: ${response.status}`,
			);
		}

		const rawBody = await response.json();
		const parseResult = protectedChatContextResponseSchema.safeParse(rawBody);

		if (!parseResult.success) {
			logger.error({
				message: "Invalid chat context response",
				target: endpoint,
				errors: parseResult.error,
				rawBody,
			});
			throw new Error("Invalid chat context response structure");
		}

		const body = parseResult.data;
		if (body.code !== 200 || !body.data) {
			logger.error({
				message: "Protected service returned error when fetching chat context",
				code: body.code,
				msg: body.msg,
			});
			throw new Error(`Failed to fetch chat context: ${body.msg}`);
		}

		return body.data;
	} catch (error) {
		if (error instanceof Error) {
			logger.error({
				message: "Error fetching chat context from protected service",
				error: error.message,
				chatKey,
				collectionId,
				summaryId,
			});
			throw error;
		}

		logger.error({
			message: "Error fetching chat context from protected service",
			error: String(error),
			chatKey,
			collectionId,
			summaryId,
		});
		throw new Error(String(error));
	}
}

export interface FetchProtectedChatMessagesParams {
	scope?: ChatMessagesScope | null;
	collectionId?: string | null | undefined;
	summaryId?: string | null | undefined;
	size?: number | null | undefined;
	memberCode?: string | null | undefined;
	collapseFlag?: string | null | undefined;
}

export async function fetchProtectedChatMessages(
	chatKey: string,
	params: FetchProtectedChatMessagesParams = {},
	options: FetchOptions = {},
	logger: ChatLogger,
): Promise<ProtectedChatMessage[]> {
	const { scope, collectionId, summaryId, size, memberCode, collapseFlag } =
		params;
	const resolvedScope = normalizeChatMessagesScope(scope);

	const endpoint = getProtectedChatMessagesEndpoint(chatKey, {
		scope: resolvedScope,
		collectionId: collectionId ?? null,
		summaryId: summaryId ?? null,
		size: size ?? null,
		memberCode: memberCode ?? null,
		collapseFlag: collapseFlag ?? null,
	});

	try {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: buildHeaders(options),
		});

		if (!response.ok) {
			throw new Error(
				`Failed to fetch chat messages for ${chatKey}: ${response.status}`,
			);
		}

		const rawBody = await response.json();
		const parseResult = protectedChatMessagesResponseSchema.safeParse(rawBody);

		if (!parseResult.success) {
			logger.error({
				message: "Invalid chat messages response",
				target: endpoint,
				errors: parseResult.error,
				chatKey,
				rawBody,
			});
			throw new Error("Invalid chat messages response structure");
		}

		const body = parseResult.data;
		if (body.code !== 200) {
			logger.error({
				message: "Protected service returned error when fetching chat messages",
				code: body.code,
				msg: body.msg,
				chatKey,
				scope: resolvedScope,
				collectionId,
				summaryId,
				size,
				memberCode,
				rawBody,
			});
			throw new Error(`Failed to fetch chat messages: ${body.msg}`);
		}

		return body.data ?? [];
	} catch (error) {
		if (error instanceof Error) {
			logger.error({
				message: "Error fetching chat messages from protected service",
				error: error.message,
				chatKey,
				scope: resolvedScope,
				collectionId,
				summaryId,
				size,
				memberCode,
			});
			throw error;
		}

		logger.error({
			message: "Error fetching chat messages from protected service",
			error: String(error),
			chatKey,
			scope: resolvedScope,
			collectionId,
			summaryId,
			size,
			memberCode,
		});
		throw new Error(String(error));
	}
}

export async function sendChatEntityToProtectedService(
	chatEntity: ChatEntity,
	options: FetchOptions = {},
	logger: ChatLogger,
) {
	const endpoint = getProtectedChatEndpoint();

	try {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: buildHeaders(options),
			body: JSON.stringify(chatEntity),
		});

		if (!response.ok) {
			const errorBody = await response.text().catch(() => undefined);
			logger.error({
				message: "Failed to upsert chat entity",
				status: response.status,
				body: errorBody,
			});
			throw new Error(`Failed to upsert chat entity: ${response.status}`);
		}

		const body = (await response.json()) as { code: number; msg: string };
		if (body.code !== 200) {
			logger.error({
				message: "Failed to upsert chat entity",
				status: response.status,
				body: body,
			});
			throw new Error(`Failed to upsert chat entity: ${body.msg}`);
		}
	} catch (error) {
		logger.error({
			message: "Error sending chat entity to protected service",
			error,
		});
		throw error;
	}
}

export interface FetchProtectedFilesParams {
	partnerCode: string;
	collectionId?: string | null;
}

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
