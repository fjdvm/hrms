/**
 * The sales KPI as a pure function: no database, no clock, no imports, so every rule can be checked with hand-computed examples.
 *
 * Sales per present day. The Employee's net sales in the period (across all their linked POS accounts and all branches) divided by their
 * present days from the attendance import, as a percentage of one company-wide target, capped at 100. Negative net sales score 0. A
 * present day with no orders counts as zero sales, so it lowers the average rather than leaving the day out.
 *
 * Not applicable, never a 0: no linked account, the period starts before the POS go-live date, no POS import ran after the period ended,
 * fewer than {@link SALES_MIN_PRESENT_DAYS} present days (a placeholder until HR confirms it), or no target is set. The first three and the
 * target are facts about the data (the inputs module decides them); the present-day minimum is applied here, where present days are known.
 */

export const SALES_MIN_PRESENT_DAYS = 5;

/** A placeholder pending HR: with this many present days or more and no POS orders at all, the evaluation warns that the link may be wrong. */
export const SALES_NO_ORDERS_WARNING_DAYS = 10;

export const SALES_FORMULA =
  `Net sales in the period (all of the Employee's linked POS accounts, all branches) ÷ present days, as a percentage of the company-wide sales target, capped at 100. ` +
  `Negative net sales score 0. Not applicable when the Employee has no linked POS account, the period starts before the POS go-live date, ` +
  `no POS import ran after the period ended, there are fewer than ${SALES_MIN_PRESENT_DAYS} present days, or no target is set.`;

export type SalesReason = "no-linked-account" | "before-go-live" | "no-import-after-period" | "no-target" | "too-few-present-days";

/** What the inputs module found for one Employee and period: the figures to score, or why there is nothing to score. */
export type SalesInput =
  | { status: "ready"; netSales: number; target: number; /** The POS orders behind the net sales, for the evaluation page; scoring does not use it. */ orders?: number }
  | { status: "not-applicable"; reason: Exclude<SalesReason, "too-few-present-days"> };

export type SalesScore = { result: number } | { reason: SalesReason };

/** Scores the sales KPI from 0 to 100, or says why it is Not applicable. `minPresentDays` defaults to the placeholder; a reopened evaluation passes the one it was first submitted with. */
export function scoreSales(input: SalesInput, presentDays: number, minPresentDays: number = SALES_MIN_PRESENT_DAYS): SalesScore {
  if (input.status === "not-applicable") return { reason: input.reason };
  if (!(Number.isFinite(input.target) && input.target > 0)) throw new RangeError("The sales target is more than zero.");
  if (!Number.isFinite(input.netSales)) throw new RangeError("Net sales is a number.");
  if (!(Number.isInteger(presentDays) && presentDays >= 0)) throw new RangeError("Present days is a whole number, zero or more.");
  if (presentDays < minPresentDays || presentDays === 0) return { reason: "too-few-present-days" };
  const perDay = input.netSales / presentDays;
  return { result: perDay <= 0 ? 0 : Math.min(100, (perDay / input.target) * 100) };
}
