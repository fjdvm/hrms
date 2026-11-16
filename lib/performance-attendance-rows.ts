import { isCalendarDate } from "./performance-calendar";
import { isAfter, isClockTime } from "./validators/time";

/**
 * Import-row validation for Performance, as pure functions: no database and no clock. They take normalised rows (employee
 * number, date, time-in, time-out) and the Employees the numbers can match, and say which rows are usable and why each of the
 * others is rejected. Turning a biometric file's punches into one in and one out per day is the parser's job, not this file's.
 *
 * A row is rejected, and never reaches scoring, when:
 *   unknown-employee-number  its employee number matches nobody;
 *   duplicate-in-batch       an earlier row in the same batch is for the same Employee and date (the first one is kept);
 *   invalid-date             its date is not a real "YYYY-MM-DD" date;
 *   invalid-time             its time-in is not "HH:MM", or its time-out is neither empty nor a later "HH:MM" than the time-in
 *                            (overnight punches are not supported, so a time-out before the time-in is invalid).
 * A time-in with no time-out is kept: it is a day to resolve, not a bad row.
 */

export type RawAttendanceRow = { employeeNumber: string; date: string; timeIn: string; timeOut: string | null };
export const REJECTION_REASONS = ["unknown-employee-number", "duplicate-in-batch", "invalid-date", "invalid-time"] as const;
export type RowRejection = (typeof REJECTION_REASONS)[number];

export type UsableRow = { row: number; employeeId: number; employeeNumber: string; date: string; timeIn: string; timeOut: string | null };
export type RejectedRow = { row: number; employeeNumber: string; reason: RowRejection; /** For a duplicate: the row that was kept. */ duplicateOf?: number };

export const MAX_BATCH_ROWS = 50_000;

/** An employee number as it is matched: spaces collapsed and trimmed, and case ignored. */
export const numberKey = (value: unknown) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().toLowerCase() : "");

export function validateRows(rows: readonly RawAttendanceRow[], employees: ReadonlyMap<string, { id: number; employeeNumber: string }>): { usable: UsableRow[]; rejected: RejectedRow[] } {
  const usable: UsableRow[] = [];
  const rejected: RejectedRow[] = [];
  const kept = new Map<string, number>();
  rows.forEach((raw, index) => {
    const row = index + 1;
    const given = (raw ?? {}) as Partial<Record<keyof RawAttendanceRow, unknown>>;
    const shown = typeof given.employeeNumber === "string" ? given.employeeNumber.trim().slice(0, 50) : "";
    const employee = employees.get(numberKey(given.employeeNumber));
    if (!employee) return void rejected.push({ row, employeeNumber: shown, reason: "unknown-employee-number" });
    if (!isCalendarDate(given.date)) return void rejected.push({ row, employeeNumber: employee.employeeNumber, reason: "invalid-date" });
    const timeOut = given.timeOut === null || given.timeOut === undefined || given.timeOut === "" ? null : given.timeOut;
    if (!isClockTime(given.timeIn) || (timeOut !== null && (!isClockTime(timeOut) || !isAfter(timeOut, given.timeIn)))) {
      return void rejected.push({ row, employeeNumber: employee.employeeNumber, reason: "invalid-time" });
    }
    const key = `${employee.id}|${given.date}`;
    const earlier = kept.get(key);
    if (earlier !== undefined) return void rejected.push({ row, employeeNumber: employee.employeeNumber, reason: "duplicate-in-batch", duplicateOf: earlier });
    kept.set(key, row);
    usable.push({ row, employeeId: employee.id, employeeNumber: employee.employeeNumber, date: given.date, timeIn: given.timeIn, timeOut });
  });
  return { usable, rejected };
}

export type Coverage = {
  /** True when the rows reach from the first expected day to the last. */
  covers: boolean;
  /** The first and last date among the rows inside the period, or null when there are none. */
  rowsFrom: string | null;
  rowsTo: string | null;
  /** The first and last day anyone is scheduled to work in the period; the rows should reach both. */
  expectedFrom: string;
  expectedTo: string;
  startsLate: boolean;
  endsEarly: boolean;
};

/** Whether rows cover a period: they must reach the first and the last day someone is scheduled to work. */
export function coverageOf(rowDates: readonly string[], expected: { from: string; to: string }): Coverage {
  const inside = rowDates.filter((date) => date >= expected.from && date <= expected.to).sort();
  const rowsFrom = inside[0] ?? null;
  const rowsTo = inside.at(-1) ?? null;
  const startsLate = rowsFrom === null || rowsFrom > expected.from;
  const endsEarly = rowsTo === null || rowsTo < expected.to;
  return { covers: !startsLate && !endsEarly, rowsFrom, rowsTo, expectedFrom: expected.from, expectedTo: expected.to, startsLate, endsEarly };
}
