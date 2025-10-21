import JSONBigInt from "json-bigint";

/**
 * JSON parser configured to handle large integers (Java Long values) safely.
 *
 * JavaScript's Number type can only safely represent integers up to 2^53 - 1,
 * but Java's Long type can represent integers up to 2^63 - 1. This parser
 * converts large integers to strings during JSON parsing to prevent precision loss.
 *
 * Configuration:
 * - storeAsString: true - Converts large numbers to strings
 * - strict: true - Uses strict JSON parsing
 */
const JSONParser = JSONBigInt({
	storeAsString: true,
	strict: true,
});

/**
 * Safely parses JSON from a fetch Response, converting large integers to strings.
 *
 * @param response - The fetch Response object
 * @returns Parsed JSON with large integers as strings
 *
 * @example
 * const response = await fetch(endpoint);
 * const data = await parseJsonSafely(response);
 * // Large Java Long IDs like 1978389886830379008 will be strings
 */
export async function parseJsonSafely(response: Response): Promise<unknown> {
	const text = await response.text();
	return JSONParser.parse(text);
}
