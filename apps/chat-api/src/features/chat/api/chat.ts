import {
	getProtectedChatContextEndpoint,
	getProtectedChatEndpoint,
	getProtectedChatIdEndpoint,
	getProtectedChatMessagesEndpoint,
} from "@/config/env";
import type { ChatEntity } from "../chat.events";
import type { ChatLogger } from "../chat.logger";
import { buildHeaders, type FetchOptions } from "./client";
import {
	type FetchProtectedChatMessagesParams,
	normalizeChatMessagesScope,
	type ProtectedChatContext,
	type ProtectedChatMessage,
	protectedChatContextResponseSchema,
	protectedChatMessagesResponseSchema,
} from "./types";

interface ProtectedChatIdResponse {
	code: number;
	msg: string;
	data?: {
		chatId?: string;
	};
}

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

export async function fetchProtectedChatMessages(
	chatKey: string,
	params: FetchProtectedChatMessagesParams = {},
	options: FetchOptions = {},
	logger: ChatLogger,
): Promise<ProtectedChatMessage[]> {
	const { scope, collectionId, summaryId, size } = params;
	const resolvedScope = normalizeChatMessagesScope(scope);

	const endpoint = getProtectedChatMessagesEndpoint(chatKey, {
		scope: resolvedScope,
		collectionId: collectionId ?? null,
		summaryId: summaryId ?? null,
		size: size ?? null,
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
