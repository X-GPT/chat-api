export function partialParse(raw: string) {
  const trimmed = raw.trimStart();

  // Bail out fast if it doesn't look like an object
  if (!trimmed.startsWith("{")) return undefined;

  // Try to close any unterminated string
  const quoteCount = (trimmed.match(/"/g) ?? []).length;
  const needsQuote = quoteCount % 2 === 1;

  // Try to close the object
  const needsBrace = !trimmed.endsWith("}");

  let candidate = trimmed;
  if (needsQuote) candidate += '"';
  if (needsBrace) candidate += "}";

  try {
    return JSON.parse(candidate);
  } catch {
    return undefined; // still not valid
  }
}
