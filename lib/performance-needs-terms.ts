import { cleanMultiline, hasDisallowedText } from "./validators/text";

/**
 * The rules the Flag development need dialog checks before anything is sent, with no server imports so the dialog can share them; the
 * server repeats every check in `performance-needs.ts`. Text that does not belong is refused with a message, never quietly changed.
 */
export const GAP_MAX_LENGTH = 200;
export const ACTION_MAX_LENGTH = 300;

export type NeedProblem =
  | "gap-required" | "gap-invalid" | "gap-too-long"
  | "action-required" | "action-invalid" | "action-too-long"
  | "unknown-training" | "evaluation-not-started";

export const NEED_MESSAGES: Record<NeedProblem, string> = {
  "gap-required": "Enter the gap.",
  "gap-invalid": "Gap can’t contain control or invisible formatting characters.",
  "gap-too-long": `Gap is too long (${GAP_MAX_LENGTH} characters at most).`,
  "action-required": "Enter the recommended action or Training.",
  "action-invalid": "Recommended action can’t contain control or invisible formatting characters.",
  "action-too-long": `Recommended action is too long (${ACTION_MAX_LENGTH} characters at most).`,
  "unknown-training": "That Training no longer exists. Pick another or describe the action.",
  "evaluation-not-started": "A development need can be flagged once a rating is saved. Save the rating first.",
};

/** One of the two required text fields. Returns why it is refused, or null when it is fine. */
export function checkNeedText(field: "gap" | "action", text: string): NeedProblem | null {
  const max = field === "gap" ? GAP_MAX_LENGTH : ACTION_MAX_LENGTH;
  if (hasDisallowedText(text)) return `${field}-invalid`;
  const cleaned = cleanMultiline(text);
  if (cleaned === "") return `${field}-required`;
  return cleaned.length > max ? `${field}-too-long` : null;
}

export const needMessage = (problem: NeedProblem) => NEED_MESSAGES[problem];
