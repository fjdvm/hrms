import { cleanMultiline, hasDisallowedText } from "./validators/text";

/**
 * The rules the Reopen evaluation dialog checks before anything is sent, with no server imports so the dialog can share them; the
 * server repeats every check in `performance-reopen.ts`. A reason that does not belong is refused with a message, never quietly changed.
 */
export const REASON_MAX_LENGTH = 500;

export const REOPEN_REASON_REQUIRED = "Enter the reason for reopening.";
export const REOPEN_REASON_INVALID = "Reason can’t contain control or invisible formatting characters.";
export const REOPEN_REASON_TOO_LONG = `Reason is too long (${REASON_MAX_LENGTH} characters at most).`;

/** The reason field: required, over one or more lines. Returns why it is refused, or null when it is fine. */
export function checkReopenReason(text: string): string | null {
  if (hasDisallowedText(text)) return REOPEN_REASON_INVALID;
  const cleaned = cleanMultiline(text);
  if (cleaned === "") return REOPEN_REASON_REQUIRED;
  return cleaned.length > REASON_MAX_LENGTH ? REOPEN_REASON_TOO_LONG : null;
}

/** What HR reads when a reopen is refused. The server action and the dialog use the same words. */
export function reopenMessage(problem: "reason-required" | "reason-invalid" | "reason-too-long" | "not-evaluated"): string {
  switch (problem) {
    case "reason-required": return REOPEN_REASON_REQUIRED;
    case "reason-invalid": return REOPEN_REASON_INVALID;
    case "reason-too-long": return REOPEN_REASON_TOO_LONG;
    case "not-evaluated": return "This evaluation is not submitted, so there is nothing to reopen. Reload the page.";
  }
}
