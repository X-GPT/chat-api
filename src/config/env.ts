const DEFAULT_PROTECTED_API_ORIGIN = "http://127.0.0.1";
const DEFAULT_PROTECTED_API_PREFIX = "/beta-api";

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
	return Bun.env.PROTECTED_API_ORIGIN ?? DEFAULT_PROTECTED_API_ORIGIN;
};

export const getProtectedApiPrefix = () => {
	const rawPrefix =
		Bun.env.PROTECTED_API_PREFIX ??
		Bun.env.API_PREFIX ??
		DEFAULT_PROTECTED_API_PREFIX;
	return sanitizePrefix(rawPrefix);
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
	memberCode?: string | null;
	collapseFlag?: string | null;
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

	const { scope, collectionId, summaryId, size, memberCode, collapseFlag } =
		options;

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

	const normalizedMemberCode = memberCode?.trim();
	if (normalizedMemberCode) {
		url.searchParams.set("memberCode", normalizedMemberCode);
	}

	const normalizedCollapseFlag = collapseFlag?.trim();
	if (normalizedCollapseFlag) {
		url.searchParams.set("collapseFlag", normalizedCollapseFlag);
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
