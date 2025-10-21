import * as z from "zod";
import type { ChatMessagesScope } from "@/config/env";

// Chat schemas
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
		chatData: chatDataSchema.optional(),
		timestamp: z.string().optional(),
	})
	.loose();

export const protectedChatContextResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: chatContextSchema.optional(),
});

export type ProtectedChatContext = z.infer<typeof chatContextSchema>;
export type ProtectedChatContextData = z.infer<typeof chatDataSchema>;

// Chat messages schemas
const chatMessageSchema = z
	.object({
		chatContent: z.string().optional().nullable(),
		senderType: z.string().optional().nullable(),
	})
	.loose();

export const protectedChatMessagesResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: z.array(chatMessageSchema).optional(),
});

export type ProtectedChatMessage = z.infer<typeof chatMessageSchema>;

export interface FetchProtectedChatMessagesParams {
	scope?: ChatMessagesScope | null;
	collectionId?: string | null | undefined;
	summaryId?: string | null | undefined;
	size?: number | null | undefined;
}

// File schemas
const protectedFileCollectionSchema = z.object({
	id: z.string(),
	name: z.string(),
});

const protectedFileMetadataSchema = z.object({
	fileLink: z.string().nullable(),
	fileName: z.string().nullable(),
	fileType: z.string().nullable(),
	summaryId: z.string(),
	type: z.number(),
	collections: z.array(protectedFileCollectionSchema),
});

export const protectedFilesResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: z.array(protectedFileMetadataSchema).optional(),
});

export type ProtectedFileMetadata = z.infer<typeof protectedFileMetadataSchema>;

export const protectedFileDataSchema = z.discriminatedUnion("fileType", [
	z.object({
		fileType: z.literal("application/pdf"),
		id: z.string(), // Java Long values are parsed as strings
		parseContent: z.string(),
		fileName: z.string(),
	}),
	z.object({
		fileType: z.literal("link/normal"),
		id: z.string(), // Java Long values are parsed as strings
		parseContent: z.string(),
		fileLink: z.string(),
	}),
	z.object({
		fileType: z.literal("link/video"),
		id: z.string(), // Java Long values are parsed as strings
		parseContent: z.string(),
		fileLink: z.string(),
	}),
	z.object({
		fileType: z.literal("image/jpeg"),
		id: z.string(), // Java Long values are parsed as strings
		content: z.string(),
		fileName: z.string(),
	}),
]);

export const protectedFileDetailResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: protectedFileDataSchema.optional().nullable(),
});

export type RawProtectedFileData = z.infer<typeof protectedFileDataSchema>;

export interface FetchProtectedFilesParams {
	partnerCode: string;
	collectionId?: string | null;
}

// Summary schemas
const protectedSummarySchema = z.object({
	id: z.string(), // Java Long values are parsed as strings to prevent truncation
	memberCode: z.string().nullable().optional(),
	partnerCode: z.string().nullable().optional(),
	docId: z.string().nullable().optional(), // Java Long values are parsed as strings
	cosKey: z.string().nullable().optional(),
	fileType: z.string().nullable().optional(),
	fileName: z.string().nullable().optional(),
	fileLink: z.string().nullable().optional(),
	content: z.string().nullable().optional(),
	title: z.string().nullable().optional(),
	summaryTitle: z.string().nullable().optional(),
	parseContent: z.string().nullable().optional(),
	parseContentSlice: z.string().nullable().optional(),
	addKnowledge: z.string().nullable().optional(),
	delFlag: z.union([z.string(), z.number()]).nullable().optional(),
	coverUrl: z.string().nullable().optional(),
	contentCosKey: z.string().nullable().optional(),
	coverUrlCosKey: z.string().nullable().optional(),
	fileLinkCosKey: z.string().nullable().optional(),
	type: z.number().nullable().optional(),
	status: z.number().nullable().optional(),
	shareable: z.union([z.string(), z.number()]).nullable().optional(),
	taskId: z.string().nullable().optional(),
	errMsg: z.string().nullable().optional(),
	chatKey: z.string().nullable().optional(),
	imgWidth: z.number().nullable().optional(),
	imgHeight: z.number().nullable().optional(),
	createBy: z.union([z.string(), z.number()]).nullable().optional(),
	createTime: z.string().nullable().optional(),
	updateBy: z.union([z.string(), z.number()]).nullable().optional(),
	updateTime: z.string().nullable().optional(),
});

export const protectedSummariesResponseSchema = z.object({
	code: z.number(),
	msg: z.string(),
	data: z.array(protectedSummarySchema).optional().nullable(),
});

export type ProtectedSummary = z.infer<typeof protectedSummarySchema>;

// Paginated member summaries schemas (MyBatis-Plus pagination format)
const paginatedSummariesDataSchema = z.object({
	list: z.array(protectedSummarySchema), // Array of summary records for current page
	total: z.number().int().min(0), // Total number of records across all pages
	totalPages: z.number().int().min(0), // Total number of pages available
	page: z.number().int().min(1), // Current page number (1-based index)
	pageSize: z.number().int().min(1).max(100), // Number of records per page (page size)
});

export const protectedMemberSummariesResponseSchema = z.union([
	paginatedSummariesDataSchema,
	z.object({
		error: z.object({
			code: z.number(),
			message: z.string(),
			status: z.string(),
		}),
	}),
]);

export type PaginatedSummariesData = z.infer<
	typeof paginatedSummariesDataSchema
>;

export interface FetchProtectedMemberSummariesParams {
	partnerCode?: string | null;
	collectionId?: string | number | null;
	summaryId?: string | number | null;
	pageIndex?: number | null;
	pageSize?: number | null;
}

// Chat messages scope validation
const VALID_CHAT_MESSAGE_SCOPES = new Set<ChatMessagesScope>([
	"general",
	"collection",
	"document",
]);

export const normalizeChatMessagesScope = (
	scope: ChatMessagesScope | null | undefined,
): ChatMessagesScope => {
	if (scope && VALID_CHAT_MESSAGE_SCOPES.has(scope)) {
		return scope;
	}

	return "general";
};
