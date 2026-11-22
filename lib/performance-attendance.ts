import type { Database } from "./database";
import { isCalendarDate, scheduledDays } from "./performance-calendar";
import { MAX_BATCH_ROWS, coverageOf, numberKey, validateRows, type Coverage, type RawAttendanceRow, type RejectedRow } from "./performance-attendance-rows";
import type { Actor } from "./performance-kpis";
import { performanceAudit } from "./performance-audit";
import { PeriodError, type periodsModule } from "./performance-periods";
import type { AttendanceRow } from "./performance-scoring";
import { REASON_MAX_LENGTH } from "./performance-attendance-terms";
import { cleanText, hasControlCharacters } from "./validators/text";

/**
 * Attendance rows, the issues in them, and how HR resolves those issues. One of the small domain modules behind the
 * Performance interface; it takes the Staff member and the database from the seam, so access is decided there. The row
 * rules are pure functions in `performance-attendance-rows.ts`. This module does not read the biometric file: it takes
 * normalised rows (employee number, date, time-in, time-out), which the parser will produce once a real export exists.
 *
 * The rows are kept only to compute scores and are never shown as an attendance record, and they are never edited. They are
 * stored by Employee and date, so one date is never counted twice: a later row for the same Employee and date replaces the
 * earlier one, and a range can be covered by several imports.
 *
 * Open issues for an Employee and period are an Employee with no rows at all, and a counted day with a time-in and no
 * time-out. A day is resolved by marking it Excused (it joins the excused days; a reason is optional) or Absent (a reason is
 * required), or by a corrected re-import. An Employee with no rows is resolved by confirming no attendance for the period,
 * with a reason, which counts as full absence; a re-import that adds rows also clears it, and the confirmation then no longer
 * applies. "Attendance imported" is true when the Employee has rows in the period, or HR confirmed there was none.
 */

export type AttendanceIssue = { kind: "no-attendance" } | { kind: "missing-time-out"; date: string };
export type Resolution = { type: "Excused"; reason?: string | null } | { type: "Absent"; reason: string };

export type AttendanceProblem =
  | "batch-invalid" | "batch-empty" | "batch-too-large" | "file-name-invalid" | "source-invalid" | "no-usable-rows"
  | "resolution-invalid" | "reason-required" | "reason-invalid" | "date-invalid" | "day-outside-period" | "not-an-open-issue" | "has-attendance";

export class AttendanceError extends Error {
  constructor(public readonly problem: AttendanceProblem) {
    super(`Attendance: ${problem}`);
  }
}

export type EmployeeWithoutRecords = { id: number; employeeNumber: string; name: string; hasShift: boolean };
export type AttendancePreview = {
  totalRows: number;
  usableCount: number;
  rejectedCount: number;
  /** The first rejected rows, each with its reason; `rejectedCount` has the full number. */
  rejected: RejectedRow[];
  /** How many usable rows are for an Employee and date that already has a stored row, which they would replace. */
  replacesExisting: number;
  /** Whether the stored rows together with these cover the whole period. */
  coverage: Coverage;
  /** Active Employees in the period with no stored row and none in this batch. */
  employeesWithNoRecords: EmployeeWithoutRecords[];
};
export type AttendanceImport = { id: number; fileName: string; sourceRef: string | null; totalRows: number; usableRows: number; rejectedRows: number; importedByName: string; importedAt: string };
export type AttendanceState = {
  /** The normalised rows inside the period for the scoring engine. A day marked Absent is left out, so it counts as an absence. */
  rows: AttendanceRow[];
  issues: AttendanceIssue[];
  attendanceImported: boolean;
  /** HR confirmed no attendance, and no rows have arrived since. The scoring engine counts this as full absence. */
  noAttendanceConfirmed: boolean;
  absentDays: string[];
  /** False when the Employee has no shift: they are not scored, so no day can be an issue. */
  scorable: boolean;
};

export const REJECTED_SHOWN = 500;
export const FILE_NAME_MAX_LENGTH = 255;
export const SOURCE_REF_MAX_LENGTH = 500;

type EmployeeRow = { id: number; employeeNumber: string; name: string; status: string; start: string; workingDays: number[] | null };

/** Cleans a reason typed by Staff; refused, not silently changed, when it holds control characters or is too long. */
function readReason(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null || value === "") {
    if (required) throw new AttendanceError("reason-required");
    return null;
  }
  if (typeof value !== "string" || hasControlCharacters(value)) throw new AttendanceError("reason-invalid");
  const reason = cleanText(value);
  if (!reason) {
    if (required) throw new AttendanceError("reason-required");
    return null;
  }
  if (reason.length > REASON_MAX_LENGTH) throw new AttendanceError("reason-invalid");
  return reason;
}

function readBatch(rows: unknown): RawAttendanceRow[] {
  if (!Array.isArray(rows)) throw new AttendanceError("batch-invalid");
  if (rows.length === 0) throw new AttendanceError("batch-empty");
  if (rows.length > MAX_BATCH_ROWS) throw new AttendanceError("batch-too-large");
  return rows as RawAttendanceRow[];
}

export function attendanceModule(db: Database, periods: ReturnType<typeof periodsModule>) {
  async function employeeById(employeeId: number): Promise<EmployeeRow> {
    if (!Number.isInteger(employeeId) || employeeId < 1 || employeeId > 2147483647) throw new PeriodError("unknown-employee");
    const { rows } = await db.query<EmployeeRow>(`SELECT id, employee_number AS "employeeNumber", full_name AS name, status, start_date::text AS start, working_days::int[] AS "workingDays" FROM public.hrms_employees WHERE id = $1`, [employeeId]);
    if (!rows[0]) throw new PeriodError("unknown-employee");
    return rows[0];
  }

  const allEmployees = async () => (await db.query<EmployeeRow>(`SELECT id, employee_number AS "employeeNumber", full_name AS name, status, start_date::text AS start, working_days::int[] AS "workingDays" FROM public.hrms_employees ORDER BY id`)).rows;

  /** Checks a batch against the Employees' numbers. Never trusts a preview: the same check runs again on import. */
  async function check(rows: unknown) {
    const batch = readBatch(rows);
    const employees = await allEmployees();
    const byNumber = new Map(employees.map((employee) => [numberKey(employee.employeeNumber), { id: employee.id, employeeNumber: employee.employeeNumber }]));
    return { batch, employees, ...validateRows(batch, byNumber) };
  }

  /** What would be used and what would be rejected, with nothing saved. */
  async function previewAttendance(input: { periodId: number; rows: unknown }): Promise<AttendancePreview> {
    const period = await periods.requirePeriod(input.periodId);
    const { batch, employees, usable, rejected } = await check(input.rows);
    const calendar = await periods.listNonWorkingDates({ from: period.start, to: period.end });
    const roster = employees.filter((employee) => employee.status === "Active" && employee.start <= period.end);

    const stored = (await db.query<{ employeeId: number; date: string }>(`SELECT employee_id AS "employeeId", date::text AS date FROM public.hrms_performance_attendance WHERE date BETWEEN $1::date AND $2::date`, [period.start, period.end])).rows;
    const inPeriod = usable.filter((row) => row.date >= period.start && row.date <= period.end);
    const withRecords = new Set([...stored.map((row) => row.employeeId), ...inPeriod.map((row) => row.employeeId)]);

    const scheduled = roster.flatMap((employee) => employee.workingDays?.length
      ? scheduledDays({ periodStart: period.start, periodEnd: period.end, employeeStart: employee.start, workingDays: employee.workingDays, nonWorkingDates: calendar.map((entry) => entry.date) }) : []).sort();
    const expected = { from: scheduled[0] ?? period.start, to: scheduled.at(-1) ?? period.end };

    const replaces = usable.length === 0 ? 0 : (await db.query<{ n: number }>(`
      SELECT count(*)::int AS n FROM unnest($1::int[], $2::date[]) AS t(employee_id, date)
      JOIN public.hrms_performance_attendance a ON a.employee_id = t.employee_id AND a.date = t.date`, [usable.map((row) => row.employeeId), usable.map((row) => row.date)])).rows[0].n;

    return {
      totalRows: batch.length,
      usableCount: usable.length,
      rejectedCount: rejected.length,
      rejected: rejected.slice(0, REJECTED_SHOWN),
      replacesExisting: replaces,
      coverage: coverageOf([...stored.map((row) => row.date), ...inPeriod.map((row) => row.date)], expected),
      employeesWithNoRecords: roster.filter((employee) => !withRecords.has(employee.id))
        .map((employee) => ({ id: employee.id, employeeNumber: employee.employeeNumber, name: employee.name, hasShift: Boolean(employee.workingDays?.length) })),
    };
  }

  /**
   * Saves a batch the Staff member confirmed: only the usable rows, each replacing any earlier row for the same Employee and
   * date, with one import record (who, when, file name, counts and the source reference). The rows are checked again here.
   */
  async function importAttendance(actor: Actor, input: { fileName: string; sourceRef?: string | null; rows: unknown }): Promise<AttendanceImport> {
    if (typeof input?.fileName !== "string" || hasControlCharacters(input.fileName) || /[\\/]/.test(input.fileName)) throw new AttendanceError("file-name-invalid");
    const fileName = cleanText(input.fileName);
    if (!fileName || fileName.length > FILE_NAME_MAX_LENGTH) throw new AttendanceError("file-name-invalid");
    let sourceRef: string | null = null;
    if (input.sourceRef !== undefined && input.sourceRef !== null) {
      if (typeof input.sourceRef !== "string" || hasControlCharacters(input.sourceRef) || cleanText(input.sourceRef).length > SOURCE_REF_MAX_LENGTH) throw new AttendanceError("source-invalid");
      sourceRef = cleanText(input.sourceRef) || null;
    }
    const { batch, usable, rejected } = await check(input.rows);
    if (usable.length === 0) throw new AttendanceError("no-usable-rows");
    const values: unknown[] = [fileName, sourceRef, batch.length, usable.length, rejected.length, actor.id, actor.name, usable.map((r) => r.employeeId), usable.map((r) => r.date), usable.map((r) => r.timeIn), usable.map((r) => r.timeOut)];
    const audit = performanceAudit(db, actor, values);
    // One event with counts, never the rows. The file name is the readable target.
    const event = audit.step("attendance.imported", { type: "attendance_import", id: "new", display_name: fileName }, `${actor.name} imported attendance from ${fileName}.`,
      `(SELECT i.id, i.file_name, i.total_rows, i.usable_rows, i.rejected_rows FROM imported i) src`,
      `jsonb_build_object('target', jsonb_build_object('type', 'attendance_import', 'id', src.id::text, 'display_name', src.file_name),
        'metadata', jsonb_build_object('import_id', src.id, 'total_rows', src.total_rows, 'usable_rows', src.usable_rows, 'rejected_rows', src.rejected_rows))`);
    const { rows } = await db.query<AttendanceImport>(`
      WITH imported AS (
        INSERT INTO public.hrms_performance_imports (file_name, source_ref, total_rows, usable_rows, rejected_rows, imported_by_id, imported_by_name)
        VALUES ($1, $2, $3::int, $4::int, $5::int, $6, $7) RETURNING *
      ), saved AS (
        INSERT INTO public.hrms_performance_attendance (employee_id, date, time_in, time_out, import_id)
        SELECT r.employee_id, r.date, r.time_in::time, r.time_out::time, imported.id
        FROM unnest($8::int[], $9::date[], $10::text[], $11::text[]) AS r(employee_id, date, time_in, time_out) CROSS JOIN imported
        ON CONFLICT (employee_id, date) DO UPDATE SET time_in = EXCLUDED.time_in, time_out = EXCLUDED.time_out, import_id = EXCLUDED.import_id
        RETURNING 1
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $6, $7, 'attendance-imported', 'import', id::text, jsonb_build_object('fileName', file_name, 'usableRows', usable_rows, 'rejectedRows', rejected_rows) FROM imported
      ), audit AS (${event})
      SELECT id, file_name AS "fileName", source_ref AS "sourceRef", total_rows AS "totalRows", usable_rows AS "usableRows", rejected_rows AS "rejectedRows",
        imported_by_name AS "importedByName", imported_at::text AS "importedAt" FROM imported`, values);
    await audit.deliver();
    return rows[0];
  }

  async function listImports(): Promise<AttendanceImport[]> {
    const { rows } = await db.query<AttendanceImport>(`
      SELECT id, file_name AS "fileName", source_ref AS "sourceRef", total_rows AS "totalRows", usable_rows AS "usableRows", rejected_rows AS "rejectedRows",
        imported_by_name AS "importedByName", imported_at::text AS "importedAt" FROM public.hrms_performance_imports ORDER BY id DESC LIMIT 50`);
    return rows;
  }

  /** The Employee's rows in the period for scoring, the open issues, and whether attendance is imported. */
  async function attendanceFor(employeeId: number, periodId: number): Promise<AttendanceState> {
    const period = await periods.requirePeriod(periodId);
    await employeeById(employeeId);
    const schedule = await periods.scheduleFor(employeeId, periodId);
    const stored = (await db.query<{ date: string; timeIn: string; timeOut: string | null }>(`
      SELECT date::text AS date, to_char(time_in, 'HH24:MI') AS "timeIn", to_char(time_out, 'HH24:MI') AS "timeOut"
      FROM public.hrms_performance_attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date ORDER BY date`, [employeeId, period.start, period.end])).rows;
    const absent = new Set((await db.query<{ date: string }>(`SELECT date::text AS date FROM public.hrms_absent_days WHERE employee_id = $1 AND period_id = $2`, [employeeId, periodId])).rows.map((row) => row.date));
    const confirmed = (await db.query(`SELECT 1 FROM public.hrms_attendance_confirmations WHERE employee_id = $1 AND period_id = $2`, [employeeId, periodId])).rows.length > 0;

    // An Absent mark only stands while the day still has no time-out: a corrected re-import supersedes it.
    const standingAbsent = stored.filter((row) => row.timeOut === null && absent.has(row.date)).map((row) => row.date);
    const rows: AttendanceRow[] = stored.filter((row) => !standingAbsent.includes(row.date));
    const issues: AttendanceIssue[] = [];
    if (stored.length === 0 && !confirmed) issues.push({ kind: "no-attendance" });
    if (schedule.scorable) {
      const excused = new Set(schedule.excusedDays);
      const counted = new Set(schedule.scheduledDays.filter((day) => !excused.has(day)));
      for (const row of rows) if (row.timeOut === null && counted.has(row.date)) issues.push({ kind: "missing-time-out", date: row.date });
    }
    return { rows, issues, attendanceImported: stored.length > 0 || confirmed, noAttendanceConfirmed: confirmed && stored.length === 0, absentDays: standingAbsent, scorable: schedule.scorable };
  }

  /**
   * Resolves a day with a time-in and no time-out as Excused (it joins the excused days, with an optional reason) or Absent
   * (a reason is required). The day must be an open issue. The imported record is never edited.
   */
  async function resolveDay(actor: Actor, employeeId: number, periodId: number, date: string, resolution: Resolution): Promise<AttendanceState> {
    const period = await periods.requirePeriod(periodId);
    const employee = await employeeById(employeeId);
    if (!isCalendarDate(date)) throw new AttendanceError("date-invalid");
    if (date < period.start || date > period.end) throw new AttendanceError("day-outside-period");
    if (!resolution || (resolution.type !== "Excused" && resolution.type !== "Absent")) throw new AttendanceError("resolution-invalid");
    const reason = readReason(resolution.reason, resolution.type === "Absent");
    const state = await attendanceFor(employeeId, periodId);
    if (!state.issues.some((issue) => issue.kind === "missing-time-out" && issue.date === date)) throw new AttendanceError("not-an-open-issue");

    // One statement each: the day, its history row and its Audit event. The reason is Staff-typed text, so it stays out of the event.
    const values: unknown[] = [employeeId, periodId, date, actor.id, actor.name, reason];
    const audit = performanceAudit(db, actor, values);
    const excused = resolution.type === "Excused";
    const event = audit.step(excused ? "attendance_day.excused" : "attendance_day.marked_absent",
      { type: "attendance_day", id: `${employeeId}:${periodId}:${date}`, display_name: `${employee.name} · ${date}` },
      `${actor.name} ${excused ? "excused" : "marked absent"} ${employee.name} on ${date}.`,
      `(SELECT a.date FROM added a) src`,
      `jsonb_build_object('metadata', jsonb_build_object('employee_id', $1::int, 'period_id', $2::int, 'date', src.date, 'date_count', 1))`);
    if (excused) {
      await db.query(`
        WITH added AS (
          INSERT INTO public.hrms_excused_days (employee_id, period_id, date, recorded_by_id, recorded_by_name, reason) VALUES ($1, $2, $3::date, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING date
        ), logged AS (
          INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
          SELECT $4, $5, 'day-excused', 'attendance-day', $1::text || ':' || $2::text || ':' || $3::text, jsonb_build_object('employeeId', $1::int, 'periodId', $2::int, 'date', $3::text, 'reason', $6::text) FROM added
        ), audit AS (${event})
        SELECT date FROM added`, values);
    } else {
      await db.query(`
        WITH added AS (
          INSERT INTO public.hrms_absent_days (employee_id, period_id, date, reason, marked_by_id, marked_by_name) VALUES ($1, $2, $3::date, $6, $4, $5) ON CONFLICT DO NOTHING RETURNING date
        ), logged AS (
          INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
          SELECT $4, $5, 'day-marked-absent', 'attendance-day', $1::text || ':' || $2::text || ':' || $3::text, jsonb_build_object('employeeId', $1::int, 'periodId', $2::int, 'date', $3::text, 'reason', $6::text) FROM added
        ), audit AS (${event})
        SELECT date FROM added`, values);
    }
    await audit.deliver();
    return attendanceFor(employeeId, periodId);
  }

  /**
   * Confirms an Employee had no attendance in the period, with a required reason. It counts as full absence. Only for an
   * Employee with no rows in the period; a re-import that adds rows clears it.
   */
  async function confirmNoAttendance(actor: Actor, employeeId: number, periodId: number, reasonInput: unknown): Promise<AttendanceState> {
    const period = await periods.requirePeriod(periodId);
    const employee = await employeeById(employeeId);
    const reason = readReason(reasonInput, true);
    const rows = (await db.query(`SELECT 1 FROM public.hrms_performance_attendance WHERE employee_id = $1 AND date BETWEEN $2::date AND $3::date LIMIT 1`, [employeeId, period.start, period.end])).rows;
    if (rows.length > 0) throw new AttendanceError("has-attendance");
    const values: unknown[] = [employeeId, periodId, reason, actor.id, actor.name];
    const audit = performanceAudit(db, actor, values);
    const event = audit.step("attendance.no_attendance_confirmed", { type: "attendance", id: `${employeeId}:${periodId}`, display_name: `${employee.name} · ${period.name}` },
      `${actor.name} confirmed no attendance for ${employee.name} in ${period.name}.`,
      `(SELECT a.employee_id FROM added a) src`,
      `jsonb_build_object('metadata', jsonb_build_object('employee_id', src.employee_id, 'period_id', $2::int))`);
    await db.query(`
      WITH added AS (
        INSERT INTO public.hrms_attendance_confirmations (employee_id, period_id, reason, confirmed_by_id, confirmed_by_name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING employee_id
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $4, $5, 'no-attendance-confirmed', 'attendance-period', $1::text || ':' || $2::text, jsonb_build_object('employeeId', $1::int, 'periodId', $2::int, 'reason', $3::text) FROM added
      ), audit AS (${event})
      SELECT employee_id FROM added`, values);
    await audit.deliver();
    return attendanceFor(employeeId, periodId);
  }

  return { previewAttendance, importAttendance, listImports, attendanceFor, resolveDay, confirmNoAttendance };
}

