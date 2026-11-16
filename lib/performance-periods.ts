import type { Database } from "./database";
import { daySpan, isCalendarDate, monthRange, periodName, quarterRange, scheduledDays } from "./performance-calendar";
import { cleanText, hasControlCharacters, nameProblem } from "./validators/text";
import type { Actor } from "./performance-kpis";

/**
 * Evaluation periods, the company calendar of non-working dates, excused days, and an Employee's scheduled days. One of
 * the small domain modules behind the Performance interface; it takes the Staff member and the database from the seam,
 * so access is decided there. The date rules themselves are pure functions in `performance-calendar.ts`.
 *
 * A period is company-wide, of type Month, Quarter or Custom, with a grace period in whole minutes (10 by default). No
 * two periods overlap by date, and there is no open or closed state. The company calendar is one list for the whole
 * company, applied to every period a date falls in. An Employee with no shift has no scheduled days and is reported as
 * not scorable, never as zero.
 */

export type PeriodType = "Month" | "Quarter" | "Custom";
export type Period = { id: number; type: PeriodType; kind: "Company" | "Employee"; employeeId: number | null; start: string; end: string; graceMinutes: number; name: string; createdByName: string };
export type CalendarType = "Holiday" | "Closure" | "Other";
export type CalendarEntry = { id: number; date: string; name: string; type: CalendarType; notes: string | null; addedByName: string };

export type OpenPeriodInput =
  | { type: "Month"; year: number; month: number; graceMinutes?: number }
  | { type: "Quarter"; year: number; quarter: number; graceMinutes?: number }
  | { type: "Custom"; start: string; end: string; graceMinutes?: number };
export type CalendarInput = { date: string; name: string; type: string; notes?: string | null };

export type PeriodProblem =
  | "type-invalid" | "year-invalid" | "dates-invalid" | "end-before-start" | "range-too-long" | "grace-invalid" | "overlap"
  | "date-invalid" | "name-empty" | "name-too-long" | "name-characters" | "calendar-type-invalid" | "notes-invalid" | "date-taken"
  | "unknown-period" | "unknown-employee" | "day-outside-period";

export class PeriodError extends Error {
  /** `overlaps` names the period an overlapping one runs into; `existing` names the calendar entry that already has the date. */
  constructor(public readonly problem: PeriodProblem, public readonly extra: { overlaps?: { id: number; name: string }; existing?: string } = {}) {
    super(`Period: ${problem}`);
  }
}

export type Schedule =
  | { scorable: true; scheduledDays: string[]; excusedDays: string[] }
  | { scorable: false; reason: "no-shift" };

export const DEFAULT_GRACE_MINUTES = 10;
export const MAX_GRACE_MINUTES = 120;
/** A Custom range covers at most a year; it keeps a mistyped end date from scheduling decades of days. */
export const MAX_CUSTOM_DAYS = 366;
export const CALENDAR_TYPES: readonly CalendarType[] = ["Holiday", "Closure", "Other"];
export const NAME_MAX_LENGTH = 100;
export const NOTES_MAX_LENGTH = 500;
export const MAX_EXCUSED_DAYS_PER_REQUEST = 366;
const YEAR_MIN = 2000;
const YEAR_MAX = 2100;

const validYear = (year: unknown): year is number => Number.isInteger(year) && (year as number) >= YEAR_MIN && (year as number) <= YEAR_MAX;
const validId = (id: unknown): id is number => Number.isInteger(id) && (id as number) >= 1 && (id as number) <= 2147483647;
const inYears = (date: string) => Number(date.slice(0, 4)) >= YEAR_MIN && Number(date.slice(0, 4)) <= YEAR_MAX;
const isCode = (error: unknown, code: string) => Boolean(error && typeof error === "object" && "code" in error && error.code === code);

type PeriodRow = { id: number; type: PeriodType; kind: "Company" | "Employee"; employeeId: number | null; start: string; end: string; graceMinutes: number; createdByName: string };
const PERIOD_COLUMNS = `id, type, kind, employee_id AS "employeeId", start_date::text AS start, end_date::text AS "end", grace_minutes AS "graceMinutes", created_by_name AS "createdByName"`;
const toPeriod = (row: PeriodRow): Period => ({ ...row, name: periodName(row) });

/** Reads and checks what a Month, Quarter or Custom period covers, from untrusted input. */
export function readPeriod(input: OpenPeriodInput): { type: PeriodType; start: string; end: string; graceMinutes: number } {
  const given = (input ?? {}) as Record<string, unknown>;
  const graceMinutes = given.graceMinutes === undefined ? DEFAULT_GRACE_MINUTES : given.graceMinutes;
  if (!Number.isInteger(graceMinutes) || (graceMinutes as number) < 0 || (graceMinutes as number) > MAX_GRACE_MINUTES) throw new PeriodError("grace-invalid");
  const grace = graceMinutes as number;
  if (given.type === "Month") {
    if (!validYear(given.year) || !Number.isInteger(given.month) || (given.month as number) < 1 || (given.month as number) > 12) throw new PeriodError("year-invalid");
    return { type: "Month", ...monthRange(given.year, given.month as number), graceMinutes: grace };
  }
  if (given.type === "Quarter") {
    if (!validYear(given.year) || !Number.isInteger(given.quarter) || (given.quarter as number) < 1 || (given.quarter as number) > 4) throw new PeriodError("year-invalid");
    return { type: "Quarter", ...quarterRange(given.year, given.quarter as number), graceMinutes: grace };
  }
  if (given.type === "Custom") {
    if (!isCalendarDate(given.start) || !isCalendarDate(given.end) || !inYears(given.start) || !inYears(given.end)) throw new PeriodError("dates-invalid");
    if (given.end < given.start) throw new PeriodError("end-before-start");
    if (daySpan(given.start, given.end) > MAX_CUSTOM_DAYS) throw new PeriodError("range-too-long");
    return { type: "Custom", start: given.start, end: given.end, graceMinutes: grace };
  }
  throw new PeriodError("type-invalid");
}

/** Reads and checks a company-calendar entry: a real date, a cleaned name, one of the three types, and optional notes. */
export function readCalendarEntry(input: CalendarInput): { date: string; name: string; type: CalendarType; notes: string | null } {
  const given = (input ?? {}) as Record<string, unknown>;
  if (!isCalendarDate(given.date) || !inYears(given.date)) throw new PeriodError("date-invalid");
  if (typeof given.name !== "string" || hasControlCharacters(given.name)) throw new PeriodError("name-characters");
  const name = cleanText(given.name);
  const problem = nameProblem(name, NAME_MAX_LENGTH);
  if (problem === "empty") throw new PeriodError("name-empty");
  if (problem === "too-long") throw new PeriodError("name-too-long");
  if (problem === "characters") throw new PeriodError("name-characters");
  if (typeof given.type !== "string" || !(CALENDAR_TYPES as readonly string[]).includes(given.type)) throw new PeriodError("calendar-type-invalid");
  let notes: string | null = null;
  if (given.notes !== undefined && given.notes !== null) {
    if (typeof given.notes !== "string" || hasControlCharacters(given.notes)) throw new PeriodError("notes-invalid");
    const cleaned = cleanText(given.notes);
    if (cleaned.length > NOTES_MAX_LENGTH) throw new PeriodError("notes-invalid");
    notes = cleaned || null;
  }
  return { date: given.date, name, type: given.type as CalendarType, notes };
}

export function periodsModule(db: Database) {
  async function listPeriods(): Promise<Period[]> {
    const { rows } = await db.query<PeriodRow>(`SELECT ${PERIOD_COLUMNS} FROM public.hrms_evaluation_periods ORDER BY start_date DESC, id DESC`);
    return rows.map(toPeriod);
  }

  async function overlapping(start: string, end: string): Promise<{ id: number; name: string } | undefined> {
    const { rows } = await db.query<PeriodRow>(
      `SELECT ${PERIOD_COLUMNS} FROM public.hrms_evaluation_periods WHERE kind = 'Company' AND daterange(start_date, end_date, '[]') && daterange($1::date, $2::date, '[]') ORDER BY start_date LIMIT 1`, [start, end]);
    return rows[0] && { id: rows[0].id, name: periodName(rows[0]) };
  }

  /** Opens a company-wide period. Month and Quarter fill the dates; an overlapping period is refused, naming the one it overlaps. */
  async function openPeriod(actor: Actor, input: OpenPeriodInput): Promise<Period> {
    const period = readPeriod(input);
    const clash = await overlapping(period.start, period.end);
    if (clash) throw new PeriodError("overlap", { overlaps: clash });
    try {
      const { rows } = await db.query<PeriodRow>(`
        WITH created AS (
          INSERT INTO public.hrms_evaluation_periods (type, kind, start_date, end_date, grace_minutes, created_by_id, created_by_name)
          VALUES ($1, 'Company', $2, $3, $4, $5, $6) RETURNING *
        ), logged AS (
          INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
          SELECT $5, $6, 'period-opened', 'period', id::text, jsonb_build_object('type', type, 'start', start_date, 'end', end_date, 'graceMinutes', grace_minutes) FROM created
        ) SELECT ${PERIOD_COLUMNS} FROM created`, [period.type, period.start, period.end, period.graceMinutes, actor.id, actor.name]);
      return toPeriod(rows[0]);
    } catch (error) {
      // Two requests at once: the database's exclusion constraint settles it, and the answer still names the other period.
      if (isCode(error, "23P01")) throw new PeriodError("overlap", { overlaps: (await overlapping(period.start, period.end)) ?? { id: 0, name: "another period" } });
      throw error;
    }
  }

  async function listNonWorkingDates(range?: { from: string; to: string }): Promise<CalendarEntry[]> {
    if (range && (!isCalendarDate(range.from) || !isCalendarDate(range.to) || range.to < range.from)) throw new PeriodError("dates-invalid");
    const { rows } = await db.query<CalendarEntry>(`
      SELECT id, date::text AS date, name, type, notes, created_by_name AS "addedByName" FROM public.hrms_company_calendar
      WHERE $1::date IS NULL OR date BETWEEN $1::date AND $2::date ORDER BY date`, [range?.from ?? null, range?.to ?? null]);
    return rows;
  }

  /** Adds a non-working date to the company calendar. The same date cannot be added twice. */
  async function addNonWorkingDate(actor: Actor, input: CalendarInput): Promise<CalendarEntry> {
    const entry = readCalendarEntry(input);
    const taken = async () => (await db.query<{ name: string }>(`SELECT name FROM public.hrms_company_calendar WHERE date = $1`, [entry.date])).rows[0]?.name;
    const existing = await taken();
    if (existing) throw new PeriodError("date-taken", { existing });
    try {
      const { rows } = await db.query<CalendarEntry>(`
        WITH added AS (
          INSERT INTO public.hrms_company_calendar (date, name, type, notes, created_by_id, created_by_name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
        ), logged AS (
          INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
          SELECT $5, $6, 'non-working-date-added', 'calendar', id::text, jsonb_build_object('date', date, 'name', name, 'type', type) FROM added
        ) SELECT id, date::text AS date, name, type, notes, created_by_name AS "addedByName" FROM added`,
      [entry.date, entry.name, entry.type, entry.notes, actor.id, actor.name]);
      return rows[0];
    } catch (error) {
      if (isCode(error, "23505")) throw new PeriodError("date-taken", { existing: (await taken()) ?? entry.name });
      throw error;
    }
  }

  async function requirePeriod(periodId: number): Promise<Period> {
    if (!validId(periodId)) throw new PeriodError("unknown-period");
    const { rows } = await db.query<PeriodRow>(`SELECT ${PERIOD_COLUMNS} FROM public.hrms_evaluation_periods WHERE id = $1`, [periodId]);
    if (!rows[0]) throw new PeriodError("unknown-period");
    return toPeriod(rows[0]);
  }

  async function excusedDaysOf(employeeId: number, periodId: number): Promise<string[]> {
    const { rows } = await db.query<{ date: string }>(`SELECT date::text AS date FROM public.hrms_excused_days WHERE employee_id = $1 AND period_id = $2 ORDER BY date`, [employeeId, periodId]);
    return rows.map((row) => row.date);
  }

  /**
   * Records excused days for one Employee in one period, with who recorded them. Each date must fall inside the period; a date
   * already excused is left as it is. Returns all the Employee's excused days for the period.
   */
  async function excuseDays(actor: Actor, employeeId: number, periodId: number, dates: readonly string[]): Promise<string[]> {
    const period = await requirePeriod(periodId);
    if (!validId(employeeId) || !(await db.query(`SELECT 1 FROM public.hrms_employees WHERE id = $1`, [employeeId])).rows.length) throw new PeriodError("unknown-employee");
    if (!Array.isArray(dates) || dates.length === 0 || dates.length > MAX_EXCUSED_DAYS_PER_REQUEST || !dates.every((date) => isCalendarDate(date))) throw new PeriodError("dates-invalid");
    if (dates.some((date) => date < period.start || date > period.end)) throw new PeriodError("day-outside-period");
    await db.query(`
      WITH added AS (
        INSERT INTO public.hrms_excused_days (employee_id, period_id, date, recorded_by_id, recorded_by_name)
        SELECT $1, $2, day::date, $4, $5 FROM unnest($3::text[]) AS day ON CONFLICT DO NOTHING RETURNING date
      ) INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
      SELECT $4, $5, 'days-excused', 'excused-days', $1::text || ':' || $2::text, jsonb_build_object('employeeId', $1::int, 'periodId', $2::int, 'dates', jsonb_agg(date ORDER BY date)) FROM added HAVING count(*) > 0`,
    [employeeId, periodId, [...new Set(dates)], actor.id, actor.name]);
    return excusedDaysOf(employeeId, periodId);
  }

  /**
   * An Employee's scheduled days in a period, and their excused days, for scoring. An Employee with no shift is not scorable:
   * they have no scheduled days at all, which is not the same as scheduled for zero. A joiner is scheduled only from their start date.
   */
  async function scheduleFor(employeeId: number, periodId: number): Promise<Schedule> {
    const period = await requirePeriod(periodId);
    if (!validId(employeeId)) throw new PeriodError("unknown-employee");
    const { rows } = await db.query<{ start: string; workingDays: number[] | null }>(`SELECT start_date::text AS start, working_days::int[] AS "workingDays" FROM public.hrms_employees WHERE id = $1`, [employeeId]);
    if (!rows[0]) throw new PeriodError("unknown-employee");
    if (!rows[0].workingDays || rows[0].workingDays.length === 0) return { scorable: false, reason: "no-shift" };
    const calendar = await listNonWorkingDates({ from: period.start, to: period.end });
    return {
      scorable: true,
      scheduledDays: scheduledDays({ periodStart: period.start, periodEnd: period.end, employeeStart: rows[0].start, workingDays: rows[0].workingDays, nonWorkingDates: calendar.map((entry) => entry.date) }),
      excusedDays: await excusedDaysOf(employeeId, periodId),
    };
  }

  return { listPeriods, openPeriod, listNonWorkingDates, addNonWorkingDate, excuseDays, scheduleFor };
}
