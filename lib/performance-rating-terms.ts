import { cleanMultiline, hasDisallowedText } from "./validators/text";

/**
 * The rating and comments rules the Evaluation form checks before anything is sent. Pure, with no server imports, so the form can
 * share them; the server repeats every check in `performance-rating.ts`. A value that does not belong is refused with a message,
 * never quietly changed.
 */
export const RATING_MIN = 0;
export const RATING_MAX = 100;
export const COMMENTS_MAX_LENGTH = 2000;

export const RATING_MESSAGE = `Enter a whole number from ${RATING_MIN} to ${RATING_MAX}.`;
export const COMMENTS_CHARACTERS_MESSAGE = "Comments can’t contain control or invisible formatting characters.";
export const COMMENTS_TOO_LONG_MESSAGE = `Comments are too long (${COMMENTS_MAX_LENGTH} characters at most).`;

/** The rating field: digits only, a whole number from 0 to 100. */
export function checkRating(text: string): { value: number | null; error: string | null } {
  const cleaned = text.trim();
  if (!/^\d{1,3}$/.test(cleaned)) return { value: null, error: cleaned === "" ? "Enter a rating from 0 to 100." : RATING_MESSAGE };
  const value = Number(cleaned);
  return value < RATING_MIN || value > RATING_MAX ? { value: null, error: RATING_MESSAGE } : { value, error: null };
}

/** The comments field: optional free text over several lines. */
export function checkComments(text: string): string | null {
  if (hasDisallowedText(text)) return COMMENTS_CHARACTERS_MESSAGE;
  return cleanMultiline(text).length > COMMENTS_MAX_LENGTH ? COMMENTS_TOO_LONG_MESSAGE : null;
}

/** What HR reads when saving a rating is refused. The server action and the Evaluation form use the same words. */
export function ratingMessage(problem: "rating-invalid" | "comments-invalid" | "comments-too-long" | "already-submitted" | "not-in-roster" | "unknown-tab"): string {
  switch (problem) {
    case "rating-invalid": return RATING_MESSAGE;
    case "comments-invalid": return COMMENTS_CHARACTERS_MESSAGE;
    case "comments-too-long": return COMMENTS_TOO_LONG_MESSAGE;
    case "already-submitted": return "This evaluation is already submitted, so its rating can’t be changed.";
    case "not-in-roster": return "That employee isn’t listed in this period.";
    default: return "Something went wrong. Reload the page and try again.";
  }
}
