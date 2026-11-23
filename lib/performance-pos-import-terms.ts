/**
 * What the Import POS sales dialog and its service share, with no server code, so the dialog (a client component) can use it: the two
 * months a run reads, the problems it can end in, and the words for months, days, pesos and times as the Figma frames show them.
 */

export type ImportProblem = "go-live-not-set" | "go-live-not-reached" | "pos-unreachable" | "pos-data-changed" | "pos-not-configured";

export class ImportError extends Error {
  /** `problems` lists what changed in the POS data (table and column names only) for "pos-data-changed". */
  constructor(public readonly problem: ImportProblem, public readonly problems: readonly string[] = []) {
    super(`POS import: ${problem}`);
  }
}

const iso = (date: Date) => date.toISOString().slice(0, 10);

/** The Manila days to read: from the first of the previous month (not before the go-live date) to the end of the current month. */
export function importRange(goLive: string | null, today: string): { from: string; to: string } {
  if (!goLive) throw new ImportError("go-live-not-set");
  const [year, month] = today.split("-").map(Number);
  const from = iso(new Date(Date.UTC(year, month - 2, 1)));
  const to = iso(new Date(Date.UTC(year, month, 0)));
  if (goLive > to) throw new ImportError("go-live-not-reached");
  return { from: from < goLive ? goLive : from, to };
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = MONTH_NAMES.map((name) => name.slice(0, 3));

/** "2026-11" or "2026-11-30" as "November 2026". */
export const monthLabel = (value: string) => `${MONTH_NAMES[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`;
/** "2026-11-30" as "30 Nov 2026". */
export const dayLabel = (day: string) => `${Number(day.slice(8, 10))} ${SHORT[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`;

export type ImportMonth = { key: string; label: string; current: boolean; from: string; to: string };

/** The one or two months a run reads, newest first, each with the days of it that are read (the go-live date can cut the earlier one short). */
export function importMonths(range: { from: string; to: string }): ImportMonth[] {
  const current = range.to.slice(0, 7);
  const months: ImportMonth[] = [{ key: current, label: monthLabel(current), current: true, from: `${current}-01` > range.from ? `${current}-01` : range.from, to: range.to }];
  if (range.from.slice(0, 7) < current) months.push({ key: range.from.slice(0, 7), label: monthLabel(range.from), current: false, from: range.from, to: new Date(Date.UTC(Number(current.slice(0, 4)), Number(current.slice(5, 7)) - 1, 0)).toISOString().slice(0, 10) });
  return months;
}

/** "1 – 30 Nov 2026" for the days of a month that are read. */
export const dayRangeLabel = (from: string, to: string) => `${Number(from.slice(8, 10))} – ${dayLabel(to)}`;

/** "₱663,560.50", and "−₱300.00" for a negative figure. */
export function pesos(amount: number): string {
  const text = `₱${Math.abs(amount).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return amount < 0 ? `−${text}` : text;
}

/** "22 Nov 2026, 3:10 PM" in Manila time, for the last attempt. */
export function attemptLabel(at: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(at));
  return parts.replace(/\b(am|pm)\b/, (value) => value.toUpperCase());
}
