/**
 * Cleans free text the way every field that is stored or matched should be: Unicode-normalised, with each run of
 * whitespace collapsed to one space and the ends trimmed. Control characters are not stripped here; they make the
 * text invalid (see {@link hasControlCharacters}), so a bad value is refused rather than quietly changed.
 */
export function cleanText(value: string): string {
  return value.normalize("NFC").replace(/\s+/gu, " ").trim();
}

export const hasControlCharacters = (value: string) => /\p{Cc}/u.test(value.replace(/[\t\n\r]/gu, " "));

/** What a position or job title is made of: letters, digits, spaces and the few marks titles use. */
const NAME_CHARACTERS = /^[\p{L}\p{N} .,'’&()/+-]+$/u;

export type TextProblem = "empty" | "too-long" | "characters";

/** Checks a cleaned name-like field (a position, say). Returns why it is refused, or null when it is fine. */
export function nameProblem(cleaned: string, maxLength: number): TextProblem | null {
  if (!cleaned) return "empty";
  if (cleaned.length > maxLength) return "too-long";
  return NAME_CHARACTERS.test(cleaned) ? null : "characters";
}

/** The form text is compared in: cleaned, then lower-cased, so "Branch  CASHIER " and "branch cashier" are the same. */
export const matchKey = (value: string) => cleanText(value).toLowerCase();

/**
 * Cleans written comments, which may run over several lines: Unicode-normalised, line endings made "\n", spaces and tabs
 * collapsed within each line, each line trimmed, runs of blank lines collapsed to one, and the ends trimmed.
 */
export function cleanMultiline(value: string): string {
  return value.normalize("NFC").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/[^\S\n]+/gu, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * True when text holds characters that do not belong in written comments: control characters (other than tab and line breaks),
 * unpaired surrogates, private-use characters, and the bidirectional overrides that can make text read differently from how
 * it is stored. The text is refused, not quietly changed.
 */
export const hasDisallowedText = (value: string) => /[\p{Cc}\p{Cs}\p{Co}\u202A-\u202E\u2066-\u2069]/u.test(value.replace(/[\t\n\r]/g, " "));
