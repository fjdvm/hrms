import { NEW_ACCOUNT_REASON, NOT_A_CASHIER_MESSAGE } from "./performance-pos-links-terms";
import type { LinkCandidate, PosAccountNeedingLink } from "./performance-pos-accounts";
import { matchKey } from "./validators/text";

/**
 * The rules behind the Link POS cashier dialog, as pure functions that mirror the server's (`linkAccount`): the dialog shows what can be chosen and
 * what is still needed as the Staff member works, and the server still has the final say.
 */

/** How many matches the picker lists at once. */
export const PICKER_LIMIT = 8;

/** Employees who match what was typed (name, number, position or branch, ignoring case and extra spaces), in the order given, up to the limit. */
export function filterCandidates(candidates: readonly LinkCandidate[], search: string): LinkCandidate[] {
  const needle = matchKey(search);
  const found = needle === "" ? [...candidates] : candidates.filter((c) => matchKey(`${c.name} ${c.employeeNumber} ${c.position} ${c.branch}`).includes(needle));
  return found.slice(0, PICKER_LIMIT);
}

/** Only a cashier can be chosen; anyone else is shown, greyed, with why. */
export const canChoose = (candidate: LinkCandidate) => candidate.cashier;
export const disabledReason = (candidate: LinkCandidate) => (candidate.cashier ? null : NOT_A_CASHIER_MESSAGE);
/** The tag on an Employee who already has POS accounts. */
export const accountsTag = (candidate: LinkCandidate) => (candidate.accounts === 0 ? null : `Has ${candidate.accounts} POS ${candidate.accounts === 1 ? "account" : "accounts"}`);

export type LinkFormState = {
  /** The reason is asked for only when the chosen Employee already has an account. */
  reasonNeeded: boolean;
  reasonError: string | null;
  /** True when Link cashier may be pressed: a cashier is chosen, and the reason is given when it is needed. */
  canSubmit: boolean;
  /** What the server is sent as the reason: only when it is needed. */
  reason: string | null;
};

export const REASON_OPTIONS = [NEW_ACCOUNT_REASON] as const;

export function checkLinkForm(candidate: LinkCandidate | null, reason: string): LinkFormState {
  const reasonNeeded = candidate !== null && candidate.accounts > 0;
  const given = (REASON_OPTIONS as readonly string[]).includes(reason) ? reason : null;
  return {
    reasonNeeded, reasonError: reasonNeeded && given === null ? "Choose the reason." : null, reason: reasonNeeded ? given : null,
    canSubmit: candidate !== null && canChoose(candidate) && (!reasonNeeded || given !== null),
  };
}

/** The months the account's sales cover, as the Figma card shows them: "November 2026", or "October – November 2026" across months. */
export function monthsCovered(from: string, to: string): string {
  const names = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const name = (day: string) => names[Number(day.slice(5, 7)) - 1];
  if (from.slice(0, 7) === to.slice(0, 7)) return `${name(to)} ${to.slice(0, 4)}`;
  return from.slice(0, 4) === to.slice(0, 4) ? `${name(from)} – ${name(to)} ${to.slice(0, 4)}` : `${name(from)} ${from.slice(0, 4)} – ${name(to)} ${to.slice(0, 4)}`;
}

/**
 * The Add account dialog. The Employee is fixed (shown read-only) and already has a POS account, so the reason is always required; the picker offers only POS
 * accounts that are not linked to anyone (the Needs linking list), found by the Portal's name, staff number or branch, up to the same limit as the employee picker.
 */
export function filterAccounts(accounts: readonly PosAccountNeedingLink[], search: string): PosAccountNeedingLink[] {
  const needle = matchKey(search);
  const found = needle === "" ? [...accounts] : accounts.filter((a) => matchKey(`${a.name ?? ""} ${a.staffNumber ?? ""} ${a.branch ?? ""}`).includes(needle));
  return found.slice(0, PICKER_LIMIT);
}

export type AddAccountState = { reasonError: string | null; reason: string | null; canSubmit: boolean };

/** Add account needs a POS account chosen and the reason "New Portal account for the same person". */
export function checkAddForm(account: PosAccountNeedingLink | null, reason: string): AddAccountState {
  const given = (REASON_OPTIONS as readonly string[]).includes(reason) ? reason : null;
  return { reasonError: given === null ? "Choose the reason." : null, reason: given, canSubmit: account !== null && given !== null };
}
