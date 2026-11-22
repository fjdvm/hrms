import type { Database } from "./database";
import { cashierModule } from "./performance-cashier";
import type { Actor } from "./performance-kpis";
import { cleanMultiline, cleanText, hasDisallowedText } from "./validators/text";

/**
 * POS account links. One of the small domain modules behind the Performance interface; it takes the Staff member and the database
 * from the seam, so access is decided there.
 *
 * A POS account is a Portal user. HR links it to an Employee by hand. An Employee can hold several accounts over time and their sales
 * add up; an account belongs to at most one Employee at a time (the database enforces that). Only a cashier can be linked (#495), with
 * no override. An Employee who already has an active account needs the reason {@link NEW_ACCOUNT_REASON}. Unlinking needs a reason
 * and ends the link without deleting it; sales are read through the links that are active at the time, so an unlink removes that
 * account's sales from the Employee, past months included. Every link and unlink is written to `hrms_performance_audit` in the same
 * statement as the change.
 */

export const NEW_ACCOUNT_REASON = "New Portal account for the same person";
export const UNLINK_REASONS = ["Wrong person linked", "Linked to the wrong POS account", "Other"] as const;
export type UnlinkReason = (typeof UNLINK_REASONS)[number];
export const NOTE_MAX_LENGTH = 300;
export const NOT_A_CASHIER_MESSAGE = "Not a cashier position";

export type LinkProblem =
  | "unknown-employee" | "not-cashier" | "account-invalid" | "account-taken"
  | "reason-required" | "reason-not-needed" | "reason-invalid"
  | "unlink-reason-required" | "note-required" | "note-invalid" | "note-too-long" | "unknown-link" | "already-unlinked";

export class LinkError extends Error {
  /** `message` for a screen is {@link NOT_A_CASHIER_MESSAGE} for `not-cashier`; `employeeId` names who holds the account for `account-taken`. */
  constructor(public readonly problem: LinkProblem, public readonly extra: { heldBy?: number } = {}) {
    super(problem === "not-cashier" ? NOT_A_CASHIER_MESSAGE : `POS link: ${problem}`);
  }
}

export type PosAccountLink = {
  id: number; portalUserId: string; employeeId: number; linkedByName: string; linkedAt: string; linkReason: string | null;
  unlinkedByName: string | null; unlinkedAt: string | null; unlinkReason: UnlinkReason | null; unlinkNote: string | null;
};
/** A POS account for the Link dialog: the name from the Portal directory, or null with only the staff number and branch to go on. */
export type DescribedAccount = { portalUserId: string; name: string | null; staffNumber: string | null; branch: string | null };
export type Directory = () => Promise<{ id: string; name: string }[] | null>;

const ACCOUNT_ID = /^[A-Za-z0-9._:@-]{1,100}$/;
const COLUMNS = `id, portal_user_id AS "portalUserId", employee_id AS "employeeId", linked_by_name AS "linkedByName", linked_at::text AS "linkedAt", link_reason AS "linkReason",
  unlinked_by_name AS "unlinkedByName", unlinked_at::text AS "unlinkedAt", unlink_reason AS "unlinkReason", unlink_note AS "unlinkNote"`;
const isUniqueViolation = (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");

export function readAccountId(input: unknown): string {
  const id = typeof input === "string" ? cleanText(input) : "";
  if (!ACCOUNT_ID.test(id)) throw new LinkError("account-invalid");
  return id;
}
/** The link reason: absent, or exactly the one reason there is. Anything else is refused, not changed. */
export function readLinkReason(input: unknown): string | null {
  if (input === undefined || input === null || input === "") return null;
  if (typeof input !== "string" || cleanText(input) !== NEW_ACCOUNT_REASON) throw new LinkError("reason-invalid");
  return NEW_ACCOUNT_REASON;
}
export function readUnlinkReason(reason: unknown, note: unknown): { reason: UnlinkReason; note: string | null } {
  if (typeof reason !== "string" || !(UNLINK_REASONS as readonly string[]).includes(reason)) throw new LinkError("unlink-reason-required");
  const given = note === undefined || note === null ? "" : note;
  if (typeof given !== "string" || hasDisallowedText(given)) throw new LinkError("note-invalid");
  const cleaned = cleanMultiline(given);
  if (cleaned.length > NOTE_MAX_LENGTH) throw new LinkError("note-too-long");
  if (reason === "Other" && !cleaned) throw new LinkError("note-required");
  return { reason: reason as UnlinkReason, note: cleaned || null };
}

export function linksModule(db: Database, now: () => Date, directory: Directory) {
  const cashiers = cashierModule(db);
  /** Today's date in Manila, the date a link is judged on. */
  const today = () => now().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

  /** The accounts linked to one Employee now, oldest first. */
  async function accountsOf(employeeId: number): Promise<PosAccountLink[]> {
    return (await db.query<PosAccountLink>(`SELECT ${COLUMNS} FROM public.hrms_pos_account_links WHERE employee_id = $1 AND unlinked_at IS NULL ORDER BY linked_at, id`, [employeeId])).rows;
  }

  /** Every active link, for reading sales through them: the Employee each POS account counts for right now. */
  async function activeLinks(): Promise<Map<string, number>> {
    const { rows } = await db.query<{ portalUserId: string; employeeId: number }>(`SELECT portal_user_id AS "portalUserId", employee_id AS "employeeId" FROM public.hrms_pos_account_links WHERE unlinked_at IS NULL`);
    return new Map(rows.map((row) => [row.portalUserId, row.employeeId]));
  }

  /** Names POS accounts from the Portal directory. With no match (or no answer) a row carries the staff number and branch only. */
  async function describeAccounts(accounts: readonly { portalUserId: string; staffNumber?: string | null; branch?: string | null }[]): Promise<DescribedAccount[]> {
    const names = new Map((await directory().catch(() => null))?.map((member) => [member.id, member.name]) ?? []);
    return accounts.map((account) => ({ portalUserId: account.portalUserId, name: names.get(account.portalUserId) ?? null, staffNumber: account.staffNumber ?? null, branch: account.branch ?? null }));
  }

  async function linkAccount(actor: Actor, input: { employeeId: number; portalUserId: unknown; reason?: unknown }): Promise<PosAccountLink> {
    const accountId = readAccountId(input.portalUserId);
    const reason = readLinkReason(input.reason);
    const employee = Number.isInteger(input.employeeId) ? (await db.query<{ id: number; number: string }>(`SELECT id, employee_number AS number FROM public.hrms_employees WHERE id = $1`, [input.employeeId])).rows[0] : undefined;
    if (!employee) throw new LinkError("unknown-employee");
    if (!(await cashiers.isCashierOn(employee.id, today()))) throw new LinkError("not-cashier");

    const held = (await db.query<{ employeeId: number }>(`SELECT employee_id AS "employeeId" FROM public.hrms_pos_account_links WHERE portal_user_id = $1 AND unlinked_at IS NULL`, [accountId])).rows[0];
    if (held) throw new LinkError("account-taken", { heldBy: held.employeeId });
    const hasAccount = (await accountsOf(employee.id)).length > 0;
    if (hasAccount && !reason) throw new LinkError("reason-required");
    if (!hasAccount && reason) throw new LinkError("reason-not-needed");

    try {
      // One statement: the link and its audit row. The reason must still match whether the Employee has an account at this moment, so
      // two links made at once cannot both skip the reason.
      const { rows } = await db.query<PosAccountLink>(`
        WITH linked AS (
          INSERT INTO public.hrms_pos_account_links (portal_user_id, employee_id, linked_by_id, linked_by_name, link_reason)
          SELECT $1, $2, $3, $4, $5::text
          WHERE ($5::text IS NOT NULL) = EXISTS (SELECT 1 FROM public.hrms_pos_account_links WHERE employee_id = $2 AND unlinked_at IS NULL)
          RETURNING *
        ), logged AS (
          INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
          SELECT $3, $4, 'pos-account-linked', 'employee', employee_id::text,
            jsonb_build_object('linkId', id, 'employeeId', employee_id, 'employeeNumber', $6::text, 'portalUserId', portal_user_id, 'reason', link_reason) FROM linked
        ) SELECT ${COLUMNS} FROM linked`, [accountId, employee.id, actor.id, actor.name, reason, employee.number]);
      if (!rows[0]) throw new LinkError(hasAccount ? "reason-required" : "reason-not-needed");
      return rows[0];
    } catch (error) {
      if (isUniqueViolation(error)) {
        const owner = (await db.query<{ employeeId: number }>(`SELECT employee_id AS "employeeId" FROM public.hrms_pos_account_links WHERE portal_user_id = $1 AND unlinked_at IS NULL`, [accountId])).rows[0];
        throw new LinkError("account-taken", { heldBy: owner?.employeeId });
      }
      throw error;
    }
  }

  async function unlinkAccount(actor: Actor, linkId: number, input: { reason: unknown; note?: unknown }): Promise<PosAccountLink> {
    const { reason, note } = readUnlinkReason(input.reason, input.note);
    if (!Number.isInteger(linkId) || linkId < 1 || linkId > 2147483647) throw new LinkError("unknown-link");
    const { rows } = await db.query<PosAccountLink>(`
      WITH ended AS (
        UPDATE public.hrms_pos_account_links SET unlinked_at = clock_timestamp(), unlinked_by_id = $2, unlinked_by_name = $3, unlink_reason = $4, unlink_note = $5
        WHERE id = $1 AND unlinked_at IS NULL RETURNING *
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $2, $3, 'pos-account-unlinked', 'employee', employee_id::text,
          jsonb_build_object('linkId', id, 'employeeId', employee_id, 'employeeNumber', (SELECT employee_number FROM public.hrms_employees WHERE id = ended.employee_id), 'portalUserId', portal_user_id, 'reason', unlink_reason, 'note', unlink_note) FROM ended
      ) SELECT ${COLUMNS} FROM ended`, [linkId, actor.id, actor.name, reason, note]);
    if (rows[0]) return rows[0];
    const existing = (await db.query<{ id: number }>(`SELECT id FROM public.hrms_pos_account_links WHERE id = $1`, [linkId])).rows[0];
    throw new LinkError(existing ? "already-unlinked" : "unknown-link");
  }

  return { accountsOf, activeLinks, describeAccounts, linkAccount, unlinkAccount };
}
