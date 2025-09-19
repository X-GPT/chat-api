import {
	getProtectedChatEndpoint,
	getProtectedChatIdEndpoint,
} from "../../config/env";
import type { ChatEntity } from "./chat.events";

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

export async function fetchProtectedChatId(options: FetchOptions = {}) {
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
		console.error({
			message: "Error fetching chat id from protected service",
			error,
		});
		throw error;
	}
}

export async function sendChatEntityToProtectedService(
	chatEntity: ChatEntity,
	options: FetchOptions = {},
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
			console.error({
				message: "Failed to upsert chat entity",
				status: response.status,
				body: errorBody,
			});
		}
	} catch (error) {
		console.error({
			message: "Error sending chat entity to protected service",
			error,
		});
	}
}
