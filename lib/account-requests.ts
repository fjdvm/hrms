import { isValidDate } from "./offer-terms";
import type { PortalId } from "./portal/account-requests";

/** Why an Account request call was refused. `conflict` is an active request already, or a person who is no longer Onboarding. */
export class AccountRequestError extends Error {
  constructor(
    public readonly reason: "denied" | "invalid" | "unavailable" | "validation" | "not-found" | "conflict" | "email-taken",
    /** Per-field messages for `validation`, `email-taken` and `conflict`, ready for the dialog. */
    public readonly problems: Partial<Record<"workEmail" | "roleId" | "moduleIds" | "neededFrom" | "note", string>> = {},
  ) {
    super(`Account request: ${reason}`);
  }
}

export type AccountRequestInput = { workEmail: string; roleId: PortalId; moduleIds: PortalId[]; neededFrom?: string; note?: string };
export type ValidAccountRequest = { workEmail: string; roleId: PortalId; moduleIds: PortalId[]; neededFrom: string | undefined; note: string | null };

const EMAIL = /^[^\s@<>()[\],;:"\\]+@[^\s@<>()[\],;:"\\]+\.[^\s@<>()[\],;:"\\]+$/u;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u;
export const WORK_EMAIL_MAX = 254;
export const NOTE_MAX = 1000;

const isId = (value: unknown): value is PortalId => (typeof value === "string" && value.trim() !== "" && value.length <= 100) || (typeof value === "number" && Number.isFinite(value));

/** Checks the shape of what the Staff member typed. Whether the Role and Modules exist is the Portal's list to decide. */
export function validateAccountRequest(input: unknown): ValidAccountRequest {
  const problems: AccountRequestError["problems"] = {};
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const workEmail = typeof raw.workEmail === "string" ? raw.workEmail.trim().toLowerCase() : "";
  if (!workEmail) problems.workEmail = "Enter the work email.";
  else if (workEmail.length > WORK_EMAIL_MAX || !EMAIL.test(workEmail) || CONTROL.test(workEmail)) problems.workEmail = "Enter a valid work email.";
  if (!isId(raw.roleId)) problems.roleId = "Choose a Portal Role.";
  const rawModules: unknown[] = Array.isArray(raw.moduleIds) ? raw.moduleIds : [];
  if (rawModules.length === 0 || rawModules.length > 200 || !rawModules.every(isId)) problems.moduleIds = "Choose at least one Module.";
  const moduleIds = [...new Map((rawModules.filter(isId) as PortalId[]).map((id) => [String(id), id])).values()];
  if (raw.neededFrom !== undefined && raw.neededFrom !== "" && !isValidDate(raw.neededFrom)) problems.neededFrom = "Enter a valid date.";
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (raw.note !== undefined && raw.note !== null && typeof raw.note !== "string") problems.note = "Enter the note as text.";
  else if (note.length > NOTE_MAX || CONTROL.test(note)) problems.note = `Keep the note under ${NOTE_MAX} characters, without control characters.`;
  if (Object.keys(problems).length) throw new AccountRequestError("validation", problems);
  return { workEmail, roleId: raw.roleId as PortalId, moduleIds, neededFrom: typeof raw.neededFrom === "string" && raw.neededFrom ? raw.neededFrom : undefined, note: note || null };
}
