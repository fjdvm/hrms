import { PosReadError } from "./pos-connection";
import type { RawLeftOutRow, RawLocationRow, RawSalesRow } from "./pos-sales-query";

/**
 * Validates what the POS returned, strictly. A row with an unexpected shape (a missing or extra field, the wrong kind of value, a day
 * outside the range read, a negative order count) is rejected as "POS data changed", never stored or repaired.
 */

/** One cashier's figures for one branch and Manila business day. Amounts are in pesos; net sales can be negative on a refund day. */
export type PosSalesDay = { portalUserId: string; staffId: number; locationId: number; businessDate: string; orders: number; grossSales: number; refundAmount: number; netSales: number };
export type PosLocation = { locationId: number; name: string; type: string; isActive: boolean };

const SALES_KEYS = ["businessDate", "grossSales", "locationId", "netSales", "orders", "portalUserId", "refundAmount", "staffId"];
const LOCATION_KEYS = ["isActive", "locationId", "name", "type"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d{1,15}(\.\d{1,6})?$/;
const reject = (what: string): never => { throw new PosReadError("data-changed", [what]); };

const sameKeys = (row: Record<string, unknown>, keys: readonly string[]) => {
  const given = Object.keys(row).sort();
  return given.length === keys.length && given.every((key, index) => key === keys[index]);
};
function integer(value: unknown, what: string, min = 0): number {
  const n = typeof value === "number" ? value : typeof value === "string" && /^-?\d{1,15}$/.test(value) ? Number(value) : NaN;
  return Number.isSafeInteger(n) && n >= min ? n : reject(`unexpected ${what}`);
}
function money(value: unknown, what: string): number {
  const n = typeof value === "string" && DECIMAL.test(value) ? Number(value) : typeof value === "number" && Number.isFinite(value) ? value : NaN;
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : reject(`unexpected ${what}`);
}
function text(value: unknown, what: string, max: number): string {
  return typeof value === "string" && value.trim() !== "" && value.length <= max ? value : reject(`unexpected ${what}`);
}

export function mapSales(rows: readonly RawSalesRow[], range: { from: string; to: string }): PosSalesDay[] {
  return rows.map((row) => {
    if (!sameKeys(row, SALES_KEYS)) reject("unexpected sales row shape");
    const businessDate = text(row.businessDate, "business date", 10);
    if (!DAY.test(businessDate) || businessDate < range.from || businessDate > range.to) reject("unexpected business date");
    const day: PosSalesDay = {
      portalUserId: text(row.portalUserId, "account id", 100), staffId: integer(row.staffId, "staff number", 1000), locationId: integer(row.locationId, "branch", 0),
      businessDate, orders: integer(row.orders, "order count"), grossSales: money(row.grossSales, "gross sales"), refundAmount: money(row.refundAmount, "refund amount"), netSales: money(row.netSales, "net sales"),
    };
    if (day.grossSales < 0 || day.refundAmount < 0) reject("unexpected negative amount");
    if (Math.abs(day.grossSales - day.refundAmount - day.netSales) > 0.005) reject("net sales do not add up");
    return day;
  });
}

export function mapLocations(rows: readonly RawLocationRow[]): PosLocation[] {
  return rows.map((row) => {
    if (!sameKeys(row, LOCATION_KEYS)) reject("unexpected branch row shape");
    if (typeof row.isActive !== "boolean") reject("unexpected branch status");
    return { locationId: integer(row.locationId, "branch", 0), name: text(row.name, "branch name", 200), type: text(row.type, "branch type", 50), isActive: row.isActive as boolean };
  });
}

export type PosLeftOut = { orders: number; grossSales: number };

export function mapLeftOut(rows: readonly RawLeftOutRow[]): PosLeftOut {
  if (rows.length !== 1 || !sameKeys(rows[0], ["gross", "orders"])) reject("unexpected left-out row shape");
  const row = rows[0];
  const day = { orders: integer(row.orders, "left-out order count"), grossSales: money(row.gross, "left-out sales") };
  return day.grossSales < 0 ? reject("unexpected negative amount") : day;
}
