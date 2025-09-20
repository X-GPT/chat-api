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
		Bun.env.PROTECTED_API_PREFIX ?? Bun.env.API_PREFIX ?? DEFAULT_PROTECTED_API_PREFIX;
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
	const path = prefix === "/" ? "/protected/chat/id" : `${prefix}/protected/chat/id`;
	return new URL(path, origin).toString();
};
