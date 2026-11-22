import type { TopSales, TopSalesRow } from "./performance-top-sales";

/**
 * What the Top sales card says and shows, as plain functions of the read model: month choices and labels, money, initials, the wording of
 * the notes. No component logic lives here, so the wording is tested without rendering.
 */

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const PESO = new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" });

/** How many months the selector offers, the current one first. */
export const MONTH_CHOICES = 12;

export type SalesMonth = { year: number; month: number; value: string; label: string };

const monthOf = (year: number, month: number): SalesMonth => ({ year, month, value: `${year}-${String(month).padStart(2, "0")}`, label: `${MONTHS[month - 1]} ${year}` });

/** The month holding `today` (a YYYY-MM-DD Manila date), then the months before it, latest first. */
export function monthChoices(today: string): SalesMonth[] {
  const [year, month] = today.split("-").map(Number);
  return Array.from({ length: MONTH_CHOICES }, (_, back) => {
    const index = year * 12 + (month - 1) - back;
    return monthOf(Math.floor(index / 12), (index % 12) + 1);
  });
}

/** The month asked for when it is one of the choices; otherwise the current month. */
export function pickSalesMonth(today: string, requested?: string | null): SalesMonth {
  const choices = monthChoices(today);
  const match = requested && MONTH_PATTERN.test(requested) ? choices.find((choice) => choice.value === requested) : undefined;
  return match ?? choices[0];
}

/** The link that opens the Performance page on a Top sales month, keeping the Evaluation period that is open. */
export function salesMonthHref(month: string, period?: string | null): string {
  const query = new URLSearchParams();
  if (period) query.set("period", period);
  query.set("salesMonth", month);
  return `/performance?${query.toString()}`;
}

export const pesos = (amount: number) => PESO.format(amount);

/** Net sales for one present day, or null when the Employee has no present day on record. */
export const perPresentDay = (row: Pick<TopSalesRow, "netSales" | "presentDays">) => (row.presentDays > 0 ? row.netSales / row.presentDays : null);

export const presentDaysText = (days: number) => (days === 0 ? "Not imported" : `${days} ${days === 1 ? "day" : "days"}`);

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** The branches the top seller sold at, as the panel's line under the net sales. */
export function soldAtText(data: TopSales, seller: TopSalesRow): string {
  const branches = data.branches.filter((branch) => branch.ranking.some((row) => row.employeeId === seller.employeeId)).map((branch) => branch.branch);
  if (branches.length === 0) return "";
  return branches.length === 1 ? `Sold at ${branches[0]}` : `Sold at ${branches.length} branches`;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The footer note: why the month is Provisional (when it is) and how many staff with sales are not shown. */
export function footerNote(data: TopSales): string {
  const [year, month] = data.month.split("-").map(Number);
  const next = month === 12 ? monthOf(year + 1, 1) : monthOf(year, month + 1);
  const shown = monthOf(year, month);
  const hidden = data.notShown.unlinkedAccounts + data.notShown.notCashiers;
  const provisional = data.provisional
    ? `Provisional until an import run in ${MONTHS[next.month - 1]} has re-read ${shown.label.split(" ")[0]}, because voids and refunds can change totals. `
    : "";
  const left = hidden === 0
    ? "No staff with POS sales are left out."
    : `${plural(hidden, "staff member", "staff members")} with POS sales ${hidden === 1 ? "is" : "are"} not shown: not linked to an employee or not a cashier position.`;
  return provisional + left;
}

export const EMPTY_NOTE = "Only linked cashiers whose position carries the sales KPI are ranked. Set cashier positions in KPI setup and link POS accounts to employees.";

/** True when there is nothing to rank for the month. */
export const isEmpty = (data: TopSales) => data.overall.length === 0 && data.branches.length === 0;

/** The Empty frame's title: no sales at all, or sales that belong to nobody who can be ranked. */
export const emptyTitle = (data: TopSales, label: string) =>
  data.notShown.unlinkedAccounts + data.notShown.notCashiers === 0 ? `No POS sales imported for ${label} yet` : `No cashier sales to rank for ${label}`;
