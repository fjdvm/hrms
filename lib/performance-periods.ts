import type { Database } from "./database";
import { daySpan, isCalendarDate, monthRange, periodName, quarterRange, scheduledDays } from "./performance-calendar";
import { cleanText, hasControlCharacters, nameProblem } from "./validators/text";
import type { Actor } from "./performance-kpis";
import { LISTED, performanceAudit } from "./performance-audit";

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
export type CalendarEntry = { id: number; date: string; name: string; type: CalendarType; notes: string | null; addedByName: string; /** The Manila date it was added. */ addedOn: string };

export type OpenPeriodInput =
  | { type: "Month"; year: number; month: number; graceMinutes?: number }
  | { type: "Quarter"; year: number; quarter: number; graceMinutes?: number }
  | { type: "Custom"; start: string; end: string; graceMinutes?: number };
export type CalendarInput = { date: string; name: string; type: string; notes?: string | null };

export type PeriodProblem =
  | "type-invalid" | "year-invalid" | "dates-invalid" | "end-before-start" | "range-too-long" | "grace-invalid" | "overlap"
  | "date-invalid" | "name-empty" | "name-too-long" | "name-characters" | "calendar-type-invalid" | "notes-invalid" | "date-taken"
  | "unknown-period" | "unknown-employee" | "day-outside-period" | "unknown-entry";

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
      const values: unknown[] = [period.type, period.start, period.end, period.graceMinutes, actor.id, actor.name];
      const audit = performanceAudit(db, actor, values);
      const label = periodName(period);
      values.push(label);
      const labelRef = `$${values.length}`;
      const event = audit.step("performance_period.opened", { type: "performance_period", id: "new", display_name: label }, `${actor.name} opened the ${label} evaluation period.`,
        `(SELECT c.id, c.type, c.start_date, c.end_date, c.grace_minutes FROM created c) src`,
        `jsonb_build_object('target', jsonb_build_object('type', 'performance_period', 'id', src.id::text, 'display_name', ${labelRef}::text),
          'metadata', jsonb_build_object('period_id', src.id, 'period_type', src.type, 'start', src.start_date, 'end', src.end_date, 'grace_minutes', src.grace_minutes))`);
      const { rows } = await db.query<PeriodRow>(`
        WITH created AS (
          INSERT INTO public.hrms_evaluation_periods (type, kind, start_date, end_date, grace_minutes, created_by_id, created_by_name)
          VALUES ($1, 'Company', $2, $3, $4, $5, $6) RETURNING *
        ), logged AS (
          INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
          SELECT $5, $6, 'period-opened', 'period', id::text, jsonb_build_object('type', type, 'start', start_date, 'end', end_date, 'graceMinutes', grace_minutes) FROM created
        ), audit AS (${event})
        SELECT ${PERIOD_COLUMNS} FROM created`, values);
      await audit.deliver();
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
      SELECT id, date::text AS date, name, type, notes, created_by_name AS "addedByName", (created_at AT TIME ZONE 'Asia/Manila')::date::text AS "addedOn" FROM public.hrms_company_calendar
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
      const values: unknown[] = [entry.date, entry.name, entry.type, entry.notes, actor.id, actor.name];
      const audit = performanceAudit(db, actor, values);
      // The calendar date is the readable target; the name and notes are Staff-typed text, so they stay out of the metadata.
      const event = audit.step("non_working_date.added", { type: "non_working_date", id: "new", display_name: entry.date }, `${actor.name} added ${entry.date} to the company calendar.`,
        `(SELECT a.id, a.date, a.type FROM added a) src`,
        `jsonb_build_object('target', jsonb_build_object('type', 'non_working_date', 'id', src.id::text, 'display_name', src.date::text), 'metadata', jsonb_build_object('entry_id', src.id, 'date', src.date, 'date_type', src.type))`);
      const { rows } = await db.query<CalendarEntry>(`
        WITH added AS (
          INSERT INTO public.hrms_company_calendar (date, name, type, notes, created_by_id, created_by_name) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
        ), logged AS (
          INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
          SELECT $5, $6, 'non-working-date-added', 'calendar', id::text, jsonb_build_object('date', date, 'name', name, 'type', type) FROM added
        ), audit AS (${event})
        SELECT id, date::text AS date, name, type, notes, created_by_name AS "addedByName", (created_at AT TIME ZONE 'Asia/Manila')::date::text AS "addedOn" FROM added`, values);
      await audit.deliver();
      return rows[0];
    } catch (error) {
      if (isCode(error, "23505")) throw new PeriodError("date-taken", { existing: (await taken()) ?? entry.name });
      throw error;
    }
  }

  const entryOf = async (id: number): Promise<CalendarEntry | undefined> => {
    if (!validId(id)) return undefined;
    return (await db.query<CalendarEntry>(`SELECT id, date::text AS date, name, type, notes, created_by_name AS "addedByName", (created_at AT TIME ZONE 'Asia/Manila')::date::text AS "addedOn" FROM public.hrms_company_calendar WHERE id = $1`, [id])).rows[0];
  };

  /**
   * Edits a non-working date. An evaluation already submitted keeps the scheduled days it was submitted with, so this changes
   * only what is still being worked on. The new date must not already be on the calendar.
   */
  async function updateNonWorkingDate(actor: Actor, id: number, input: CalendarInput): Promise<CalendarEntry> {
    const entry = readCalendarEntry(input);
    const before = await entryOf(id);
    if (!before) throw new PeriodError("unknown-entry");
    const clash = (await db.query<{ name: string }>(`SELECT name FROM public.hrms_company_calendar WHERE date = $1 AND id <> $2`, [entry.date, id])).rows[0];
    if (clash) throw new PeriodError("date-taken", { existing: clash.name });
    try {
      const values: unknown[] = [id, entry.date, entry.name, entry.type, entry.notes, actor.id, actor.name, JSON.stringify({ date: before.date, name: before.name, type: before.type, notes: before.notes })];
      const audit = performanceAudit(db, actor, values);
      values.push(before.date);
      const beforeRef = `$${values.length}`;
      const event = audit.step("non_working_date.updated", { type: "non_working_date", id: String(id), display_name: entry.date }, `${actor.name} updated ${before.date} on the company calendar.`,
        `(SELECT c.id, c.date, c.type FROM changed c) src`,
        `jsonb_build_object('target', jsonb_build_object('type', 'non_working_date', 'id', src.id::text, 'display_name', src.date::text),
          'metadata', jsonb_build_object('entry_id', src.id, 'date', src.date, 'date_before', ${beforeRef}::text, 'date_type', src.type))`);
      const { rows } = await db.query<CalendarEntry>(`
        WITH changed AS (
          UPDATE public.hrms_company_calendar SET date = $2, name = $3, type = $4, notes = $5 WHERE id = $1 RETURNING *
        ), logged AS (
          INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
          SELECT $6, $7, 'non-working-date-updated', 'calendar', id::text, jsonb_build_object('before', $8::jsonb, 'after', jsonb_build_object('date', date, 'name', name, 'type', type, 'notes', notes)) FROM changed
        ), audit AS (${event})
        SELECT id, date::text AS date, name, type, notes, created_by_name AS "addedByName", (created_at AT TIME ZONE 'Asia/Manila')::date::text AS "addedOn" FROM changed`, values);
      if (!rows[0]) throw new PeriodError("unknown-entry");
      await audit.deliver();
      return rows[0];
    } catch (error) {
      if (isCode(error, "23505")) throw new PeriodError("date-taken", { existing: entry.name });
      throw error;
    }
  }

  /** Removes a non-working date from the company calendar, recording who removed it and what it was. */
  async function removeNonWorkingDate(actor: Actor, id: number): Promise<void> {
    const before = await entryOf(id);
    if (!before) throw new PeriodError("unknown-entry");
    const values: unknown[] = [id, actor.id, actor.name];
    const audit = performanceAudit(db, actor, values);
    const event = audit.step("non_working_date.removed", { type: "non_working_date", id: String(id), display_name: before.date }, `${actor.name} removed ${before.date} from the company calendar.`,
      `(SELECT r.id, r.date, r.type FROM removed r) src`,
      `jsonb_build_object('metadata', jsonb_build_object('entry_id', src.id, 'date', src.date, 'date_type', src.type))`);
    await db.query(`
      WITH removed AS (DELETE FROM public.hrms_company_calendar WHERE id = $1 RETURNING *), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $2, $3, 'non-working-date-removed', 'calendar', id::text, jsonb_build_object('date', date, 'name', name, 'type', type) FROM removed
      ), audit AS (${event})
      SELECT id FROM removed`, values);
    await audit.deliver();
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
    const employee = validId(employeeId) ? (await db.query<{ name: string }>(`SELECT full_name AS name FROM public.hrms_employees WHERE id = $1`, [employeeId])).rows[0] : undefined;
    if (!employee) throw new PeriodError("unknown-employee");
    if (!Array.isArray(dates) || dates.length === 0 || dates.length > MAX_EXCUSED_DAYS_PER_REQUEST || !dates.every((date) => isCalendarDate(date))) throw new PeriodError("dates-invalid");
    if (dates.some((date) => date < period.start || date > period.end)) throw new PeriodError("day-outside-period");
    const values: unknown[] = [employeeId, periodId, [...new Set(dates)], actor.id, actor.name];
    const audit = performanceAudit(db, actor, values);
    // One event for the whole request, listing the dates that were actually added (the first LISTED of them) and how many.
    const event = audit.step("attendance_day.excused", { type: "attendance", id: `${employeeId}:${periodId}`, display_name: `${employee.name} · ${period.name}` },
      `${actor.name} excused days for ${employee.name} in ${period.name}.`,
      `(SELECT count(*)::int AS n, (array_agg(date ORDER BY date))[1:${LISTED}] AS dates FROM added HAVING count(*) > 0) src`,
      `jsonb_build_object('metadata', jsonb_build_object('employee_id', $1::int, 'period_id', $2::int, 'dates', src.dates, 'date_count', src.n))`);
    await db.query(`
      WITH added AS (
        INSERT INTO public.hrms_excused_days (employee_id, period_id, date, recorded_by_id, recorded_by_name)
        SELECT $1, $2, day::date, $4, $5 FROM unnest($3::text[]) AS day ON CONFLICT DO NOTHING RETURNING date
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $4, $5, 'days-excused', 'excused-days', $1::text || ':' || $2::text, jsonb_build_object('employeeId', $1::int, 'periodId', $2::int, 'dates', jsonb_agg(date ORDER BY date)) FROM added HAVING count(*) > 0
      ), audit AS (${event})
      SELECT count(*)::int AS added FROM added`, values);
    await audit.deliver();
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

  return { listPeriods, openPeriod, listNonWorkingDates, addNonWorkingDate, updateNonWorkingDate, removeNonWorkingDate, excuseDays, scheduleFor, requirePeriod };
}
