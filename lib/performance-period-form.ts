import { isoWeekday, monthRange, periodName, quarterRange } from "./performance-calendar";
import { DEFAULT_GRACE_MINUTES, MAX_GRACE_MINUTES, type Period, type PeriodType } from "./performance-periods";

/**
 * What the Set up evaluation period dialog works out before anything is sent: the dates a Month, Quarter or Custom choice covers,
 * which existing period it would overlap, how many non-working dates fall in it, and whether the grace period is whole minutes.
 * Pure functions over "YYYY-MM-DD" strings; the server repeats every check.
 */

export type DateRange = { start: string; end: string };
export type PeriodChoice = { key: string; name: string; range: DateRange };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const day = (date: string) => String(Number(date.slice(8, 10)));
const month = (date: string) => MONTHS[Number(date.slice(5, 7)) - 1];

/** "1 – 30 Nov 2026", "1 Oct – 31 Dec 2026", or "1 Dec 2026 – 31 Jan 2027". */
export function rangeLabel({ start, end }: DateRange): string {
  if (start.slice(0, 7) === end.slice(0, 7)) return `${day(start)} – ${day(end)} ${month(end)} ${end.slice(0, 4)}`;
  if (start.slice(0, 4) === end.slice(0, 4)) return `${day(start)} ${month(start)} – ${day(end)} ${month(end)} ${end.slice(0, 4)}`;
  return `${day(start)} ${month(start)} ${start.slice(0, 4)} – ${day(end)} ${month(end)} ${end.slice(0, 4)}`;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** "Mon 30 Nov 2026", or "Mon 30 Nov" with `withYear` false. */
export const dateLabel = (date: string, withYear = true) => `${WEEKDAYS[isoWeekday(date) - 1]} ${day(date)} ${month(date)}${withYear ? ` ${date.slice(0, 4)}` : ""}`;

/** The company-wide periods a date falls in, so HR sees which evaluations a non-working date changes. */
export const periodsHolding = <P extends Pick<Period, "start" | "end" | "kind">>(date: string, periods: readonly P[]) => periods.filter((period) => period.kind === "Company" && period.start <= date && period.end >= date);

const MONTHS_BEFORE = 6;
const MONTHS_AFTER = 12;
const QUARTERS_BEFORE = 2;
const QUARTERS_AFTER = 6;

/** The months HR can pick, from six months back to a year ahead of `today` (Manila "YYYY-MM-DD"), in date order. */
export function monthChoices(today: string): PeriodChoice[] {
  const base = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1;
  return Array.from({ length: MONTHS_BEFORE + MONTHS_AFTER + 1 }, (_, i) => {
    const index = base - MONTHS_BEFORE + i;
    const range = monthRange(Math.floor(index / 12), (index % 12) + 1);
    return { key: range.start, name: periodName({ type: "Month", ...range }), range };
  });
}

/** The quarters HR can pick, from two quarters back to six ahead of `today`, in date order. */
export function quarterChoices(today: string): PeriodChoice[] {
  const base = Number(today.slice(0, 4)) * 4 + Math.floor((Number(today.slice(5, 7)) - 1) / 3);
  return Array.from({ length: QUARTERS_BEFORE + QUARTERS_AFTER + 1 }, (_, i) => {
    const index = base - QUARTERS_BEFORE + i;
    const range = quarterRange(Math.floor(index / 4), (index % 4) + 1);
    return { key: range.start, name: periodName({ type: "Quarter", ...range }), range };
  });
}

/** The first existing company-wide period that shares a day with the range, if any. */
export function findOverlap(range: DateRange | null, periods: readonly Pick<Period, "start" | "end" | "name" | "kind">[]) {
  if (!range) return undefined;
  return periods.find((period) => period.kind === "Company" && period.start <= range.end && period.end >= range.start);
}

/** How many non-working dates fall inside the range, both ends included. */
export const countNonWorking = (range: DateRange | null, dates: readonly string[]) => (range ? dates.filter((date) => date >= range.start && date <= range.end).length : 0);

export const nonWorkingText = (count: number) => `${count} non-working ${count === 1 ? "date" : "dates"} in this period`;

export { DEFAULT_GRACE_MINUTES, MAX_GRACE_MINUTES };

/** The grace period field: whole minutes only, from 0 to the maximum. Anything else is refused with a message, never quietly changed. */
export function readGrace(text: string): { minutes: number | null; error: string | null } {
  const cleaned = text.trim();
  if (cleaned === "") return { minutes: null, error: "Enter the grace period in whole minutes." };
  if (!/^\d+$/.test(cleaned)) return { minutes: null, error: "Grace period can only be whole minutes, digits only." };
  const minutes = Number(cleaned);
  if (minutes > MAX_GRACE_MINUTES) return { minutes: null, error: `Grace period is at most ${MAX_GRACE_MINUTES} minutes.` };
  return { minutes, error: null };
}

export type { PeriodType };
