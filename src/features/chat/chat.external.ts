import * as z from "zod";
import {
	type ChatMessagesScope,
	getProtectedChatContextEndpoint,
	getProtectedChatEndpoint,
	getProtectedChatIdEndpoint,
	getProtectedChatMessagesEndpoint,
} from "../../config/env";
import type { ChatEntity } from "./chat.events";
import type { ChatLogger } from "./chat.logger";

interface FetchOptions {
	headers?: Record<string, string>;
}

const defaultHeaders = {
	"content-type": "application/json",
	Authorization: `Bearer ${Bun.env.PROTECTED_API_TOKEN}`,
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
		collectionId: z.string().optional().nullable(),
		summaryId: z.string().optional().nullable(),
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
			headers: {
				...defaultHeaders,
				...options.headers,
			},
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
			headers: {
				...defaultHeaders,
				...options.headers,
			},
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
}

export async function fetchProtectedChatMessages(
	chatKey: string,
	params: FetchProtectedChatMessagesParams = {},
	options: FetchOptions = {},
	logger: ChatLogger,
): Promise<ProtectedChatMessage[]> {
	const { scope, collectionId, summaryId, size, memberCode } = params;
	const resolvedScope = normalizeChatMessagesScope(scope);

	const endpoint = getProtectedChatMessagesEndpoint(chatKey, {
		scope: resolvedScope,
		collectionId: collectionId ?? null,
		summaryId: summaryId ?? null,
		size: size ?? null,
		memberCode: memberCode ?? null,
	});

	try {
		const response = await fetch(endpoint, {
			method: "GET",
			headers: {
				...defaultHeaders,
				...options.headers,
			},
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
			headers: {
				...defaultHeaders,
				...options.headers,
			},
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

		// TODO: remove this
		logger.info({
			message: "Chat entity upserted successfully",
			body: body,
		});
	} catch (error) {
		logger.error({
			message: "Error sending chat entity to protected service",
			error,
		});
		throw error;
	}
}
