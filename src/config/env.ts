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

export const getProtectedChatIdEndpoint = () => {
	const origin = getProtectedApiOrigin();
	const prefix = getProtectedApiPrefix();
	const path = prefix === "/" ? "/protected/chat/id" : `${prefix}/protected/chat/id`;
	return new URL(path, origin).toString();
};
