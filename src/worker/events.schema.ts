import { z } from "zod";

/**
 * Summary lifecycle event schema matching SummaryEventDTO from Java backend
 *
 * Example event:
 * ```json
 * {
 *   "id": 12345,
 *   "memberCode": "user123",
 *   "teamCode": "team456",
 *   "parseContent": "This is the parsed summary content...",
 *   "action": "CREATED",
 *   "timestamp": "2025-10-01T12:30:45.123Z"
 * }
 * ```
 */
export const SummaryEventSchema = z.object({
	id: z.number(),
	memberCode: z.string(),
	teamCode: z.string().nullable(),
	parseContent: z.string(),
	action: z.enum(["CREATED", "UPDATED", "DELETED"]),
	timestamp: z.iso.datetime(), // ISO 8601 format from Java's @JsonFormat
});

export type SummaryEvent = z.infer<typeof SummaryEventSchema>;

/**
 * Base message wrapper for SQS messages
 *
 * Example SQS message body:
 * ```json
 * {
 *   "type": "summary:lifecycle",
 *   "data": {
 *     "id": 12345,
 *     "memberCode": "user123",
 *     "teamCode": "team456",
 *     "parseContent": "This is the parsed summary content...",
 *     "action": "CREATED",
 *     "timestamp": "2025-10-01T12:30:45.123Z"
 *   }
 * }
 * ```
 */
export const SQSMessageSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("summary:lifecycle"),
		data: SummaryEventSchema,
	}),
	// Add more message types here as needed
	// z.object({
	//   type: z.literal("ingest:file"),
	//   data: FileIngestEventSchema,
	// }),
]);

export type SQSMessage = z.infer<typeof SQSMessageSchema>;
