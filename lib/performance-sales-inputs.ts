import type { Database } from "./database";
import type { Actor } from "./performance-kpis";
import type { SalesInput } from "./performance-sales-scoring";
import { POS_GO_LIVE_KEY } from "./performance-pos-settings";

/**
 * What the sales KPI is scored from, read for one Employee and period, and the company-wide sales target. One of the small domain modules
 * behind the Performance interface. The scoring itself is the pure function in `performance-sales-scoring.ts`.
 *
 * Net sales are the stored POS figures (`hrms_pos_sales_daily`) for the Employee's active POS account links, summed over every branch for
 * the days of the period. Links are read when the figures are read, so an unlink removes an account's sales from the Employee and a later
 * link repairs history; a submitted Evaluation keeps what it was saved with, and a reopened one reads the links as they are then.
 */

export const SALES_KPI_ID = "sales";
export type SalesPeriod = { start: string; end: string };

export type SalesTargetProblem = "target-invalid";
export class SalesTargetError extends Error {
  constructor(public readonly problem: SalesTargetProblem) {
    super(`Sales target: ${problem}`);
  }
}
export const SALES_TARGET_MAX = 10_000_000;

/** The target in pesos per present day: more than 0, at most {@link SALES_TARGET_MAX}, to the centavo. */
export function readSalesTarget(input: unknown): number {
  const value = typeof input === "number" ? input : typeof input === "string" && /^\d{1,8}(\.\d{1,2})?$/.test(input.trim()) ? Number(input) : NaN;
  const centavos = Math.round(value * 100);
  if (!Number.isFinite(value) || value <= 0 || value > SALES_TARGET_MAX || Math.abs(value * 100 - centavos) > 1e-6) throw new SalesTargetError("target-invalid");
  return centavos / 100;
}

const pesos = (amount: number) => `₱${amount.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} net sales per present day`;

export function salesInputsModule(db: Database) {
  /** The company-wide target in pesos, or null while it is not set. */
  async function target(): Promise<number | null> {
    const { rows } = await db.query<{ amount: string | null }>(`SELECT target_amount::text AS amount FROM public.hrms_kpis WHERE id = $1`, [SALES_KPI_ID]);
    return rows[0]?.amount == null ? null : Number(rows[0].amount);
  }

  /**
   * Sets the one company-wide target. The change, its display text on the KPI and its audit row are one statement; setting the same
   * amount again changes and records nothing.
   */
  async function setTarget(actor: Actor, input: unknown): Promise<number> {
    const amount = readSalesTarget(input);
    await db.query(`
      WITH previous AS (SELECT target_amount FROM public.hrms_kpis WHERE id = $1), changed AS (
        UPDATE public.hrms_kpis SET target_amount = $2::numeric, target = $3, updated_by_id = $4, updated_by_name = $5, updated_at = clock_timestamp()
        WHERE id = $1 AND target_amount IS DISTINCT FROM $2::numeric RETURNING target_amount
      ) INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $4, $5, 'sales-target-set', 'kpi', $1, jsonb_build_object('from', (SELECT target_amount FROM previous), 'to', changed.target_amount) FROM changed`,
    [SALES_KPI_ID, amount, pesos(amount), actor.id, actor.name]);
    return (await target())!;
  }

  /**
   * The figures to score for one Employee and period, or the reason there is nothing to score, checked in this order: no linked account, the
   * period starts before the go-live date (or none is set), no POS import ran after the period ended (by Manila date), no target is set.
   * The present-day minimum is applied by the scoring function, which knows the present days.
   */
  async function inputsFor(employeeId: number, period: SalesPeriod, frozenTarget?: number | null): Promise<SalesInput> {
    const accounts = (await db.query<{ id: string }>(`SELECT portal_user_id AS id FROM public.hrms_pos_account_links WHERE employee_id = $1 AND unlinked_at IS NULL`, [employeeId])).rows.map((row) => row.id);
    if (accounts.length === 0) return { status: "not-applicable", reason: "no-linked-account" };
    const goLive = (await db.query<{ value: string }>(`SELECT value FROM public.hrms_performance_settings WHERE key = $1`, [POS_GO_LIVE_KEY])).rows[0]?.value;
    if (!goLive || period.start < goLive) return { status: "not-applicable", reason: "before-go-live" };
    const imported = (await db.query<{ ran: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM public.hrms_pos_imports WHERE (imported_at AT TIME ZONE 'Asia/Manila')::date > $1::date) AS ran`, [period.end])).rows[0].ran;
    if (!imported) return { status: "not-applicable", reason: "no-import-after-period" };
    const goal = frozenTarget === undefined ? await target() : frozenTarget;
    if (goal === null || goal <= 0) return { status: "not-applicable", reason: "no-target" };
    const sum = (await db.query<{ net: string | null }>(
      `SELECT sum(net_sales)::text AS net FROM public.hrms_pos_sales_daily WHERE portal_user_id = ANY($1::text[]) AND business_date BETWEEN $2::date AND $3::date`, [accounts, period.start, period.end])).rows[0].net;
    // A present day with no orders is zero sales, so no stored figures at all is a net of 0, not a missing KPI.
    return { status: "ready", netSales: sum === null ? 0 : Number(sum), target: goal };
  }

  return { target, setTarget, inputsFor };
}
