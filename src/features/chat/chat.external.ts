import {
	getProtectedChatEndpoint,
	getProtectedChatIdEndpoint,
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
