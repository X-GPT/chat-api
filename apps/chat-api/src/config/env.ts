import invariant from "tiny-invariant";

const DEFAULT_PROTECTED_API_ORIGIN = "http://127.0.0.1";
const DEFAULT_PROTECTED_API_PREFIX = "/beta-api";
const DEFAULT_RAG_API_ORIGIN = "http://rag-api:8000";

/**
 * Environment variables for the API server
 * All variables are validated at module load time
 */
export const apiEnv = (() => {
	invariant(Bun.env.OPENAI_API_KEY, "OPENAI_API_KEY is required");
	invariant(Bun.env.ANTHROPIC_API_KEY, "ANTHROPIC_API_KEY is required");
	invariant(Bun.env.PROTECTED_API_TOKEN, "PROTECTED_API_TOKEN is required");

	return {
		OPENAI_API_KEY: Bun.env.OPENAI_API_KEY,
		ANTHROPIC_API_KEY: Bun.env.ANTHROPIC_API_KEY,
		PROTECTED_API_ORIGIN:
			Bun.env.PROTECTED_API_ORIGIN || DEFAULT_PROTECTED_API_ORIGIN,
		PROTECTED_API_PREFIX:
			Bun.env.PROTECTED_API_PREFIX ||
			Bun.env.API_PREFIX ||
			DEFAULT_PROTECTED_API_PREFIX,
		PROTECTED_API_TOKEN: Bun.env.PROTECTED_API_TOKEN,
		RAG_API_ORIGIN: Bun.env.RAG_API_ORIGIN || DEFAULT_RAG_API_ORIGIN,
		LOG_LEVEL: Bun.env.LOG_LEVEL || "info",
	} as const;
})();

const sanitizePrefix = (value: string) => {
	const trimmed = value.trim();
	const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
	const withoutTrailingSlash = withLeadingSlash.replace(/\/+$/, "");
	if (withoutTrailingSlash.length === 0) {
		return "/";
	}
	return withoutTrailingSlash;
};

export const getProtectedApiOrigin = () => {
	return apiEnv.PROTECTED_API_ORIGIN;
};

export const getProtectedApiPrefix = () => {
	return sanitizePrefix(apiEnv.PROTECTED_API_PREFIX);
};

export const getProtectedChatEndpoint = () => {
	const origin = getProtectedApiOrigin();
	const prefix = getProtectedApiPrefix();
	const path = prefix === "/" ? "/protected/chat" : `${prefix}/protected/chat`;
	return new URL(path, origin).toString();
};

interface ChatContextEndpointOptions {
	collectionId?: string | null;
	summaryId?: string | null;
}

export const getProtectedChatContextEndpoint = (
	chatKey: string,
	options: ChatContextEndpointOptions = {},
) => {
	const origin = getProtectedApiOrigin();
	const prefix = getProtectedApiPrefix();
	const encodedChatKey = encodeURIComponent(chatKey);
	const basePath = `/protected/chat/context/${encodedChatKey}`;
	const path = prefix === "/" ? basePath : `${prefix}${basePath}`;
	const url = new URL(path, origin);
	const { collectionId, summaryId } = options;
	const normalizedCollectionId = collectionId?.trim();
	if (normalizedCollectionId) {
		url.searchParams.set("collectionId", normalizedCollectionId);
	}
	const normalizedSummaryId = summaryId?.trim();
	if (normalizedSummaryId) {
		url.searchParams.set("summaryId", normalizedSummaryId);
	}
	return url.toString();
};

export const getProtectedChatIdEndpoint = () => {
	const origin = getProtectedApiOrigin();
	const prefix = getProtectedApiPrefix();
	const path =
		prefix === "/" ? "/protected/chat/id" : `${prefix}/protected/chat/id`;
	return new URL(path, origin).toString();
};

export type ChatMessagesScope = "general" | "collection" | "document";

interface ChatMessagesEndpointOptions {
	scope?: ChatMessagesScope | null;
	collectionId?: string | null;
	summaryId?: string | null;
	size?: number | null;
}

export const getProtectedChatMessagesEndpoint = (
	chatKey: string,
	options: ChatMessagesEndpointOptions = {},
) => {
	const origin = getProtectedApiOrigin();
	const prefix = getProtectedApiPrefix();
	const encodedChatKey = encodeURIComponent(chatKey);
	const basePath = `/protected/chats/${encodedChatKey}/messages`;
	const path = prefix === "/" ? basePath : `${prefix}${basePath}`;
	const url = new URL(path, origin);

	const { scope, collectionId, summaryId, size } = options;

	if (scope) {
		url.searchParams.set("scope", scope);
	}

	const normalizedCollectionId = collectionId?.trim();
	if (normalizedCollectionId) {
		url.searchParams.set("collectionId", normalizedCollectionId);
	}

	const normalizedSummaryId = summaryId?.trim();
	if (normalizedSummaryId) {
		url.searchParams.set("summaryId", normalizedSummaryId);
	}

	if (typeof size === "number" && Number.isFinite(size) && size > 0) {
		url.searchParams.set("size", String(size));
	}

	return url.toString();
};

interface FilesEndpointOptions {
	partnerCode: string;
	collectionId?: string | null;
}

export const getProtectedFilesEndpoint = (options: FilesEndpointOptions) => {
	const origin = getProtectedApiOrigin();
	const prefix = getProtectedApiPrefix();
	const basePath = `/protected/files`;
	const path = prefix === "/" ? basePath : `${prefix}${basePath}`;
	const url = new URL(path, origin);
	const { partnerCode, collectionId } = options;
	const normalizedPartnerCode = partnerCode.trim();
	if (!normalizedPartnerCode) {
		throw new Error(
			"partnerCode is required to build protected files endpoint",
		);
	}
	url.searchParams.set("partnerCode", normalizedPartnerCode);

	const normalizedCollectionId = collectionId?.trim();
	if (normalizedCollectionId) {
		url.searchParams.set("collectionId", normalizedCollectionId);
	}

	return url.toString();
};

export const getProtectedFileDetailEndpoint = (
	type: string | number,
	id: string | number,
) => {
	const origin = getProtectedApiOrigin();
	const prefix = getProtectedApiPrefix();
	const encodedType = encodeURIComponent(String(type));
	const encodedId = encodeURIComponent(String(id));
	const basePath = `/protected/files/${encodedType}/${encodedId}`;
	const path = prefix === "/" ? basePath : `${prefix}${basePath}`;
	return new URL(path, origin).toString();
};

export const getProtectedSummariesEndpoint = (ids: Array<string | number>) => {
	const origin = getProtectedApiOrigin();
	const prefix = getProtectedApiPrefix();
	const basePath = `/protected/summaries`;
	const path = prefix === "/" ? basePath : `${prefix}${basePath}`;
	const url = new URL(path, origin);

	if (!Array.isArray(ids) || ids.length === 0) {
		throw new Error("At least one summary id is required");
	}

	let appendedIds = 0;
	ids.forEach((rawId) => {
		const normalizedId = String(rawId).trim();
		if (normalizedId) {
			url.searchParams.append("ids", normalizedId);
			appendedIds += 1;
		}
	});

	if (appendedIds === 0) {
		throw new Error("At least one valid summary id is required");
	}

	return url.toString();
};

interface MemberSummariesEndpointOptions {
	partnerCode?: string | null;
	collectionId?: string | number | null;
	summaryId?: string | number | null;
	pageIndex?: number | null;
	pageSize?: number | null;
}

export const getProtectedMemberSummariesEndpoint = (
	memberCode: string,
	options: MemberSummariesEndpointOptions,
) => {
	const origin = getProtectedApiOrigin();
	const prefix = getProtectedApiPrefix();
	const encodedMemberCode = encodeURIComponent(memberCode);
	const basePath = `/protected/members/${encodedMemberCode}/summaries`;
	const path = prefix === "/" ? basePath : `${prefix}${basePath}`;
	const url = new URL(path, origin);

	const { partnerCode, collectionId, summaryId, pageIndex, pageSize } = options;

	// partnerCode is required when summaryId is not provided
	const normalizedSummaryId =
		summaryId !== null && summaryId !== undefined
			? String(summaryId).trim()
			: null;

	if (!normalizedSummaryId) {
		const normalizedPartnerCode = partnerCode?.trim();
		if (!normalizedPartnerCode) {
			throw new Error("partnerCode is required when summaryId is not provided");
		}
		url.searchParams.set("partnerCode", normalizedPartnerCode);
	} else {
		const normalizedPartnerCode = partnerCode?.trim();
		if (normalizedPartnerCode) {
			url.searchParams.set("partnerCode", normalizedPartnerCode);
		}
	}

	// Optional parameters
	if (collectionId !== null && collectionId !== undefined) {
		const normalizedCollectionId = String(collectionId).trim();
		if (normalizedCollectionId) {
			url.searchParams.set("collectionId", normalizedCollectionId);
		}
	}

	if (normalizedSummaryId) {
		url.searchParams.set("summaryId", normalizedSummaryId);
	}

	// 1-based pagination with defaults
	if (
		typeof pageIndex === "number" &&
		Number.isFinite(pageIndex) &&
		pageIndex >= 1
	) {
		url.searchParams.set("pageIndex", String(pageIndex));
	}

	if (
		typeof pageSize === "number" &&
		Number.isFinite(pageSize) &&
		pageSize >= 1 &&
		pageSize <= 100
	) {
		url.searchParams.set("pageSize", String(pageSize));
	}

	return url.toString();
};

export const getRagSearchEndpoint = () => {
	const origin = apiEnv.RAG_API_ORIGIN;
	return new URL("/api/v1/search", origin).toString();
};
