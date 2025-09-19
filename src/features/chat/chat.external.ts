import {
	getProtectedChatEndpoint,
	getProtectedChatIdEndpoint,
} from "../../config/env";
import type { ChatEntity } from "./chat.events";

interface SendChatEntityOptions {
	headers?: Record<string, string>;
}

interface ProtectedChatIdResponse {
	code: number;
	msg: string;
	data?: {
		chatId?: string;
	};
}

export async function fetchProtectedChatId() {
	const endpoint = getProtectedChatIdEndpoint();

	try {
		const response = await fetch(endpoint);

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
	options: SendChatEntityOptions = {},
) {
	const endpoint = getProtectedChatEndpoint();

	try {
		const response = await fetch(endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/json",
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
