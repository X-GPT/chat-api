import { apiEnv } from "@/config/env";

export interface FetchOptions {
	headers?: Record<string, string>;
	memberAuthToken?: string;
}

const defaultHeaders = {
	"content-type": "application/json",
	Authorization: `Bearer ${apiEnv.PROTECTED_API_TOKEN}`,
};

export const buildHeaders = (options?: FetchOptions) => {
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
