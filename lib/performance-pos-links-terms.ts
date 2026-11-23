import type { LinkCandidate, LinkedAccount, LinkedEmployee, UnlinkedPosAccount } from "./performance-links";

/**
 * What the POS cashier links dialog and its service share, with no server code, so the dialog (a client component) can use it: the unlink
 * reasons, the words for the lines of the Linked list and the unlink form's rule, as the Figma frames show them.
 */

export const NEW_ACCOUNT_REASON = "New Portal account for the same person";
export const UNLINK_REASONS = ["Wrong person linked", "Linked to the wrong POS account", "Other"] as const;
export type UnlinkReason = (typeof UNLINK_REASONS)[number];
export const NOTE_MAX_LENGTH = 300;
export const NOT_A_CASHIER_MESSAGE = "Not a cashier position";

/** What the warning in the Unlink dialog says: the sales leave the Employee, past months included, and a new Portal account is added, not unlinked. */
export const UNLINK_WARNING =
  "This removes this account’s sales from the employee, including past months. Their other linked accounts are not affected. If this is a new Portal account for the same person, add the new account instead of unlinking.";
export const UNLINK_AUDIT_NOTE = "Who unlinked, when and why is recorded in the audit log. Submitted evaluations keep the sales result they were scored with; reopened ones use the links as they are then.";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 Nov 2026" for a timestamp as the database prints it ("2026-11-20 10:15:00.123+00") or as ISO, on the Manila day. */
export function linkedOn(timestamp: string): string {
  let text = timestamp.trim().replace(" ", "T");
  if (/[+-]\d\d$/.test(text)) text += ":00";
  else if (!/(Z|[+-]\d\d:\d\d)$/.test(text)) text += "Z";
  const day = new Date(text).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const [year, month, date] = day.split("-").map(Number);
  return `${date} ${MONTHS[month - 1]} ${year}`;
}

/** The account's name from the Portal directory, or a plain label when the directory has no match. */
export const accountName = (account: Pick<LinkedAccount, "name">) => account.name ?? "Unnamed POS account";

/** "linked 20 Nov 2026 by Ada Okafor" */
export const linkedLine = (account: Pick<LinkedAccount, "linkedAt" | "linkedByName">) => `linked ${linkedOn(account.linkedAt)} by ${account.linkedByName}`;

/** "BR-EMP-0017 · Branch Cashier · 2 POS accounts" */
export const employeeLine = (person: Pick<LinkedEmployee, "employeeNumber" | "position" | "accounts">) =>
  `${person.employeeNumber} · ${person.position} · ${person.accounts.length} POS ${person.accounts.length === 1 ? "account" : "accounts"}`;

/** The Unlink dialog's subtitle: "Carla Mendoza (Cainta branch, linked 12 Nov 2026) from BR-EMP-0017". */
export const unlinkSubtitle = (person: Pick<LinkedEmployee, "employeeNumber">, account: Pick<LinkedAccount, "name" | "branch" | "linkedAt">) =>
  `${accountName(account)} (${account.branch ? `${account.branch}, ` : ""}linked ${linkedOn(account.linkedAt)}) from ${person.employeeNumber}`;

/** The Unlink button stays disabled until the reason is one of the three, and a note is given for Other (at most {@link NOTE_MAX_LENGTH} characters). */
export function unlinkReady(reason: string, note: string): boolean {
  if (!(UNLINK_REASONS as readonly string[]).includes(reason)) return false;
  const trimmed = note.trim();
  return trimmed.length <= NOTE_MAX_LENGTH && (reason !== "Other" || trimmed.length > 0);
}

/** "Needs linking 2" */
export const needsLinkingLabel = (count: number) => `Needs linking ${count}`;
/** The Link cashier subtitle: "2 POS accounts have sales but are not linked to an employee". */
export const unlinkedSubtitle = (count: number) => (count === 1 ? "1 POS account has sales but is not linked to an employee" : `${count} POS accounts have sales but are not linked to an employee`);

/** "Portal account · Cainta branch" (a staff number is added when one is known; HRMS stores none, so the line has no number today). */
export const accountSource = (account: Pick<UnlinkedPosAccount, "branch">, staffNumber?: string | null) =>
  ["Portal account", account.branch, staffNumber ? `staff no. ${staffNumber}` : null].filter(Boolean).join(" · ");

/** "November 2026", or "October – November 2026" when the stored days span months. */
export function salesSpan(from: string, to: string): string {
  const FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  if (fy === ty && fm === tm) return `${FULL[fm - 1]} ${fy}`;
  return fy === ty ? `${FULL[fm - 1]} – ${FULL[tm - 1]} ${ty}` : `${FULL[fm - 1]} ${fy} – ${FULL[tm - 1]} ${ty}`;
}
export const ordersLine = (account: Pick<UnlinkedPosAccount, "orders" | "from" | "to">) => `${account.orders} ${account.orders === 1 ? "order" : "orders"} · ${salesSpan(account.from, account.to)}`;

/** "BR-EMP-0017 · Branch Cashier · Cainta branch" */
export const candidateLine = (candidate: Pick<LinkCandidate, "employeeNumber" | "position" | "branch">) => `${candidate.employeeNumber} · ${candidate.position} · ${candidate.branch}`;
/** The tag beside a candidate: why they cannot be chosen, or that they already hold accounts. */
export const candidateTag = (candidate: Pick<LinkCandidate, "isCashier" | "accountCount">): string | null =>
  !candidate.isCashier ? NOT_A_CASHIER_MESSAGE : candidate.accountCount > 0 ? `Has ${candidate.accountCount} POS ${candidate.accountCount === 1 ? "account" : "accounts"}` : null;
/** The picker's search: by name or employee number, ignoring case and extra spaces. */
export function candidateMatches(candidate: Pick<LinkCandidate, "name" | "employeeNumber">, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/\s+/g, " ");
  return needle === "" || `${candidate.name} ${candidate.employeeNumber}`.toLowerCase().includes(needle);
}
/** Link cashier is ready with a cashier chosen, and the reason when that Employee already holds an account. */
export const linkReady = (candidate: Pick<LinkCandidate, "isCashier" | "accountCount"> | null, reason: string) =>
  candidate !== null && candidate.isCashier && (candidate.accountCount === 0 || reason === NEW_ACCOUNT_REASON);
export const needsReason = (candidate: Pick<LinkCandidate, "accountCount"> | null) => candidate !== null && candidate.accountCount > 0;
export const reasonHelp = (candidate: Pick<LinkCandidate, "name">) => `Needed because ${candidate.name} already has a POS account. It is shown only when the employee already has one.`;
export const LINK_NOTE = "Sales from both accounts add up for this employee, so past months stay counted. A POS account can belong to only one employee. The link is recorded in the audit log with who made it, when and why.";

/** The words for a refused link or unlink, for the dialog to show. */
export function linkMessage(problem: string): string {
  switch (problem) {
    case "unlink-reason-required": return "Choose a reason.";
    case "note-required": return "Add a note for Other.";
    case "note-invalid": return "The note has characters that are not allowed.";
    case "note-too-long": return `The note is at most ${NOTE_MAX_LENGTH} characters.`;
    case "not-cashier": return NOT_A_CASHIER_MESSAGE;
    case "account-taken": return "This POS account is already linked to an employee. Close the dialog to see the current list.";
    case "reason-required": return `Choose the reason “${NEW_ACCOUNT_REASON}”.`;
    case "reason-not-needed": return "This employee has no POS account yet, so no reason is needed.";
    case "unknown-employee": return "That employee no longer exists.";
    case "already-unlinked": return "This account was already unlinked. Close the dialog to see the current list.";
    case "unknown-link": return "This link no longer exists. Close the dialog to see the current list.";
    default: return "The link could not be changed.";
  }
}
