/**
 * The date rules of Performance, as pure functions over "YYYY-MM-DD" strings: what a Month or a Quarter covers, how a
 * period is named, and which days an Employee is scheduled to work in it. No database and no clock; dates are calendar
 * dates (Manila time is the company's calendar), so weekdays are worked out from the date itself and never shift.
 *
 * Scheduled days. The dates in the period, counted from the later of the period's start and the Employee's start date,
 * that fall on the Employee's Working days, minus the company's non-working dates. Excused days are not taken off here:
 * they are recorded per Employee and period and subtracted when the score is worked out.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

const utc = (date: string) => {
  const match = DAY.exec(date);
  if (!match) throw new RangeError(`Not a date: ${date}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};
const text = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** True for a real calendar date written "YYYY-MM-DD" (so 2026-02-30 is not one). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DAY.test(value)) return false;
  return text(utc(value)) === value;
}

/** ISO weekday: 1 = Monday ... 7 = Sunday. */
export const isoWeekday = (date: string) => ((new Date(utc(date)).getUTCDay() + 6) % 7) + 1;

/** Days from `from` to `to`, both counted: the same day is 1. */
export const daySpan = (from: string, to: string) => Math.round((utc(to) - utc(from)) / MS_PER_DAY) + 1;

/** Every date from `from` to `to`, both included, in order. Empty when `to` is before `from`. */
export function eachDay(from: string, to: string): string[] {
  const days: string[] = [];
  for (let ms = utc(from); ms <= utc(to); ms += MS_PER_DAY) days.push(text(ms));
  return days;
}

/** The first and last date of a calendar month (month 1 to 12). */
export function monthRange(year: number, month: number): { start: string; end: string } {
  return { start: text(Date.UTC(year, month - 1, 1)), end: text(Date.UTC(year, month, 0)) };
}

/** The first and last date of a calendar quarter (quarter 1 to 4: January to March, and so on). */
export function quarterRange(year: number, quarter: number): { start: string; end: string } {
  return { start: text(Date.UTC(year, (quarter - 1) * 3, 1)), end: text(Date.UTC(year, quarter * 3, 0)) };
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map((month) => month.slice(0, 3));
const shortDate = (date: string) => `${Number(date.slice(8, 10))} ${SHORT_MONTHS[Number(date.slice(5, 7)) - 1]}`;

/** "November 2026", "Q4 2026", or "3 Nov – 20 Dec 2026" (with the year on both ends when it differs). */
export function periodName(period: { type: "Month" | "Quarter" | "Custom"; start: string; end: string }): string {
  const year = period.start.slice(0, 4);
  if (period.type === "Month") return `${MONTHS[Number(period.start.slice(5, 7)) - 1]} ${year}`;
  if (period.type === "Quarter") return `Q${Math.floor((Number(period.start.slice(5, 7)) - 1) / 3) + 1} ${year}`;
  return year === period.end.slice(0, 4) ? `${shortDate(period.start)} – ${shortDate(period.end)} ${year}` : `${shortDate(period.start)} ${year} – ${shortDate(period.end)} ${period.end.slice(0, 4)}`;
}

export type ScheduleInput = {
  periodStart: string;
  periodEnd: string;
  /** The Employee's start date; days before it are not scheduled, so a mid-period joiner is scored fairly. */
  employeeStart: string;
  /** ISO weekdays the Employee works, 1 = Monday ... 7 = Sunday. */
  workingDays: readonly number[];
  /** The company calendar's non-working dates; only those that fall in the period matter. */
  nonWorkingDates: readonly string[];
};

/** The dates the Employee is scheduled to work in the period, in order. */
export function scheduledDays(input: ScheduleInput): string[] {
  const from = input.employeeStart > input.periodStart ? input.employeeStart : input.periodStart;
  const off = new Set(input.nonWorkingDates);
  const working = new Set(input.workingDays);
  return eachDay(from, input.periodEnd).filter((day) => working.has(isoWeekday(day)) && !off.has(day));
}
