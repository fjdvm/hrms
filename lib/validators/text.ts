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
