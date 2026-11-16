import { cleanText, hasControlCharacters } from "./validators/text";

/**
 * The rules the attendance-issue dialogs check before anything is sent, with no server imports so the dialogs can share them; the
 * server repeats every check in `performance-attendance.ts`. A reason that does not belong is refused with a message, never quietly changed.
 */
export const REASON_MAX_LENGTH = 500;

export const REASON_REQUIRED_MESSAGE = "Enter a reason.";
export const REASON_INVALID_MESSAGE = `Reason can’t contain control characters and is ${REASON_MAX_LENGTH} characters at most.`;

/** The reason field: required for Absent and for confirming no attendance, optional for Excused. */
export function checkReason(text: string, required: boolean): string | null {
  if (hasControlCharacters(text)) return REASON_INVALID_MESSAGE;
  const cleaned = cleanText(text);
  if (cleaned === "") return required ? REASON_REQUIRED_MESSAGE : null;
  return cleaned.length > REASON_MAX_LENGTH ? REASON_INVALID_MESSAGE : null;
}

/** What HR reads when resolving an attendance issue is refused. The server actions and the dialogs use the same words. */
export function attendanceMessage(problem: string): string {
  switch (problem) {
    case "reason-required": return REASON_REQUIRED_MESSAGE;
    case "reason-invalid": return REASON_INVALID_MESSAGE;
    case "not-an-open-issue": return "That day is no longer an open issue. Reload the page.";
    case "has-attendance": return "This employee now has attendance records for the period. Reload the page.";
    case "day-outside-period": return "That day is outside the period.";
    default: return "Something went wrong. Reload the page and try again.";
  }
}
