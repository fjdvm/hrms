import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AttendanceError, PeriodError, performanceFor, type RawAttendanceRow } from "@/lib/performance";
import { scoreEvaluation } from "@/lib/performance-scoring";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => new Date("2026-12-01T02:00:00Z"));
let employeeCount = 0;

/** An Active Employee, numbered 2026-001, 2026-002 and so on, with a Mon–Fri shift unless `days` says otherwise. */
async function employee(name: string, { start = "2026-01-05", days = [1, 2, 3, 4, 5] as number[] | null, status = "Active" } = {}) {
  employeeCount += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, $2, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [employeeCount, start])).rows[0].id;
  const id = (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', 'Retail', 'Cainta branch', $6, 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', $7, 'Ada') RETURNING id`,
  [`2026-${String(employeeCount).padStart(3, "0")}`, offer, employeeCount, name, `${name.split(" ")[0].toLowerCase()}@example.test`, start, status])).rows[0].id;
  if (days) await db.query(`UPDATE public.hrms_employees SET shift_start = '08:00', shift_end = '17:00', working_days = $2::smallint[] WHERE id = $1`, [id, days]);
  return id;
}
const NUMBER = (n: number) => `2026-${String(n).padStart(3, "0")}`;
const row = (n: number, date: string, timeIn = "08:00", timeOut: string | null = "17:00"): RawAttendanceRow => ({ employeeNumber: NUMBER(n), date, timeIn, timeOut });
/** Mon–Fri days of November 2026, from the 2nd to the 30th (21 days). */
const WEEKDAYS = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`).filter((d) => {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
});
const NOV = { type: "Month", year: 2026, month: 11 } as const;

beforeEach(async () => {
  employeeCount = 0;
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  portal = new FakePortal();
  handle = portal.signIn(staff, ["Performance"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const attendanceProblem = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(AttendanceError);
  return (error as AttendanceError).problem;
};
const storedRows = async () => (await db.query<{ employee_id: number; date: string; time_in: string; time_out: string | null }>(
  `SELECT employee_id, date::text, time_in::text, time_out::text FROM hrms_performance_attendance ORDER BY employee_id, date`)).rows;
const audit = async () => (await db.query<{ actor_name: string; action: string; detail: Record<string, unknown> }>(`SELECT actor_name, action, detail FROM hrms_performance_audit ORDER BY id`)).rows;
const issues = async (employeeId: number, periodId: number) => (await performance().attendanceFor(employeeId, periodId)).issues;

describe("previewing a batch", () => {
  it("reports usable and rejected rows with their reasons, and saves nothing", async () => {
    const period = await performance().openPeriod(NOV);
    await employee("Ana Cruz");
    const preview = await performance().previewAttendance({
      periodId: period.id,
      rows: [row(1, "2026-11-02"), row(1, "2026-11-03", "08:10", "17:05"), row(9, "2026-11-02"), row(1, "2026-11-03", "09:00"), row(1, "2026-02-30"), row(1, "2026-11-04", "8am"), row(1, "2026-11-05", "17:00", "08:00"), row(1, "2026-11-06", "08:00", null)],
    });

    expect(preview).toMatchObject({ totalRows: 8, usableCount: 3, rejectedCount: 5, replacesExisting: 0 });
    expect(preview.rejected).toEqual([
      { row: 3, employeeNumber: "2026-009", reason: "unknown-employee-number" },
      { row: 4, employeeNumber: "2026-001", reason: "duplicate-in-batch", duplicateOf: 2 },
      { row: 5, employeeNumber: "2026-001", reason: "invalid-date" },
      { row: 6, employeeNumber: "2026-001", reason: "invalid-time" },
      { row: 7, employeeNumber: "2026-001", reason: "invalid-time" },
    ]);
    expect(await storedRows()).toEqual([]);
    expect((await db.query(`SELECT 1 FROM hrms_performance_imports`)).rows).toEqual([]);
    expect(await audit()).toEqual([{ actor_name: "Ada Okafor", action: "period-opened", detail: expect.anything() }]);
  });

  it("says whether the rows cover the whole period, counting what is already stored, and which Employees have no records", async () => {
    const period = await performance().openPeriod(NOV);
    await employee("Ana Cruz");
    await employee("Bea Reyes");
    await employee("Cy Dela Cruz", { days: null });
    await employee("Dan Uy", { status: "Onboarding" });
    await employee("Eli Ramos", { start: "2026-12-07" });
    const firstHalf = WEEKDAYS.slice(0, 10).map((date) => row(1, date));
    const secondHalf = WEEKDAYS.slice(10).map((date) => row(1, date));

    const early = await performance().previewAttendance({ periodId: period.id, rows: firstHalf });
    expect(early.coverage).toMatchObject({ covers: false, expectedFrom: "2026-11-02", expectedTo: "2026-11-30", rowsFrom: "2026-11-02", rowsTo: "2026-11-13", startsLate: false, endsEarly: true });
    expect(early.employeesWithNoRecords).toEqual([
      { id: 2, employeeNumber: "2026-002", name: "Bea Reyes", hasShift: true },
      { id: 3, employeeNumber: "2026-003", name: "Cy Dela Cruz", hasShift: false },
    ]);

    await performance().importAttendance({ fileName: "nov-first-half.xlsx", rows: firstHalf });
    const late = await performance().previewAttendance({ periodId: period.id, rows: secondHalf });
    expect(late.coverage).toMatchObject({ covers: true, startsLate: false, endsEarly: false });
    const stillMissing = await performance().previewAttendance({ periodId: period.id, rows: [row(2, "2026-11-30")] });
    expect(stillMissing.employeesWithNoRecords.map((e) => e.name)).toEqual(["Cy Dela Cruz"]);
  });

  it("looks at the company calendar when working out the first and last day to expect", async () => {
    const period = await performance().openPeriod(NOV);
    await employee("Ana Cruz");
    await performance().addNonWorkingDate({ date: "2026-11-30", name: "Bonifacio Day", type: "Holiday" });

    const preview = await performance().previewAttendance({ periodId: period.id, rows: WEEKDAYS.slice(0, -1).map((date) => row(1, date)) });
    expect(preview.coverage).toMatchObject({ covers: true, expectedTo: "2026-11-27" });
  });

  it("counts the rows a batch would replace", async () => {
    const period = await performance().openPeriod(NOV);
    await employee("Ana Cruz");
    await performance().importAttendance({ fileName: "a.csv", rows: [row(1, "2026-11-02"), row(1, "2026-11-03")] });

    const preview = await performance().previewAttendance({ periodId: period.id, rows: [row(1, "2026-11-03", "08:05"), row(1, "2026-11-04")] });
    expect(preview.replacesExisting).toBe(1);
  });

  it("refuses a batch that is not a list, is empty or is too large, and an unknown period", async () => {
    const period = await performance().openPeriod(NOV);
    for (const [rows, problem] of [[null, "batch-invalid"], ["x", "batch-invalid"], [{}, "batch-invalid"], [[], "batch-empty"], [Array.from({ length: 50_001 }, () => ({})), "batch-too-large"]] as const) {
      expect(await attendanceProblem(performance().previewAttendance({ periodId: period.id, rows }))).toBe(problem);
    }
    await expect(performance().previewAttendance({ periodId: 999, rows: [row(1, "2026-11-02")] })).rejects.toBeInstanceOf(PeriodError);
  });
});

describe("importing a batch", () => {
  it("saves only the usable rows and records who, when, the file name, the counts and the source", async () => {
    await employee("Ana Cruz");
    const imported = await performance().importAttendance({
      fileName: "  November   export.xlsx ", sourceRef: "file-7f3a",
      rows: [row(1, "2026-11-02"), row(7, "2026-11-02"), row(1, "2026-11-03", "bad"), row(1, "2026-11-04", "08:00", null)],
    });

    expect(imported).toMatchObject({ fileName: "November export.xlsx", sourceRef: "file-7f3a", totalRows: 4, usableRows: 2, rejectedRows: 2, importedByName: "Ada Okafor" });
    expect(imported.importedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(await storedRows()).toEqual([
      { employee_id: 1, date: "2026-11-02", time_in: "08:00:00", time_out: "17:00:00" },
      { employee_id: 1, date: "2026-11-04", time_in: "08:00:00", time_out: null },
    ]);
    expect(await performance().listAttendanceImports()).toEqual([imported]);
    expect(await audit()).toEqual([{ actor_name: "Ada Okafor", action: "attendance-imported", detail: { fileName: "November export.xlsx", usableRows: 2, rejectedRows: 2 } }]);
  });

  it("checks the rows again on import, so a bad row never gets in by skipping the preview", async () => {
    await employee("Ana Cruz");
    await performance().importAttendance({ fileName: "a.csv", rows: [row(1, "2026-11-02"), row(1, "2026-11-02", "09:00"), row(2, "2026-11-02"), { employeeNumber: "2026-001", date: "2026-11-03", timeIn: "17:00", timeOut: "08:00" }, null as never] });

    expect((await storedRows()).map((r) => [r.date, r.time_in])).toEqual([["2026-11-02", "08:00:00"]]);
  });

  it("replaces an earlier row for the same Employee and date, and a range can be covered by several imports", async () => {
    await employee("Ana Cruz");
    await employee("Bea Reyes");
    await performance().importAttendance({ fileName: "first.csv", rows: [row(1, "2026-11-02"), row(1, "2026-11-03"), row(2, "2026-11-02")] });
    const second = await performance().importAttendance({ fileName: "second.csv", rows: [row(1, "2026-11-03", "08:40", "16:00"), row(1, "2026-11-04")] });

    expect(await storedRows()).toEqual([
      { employee_id: 1, date: "2026-11-02", time_in: "08:00:00", time_out: "17:00:00" },
      { employee_id: 1, date: "2026-11-03", time_in: "08:40:00", time_out: "16:00:00" },
      { employee_id: 1, date: "2026-11-04", time_in: "08:00:00", time_out: "17:00:00" },
      { employee_id: 2, date: "2026-11-02", time_in: "08:00:00", time_out: "17:00:00" },
    ]);
    expect((await db.query<{ import_id: number }>(`SELECT import_id FROM hrms_performance_attendance WHERE employee_id = 1 AND date = '2026-11-03'`)).rows[0].import_id).toBe(second.id);
    expect((await performance().listAttendanceImports()).map((i) => i.fileName)).toEqual(["second.csv", "first.csv"]);
  });

  it("is backed by the database: one row per Employee and date, and a time-out after the time-in", async () => {
    await employee("Ana Cruz");
    const { id } = await performance().importAttendance({ fileName: "a.csv", rows: [row(1, "2026-11-02")] });

    await expect(db.query(`INSERT INTO hrms_performance_attendance (employee_id, date, time_in, time_out, import_id) VALUES (1, '2026-11-02', '09:00', '17:00', ${id})`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO hrms_performance_attendance (employee_id, date, time_in, time_out, import_id) VALUES (1, '2026-11-03', '17:00', '08:00', ${id})`)).rejects.toThrow();
    await expect(db.query(`UPDATE hrms_performance_imports SET usable_rows = 99 WHERE id = ${id}`)).rejects.toThrow();
  });

  it("refuses a batch with nothing usable, a bad file name or source, and saves nothing", async () => {
    await employee("Ana Cruz");
    expect(await attendanceProblem(performance().importAttendance({ fileName: "a.csv", rows: [row(9, "2026-11-02"), row(1, "nope")] }))).toBe("no-usable-rows");
    for (const fileName of ["", "   ", "a/b.csv", "a\\b.csv", "a\u0000.csv", "x".repeat(256), 5, undefined]) {
      expect(await attendanceProblem(performance().importAttendance({ fileName: fileName as never, rows: [row(1, "2026-11-02")] }))).toBe("file-name-invalid");
    }
    for (const sourceRef of ["a\u0007b", "x".repeat(501), 5]) {
      expect(await attendanceProblem(performance().importAttendance({ fileName: "a.csv", sourceRef: sourceRef as never, rows: [row(1, "2026-11-02")] }))).toBe("source-invalid");
    }
    expect(await storedRows()).toEqual([]);
    expect((await db.query(`SELECT 1 FROM hrms_performance_imports`)).rows).toEqual([]);
  });
});

describe("what an Employee and period have", () => {
  it("returns the rows inside the period as normalised rows for scoring, and says attendance is imported", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await performance().importAttendance({ fileName: "a.csv", rows: [row(1, "2026-10-30"), row(1, "2026-11-02", "08:05", "17:10"), row(1, "2026-12-01")] });

    expect(await performance().attendanceFor(ana, period.id)).toEqual({
      rows: [{ date: "2026-11-02", timeIn: "08:05", timeOut: "17:10" }], issues: [], attendanceImported: true, noAttendanceConfirmed: false, absentDays: [], scorable: true,
    });
  });

  it("flags an Employee with no rows at all, and says attendance is not imported", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await performance().importAttendance({ fileName: "a.csv", rows: [row(1, "2026-10-30")] });

    expect(await performance().attendanceFor(ana, period.id)).toMatchObject({ rows: [], issues: [{ kind: "no-attendance" }], attendanceImported: false, noAttendanceConfirmed: false });
  });

  it("flags a counted day with a time-in and no time-out, but not an excused or unscheduled one", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await performance().excuseDays(ana, period.id, ["2026-11-04"]);
    await performance().importAttendance({ fileName: "a.csv", rows: [row(1, "2026-11-02"), row(1, "2026-11-03", "08:00", null), row(1, "2026-11-04", "08:00", null), row(1, "2026-11-07", "08:00", null), row(1, "2026-11-09", "08:00", null)] });

    expect(await issues(ana, period.id)).toEqual([{ kind: "missing-time-out", date: "2026-11-03" }, { kind: "missing-time-out", date: "2026-11-09" }]);
  });

  it("raises no day issues for an Employee with no shift, who is not scored", async () => {
    const period = await performance().openPeriod(NOV);
    const cy = await employee("Cy Dela Cruz", { days: null });
    await performance().importAttendance({ fileName: "a.csv", rows: [row(1, "2026-11-03", "08:00", null)] });

    expect(await performance().attendanceFor(cy, period.id)).toMatchObject({ scorable: false, issues: [], attendanceImported: true });
  });
});

describe("resolving a day with a time-in and no time-out", () => {
  async function ready() {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await performance().importAttendance({ fileName: "a.csv", rows: [...WEEKDAYS.slice(0, 5).map((date) => row(1, date)), row(1, "2026-11-09", "08:00", null)] });
    return { period, ana };
  }

  it("marks it Excused, with an optional reason: it joins the excused days, clears the issue, and records who and when", async () => {
    const { period, ana } = await ready();
    const state = await performance().resolveDay(ana, period.id, "2026-11-09", { type: "Excused", reason: "  Approved   sick leave " });

    expect(state.issues).toEqual([]);
    const schedule = await performance().scheduleFor(ana, period.id);
    expect(schedule.scorable && schedule.excusedDays).toEqual(["2026-11-09"]);
    expect((await db.query<{ reason: string; recorded_by_name: string; recorded_at: string }>(`SELECT reason, recorded_by_name, recorded_at::text FROM hrms_excused_days`)).rows)
      .toEqual([{ reason: "Approved sick leave", recorded_by_name: "Ada Okafor", recorded_at: expect.any(String) }]);
    expect((await audit()).at(-1)).toEqual({ actor_name: "Ada Okafor", action: "day-excused", detail: { employeeId: ana, periodId: period.id, date: "2026-11-09", reason: "Approved sick leave" } });
    // The imported record is never edited.
    expect((await storedRows()).find((r) => r.date === "2026-11-09")).toEqual({ employee_id: ana, date: "2026-11-09", time_in: "08:00:00", time_out: null });
  });

  it("takes no reason for Excused", async () => {
    const { period, ana } = await ready();
    await performance().resolveDay(ana, period.id, "2026-11-09", { type: "Excused" });

    expect((await db.query<{ reason: string | null }>(`SELECT reason FROM hrms_excused_days`)).rows).toEqual([{ reason: null }]);
  });

  it("marks it Absent, which needs a reason: the day leaves the rows, so it counts as an absence, and who and when are recorded", async () => {
    const { period, ana } = await ready();
    for (const reason of [undefined, null, "", "   "]) expect(await attendanceProblem(performance().resolveDay(ana, period.id, "2026-11-09", { type: "Absent", reason: reason as never }))).toBe("reason-required");
    for (const reason of ["a\u0007b", "x".repeat(501), 5]) expect(await attendanceProblem(performance().resolveDay(ana, period.id, "2026-11-09", { type: "Absent", reason: reason as never }))).toBe("reason-invalid");
    expect(await issues(ana, period.id)).toHaveLength(1);

    const state = await performance().resolveDay(ana, period.id, "2026-11-09", { type: "Absent", reason: "Did not report; no call" });
    expect(state.issues).toEqual([]);
    expect(state.absentDays).toEqual(["2026-11-09"]);
    expect(state.rows.map((r) => r.date)).not.toContain("2026-11-09");
    expect((await db.query<{ reason: string; marked_by_name: string; marked_at: string }>(`SELECT reason, marked_by_name, marked_at::text FROM hrms_absent_days`)).rows)
      .toEqual([{ reason: "Did not report; no call", marked_by_name: "Ada Okafor", marked_at: expect.any(String) }]);
    expect((await audit()).at(-1)).toMatchObject({ action: "day-marked-absent", detail: { date: "2026-11-09", reason: "Did not report; no call" } });
    expect((await storedRows()).find((r) => r.date === "2026-11-09")?.time_out).toBeNull();
  });

  it("scores an Absent day as an absence and an Excused day as not counted", async () => {
    const { period, ana } = await ready();
    const score = async () => {
      const state = await performance().attendanceFor(ana, period.id);
      const schedule = await performance().scheduleFor(ana, period.id);
      if (!schedule.scorable) throw new Error("scorable expected");
      return scoreEvaluation({ rows: state.rows, shift: { start: "08:00", end: "17:00" }, graceMinutes: 10, scheduledDays: schedule.scheduledDays.slice(0, 6), excusedDays: schedule.excusedDays,
        training: { completed: 0, due: 0 }, rating: 80, weights: { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 } });
    };
    expect((await score()).issues).toEqual([{ kind: "missing-time-out", date: "2026-11-09" }]);

    await performance().resolveDay(ana, period.id, "2026-11-09", { type: "Absent", reason: "No call" });
    expect(await score()).toMatchObject({ issues: [], counts: { counted: 6, present: 5 } });
  });

  it("is cleared by a corrected re-import, which also retires an Absent mark", async () => {
    const { period, ana } = await ready();
    await performance().resolveDay(ana, period.id, "2026-11-09", { type: "Absent", reason: "No call" });
    expect((await performance().attendanceFor(ana, period.id)).absentDays).toEqual(["2026-11-09"]);

    await performance().importAttendance({ fileName: "corrected.csv", rows: [row(1, "2026-11-09", "08:00", "17:00")] });
    const state = await performance().attendanceFor(ana, period.id);
    expect(state.absentDays).toEqual([]);
    expect(state.rows.find((r) => r.date === "2026-11-09")).toEqual({ date: "2026-11-09", timeIn: "08:00", timeOut: "17:00" });
    expect(state.issues).toEqual([]);

    const other = await performance().openPeriod({ type: "Month", year: 2026, month: 12 });
    await performance().importAttendance({ fileName: "dec.csv", rows: [row(1, "2026-12-01", "08:00", null)] });
    expect((await performance().attendanceFor(ana, other.id)).issues).toEqual([{ kind: "missing-time-out", date: "2026-12-01" }]);
    await performance().importAttendance({ fileName: "dec-fixed.csv", rows: [row(1, "2026-12-01", "08:00", "17:00")] });
    expect((await performance().attendanceFor(ana, other.id)).issues).toEqual([]);
  });

  it("only resolves an open issue, once, within the period", async () => {
    const { period, ana } = await ready();

    expect(await attendanceProblem(performance().resolveDay(ana, period.id, "2026-11-02", { type: "Excused" }))).toBe("not-an-open-issue");
    expect(await attendanceProblem(performance().resolveDay(ana, period.id, "2026-11-10", { type: "Absent", reason: "x" }))).toBe("not-an-open-issue");
    expect(await attendanceProblem(performance().resolveDay(ana, period.id, "2026-12-01", { type: "Excused" }))).toBe("day-outside-period");
    expect(await attendanceProblem(performance().resolveDay(ana, period.id, "2026-02-30", { type: "Excused" }))).toBe("date-invalid");
    expect(await attendanceProblem(performance().resolveDay(ana, period.id, "2026-11-09", { type: "Sick" } as never))).toBe("resolution-invalid");
    expect(await attendanceProblem(performance().resolveDay(ana, period.id, "2026-11-09", null as never))).toBe("resolution-invalid");
    await performance().resolveDay(ana, period.id, "2026-11-09", { type: "Excused" });
    expect(await attendanceProblem(performance().resolveDay(ana, period.id, "2026-11-09", { type: "Absent", reason: "again" }))).toBe("not-an-open-issue");
    await expect(performance().resolveDay(999, period.id, "2026-11-09", { type: "Excused" })).rejects.toBeInstanceOf(PeriodError);
    await expect(performance().resolveDay(ana, 999, "2026-11-09", { type: "Excused" })).rejects.toBeInstanceOf(PeriodError);
  });
});

describe("confirming no attendance", () => {
  it("clears the issue, needs a reason, makes attendance imported, and records who and when", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    expect((await performance().attendanceFor(ana, period.id)).attendanceImported).toBe(false);

    for (const reason of [undefined, null, "", "   "]) expect(await attendanceProblem(performance().confirmNoAttendance(ana, period.id, reason as never))).toBe("reason-required");
    expect(await attendanceProblem(performance().confirmNoAttendance(ana, period.id, "x".repeat(501)))).toBe("reason-invalid");
    const state = await performance().confirmNoAttendance(ana, period.id, "  On unpaid leave   all month ");

    expect(state).toMatchObject({ rows: [], issues: [], attendanceImported: true, noAttendanceConfirmed: true });
    expect((await db.query<{ reason: string; confirmed_by_name: string }>(`SELECT reason, confirmed_by_name FROM hrms_attendance_confirmations`)).rows).toEqual([{ reason: "On unpaid leave all month", confirmed_by_name: "Ada Okafor" }]);
    expect((await audit()).at(-1)).toMatchObject({ actor_name: "Ada Okafor", action: "no-attendance-confirmed", detail: { reason: "On unpaid leave all month" } });
    // Confirming again is harmless and does not log twice.
    await performance().confirmNoAttendance(ana, period.id, "Same again");
    expect((await audit()).filter((a) => a.action === "no-attendance-confirmed")).toHaveLength(1);
  });

  it("counts as full absence in the score", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const state = await performance().confirmNoAttendance(ana, period.id, "On unpaid leave");
    const schedule = await performance().scheduleFor(ana, period.id);
    if (!schedule.scorable) throw new Error("scorable expected");

    const scoring = scoreEvaluation({ rows: state.rows, noAttendanceConfirmed: state.noAttendanceConfirmed, shift: { start: "08:00", end: "17:00" }, graceMinutes: 10,
      scheduledDays: schedule.scheduledDays, excusedDays: schedule.excusedDays, training: { completed: 1, due: 1 }, rating: 90, weights: { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 } });
    expect(scoring.issues).toEqual([]);
    expect(scoring.results.find((r) => r.kpi === "attendanceRate")).toMatchObject({ status: "scored", result: 0 });
  });

  it("is refused for an Employee who has rows in the period, and is cleared by a re-import that adds rows", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const bea = await employee("Bea Reyes");
    await performance().importAttendance({ fileName: "a.csv", rows: [row(2, "2026-11-02")] });
    expect(await attendanceProblem(performance().confirmNoAttendance(bea, period.id, "Leave"))).toBe("has-attendance");

    await performance().confirmNoAttendance(ana, period.id, "Leave");
    await performance().importAttendance({ fileName: "b.csv", rows: [row(1, "2026-11-03")] });
    expect(await performance().attendanceFor(ana, period.id)).toMatchObject({ noAttendanceConfirmed: false, issues: [], attendanceImported: true });
  });

  it("applies to one period only", async () => {
    const nov = await performance().openPeriod(NOV);
    const dec = await performance().openPeriod({ type: "Month", year: 2026, month: 12 });
    const ana = await employee("Ana Cruz");
    await performance().confirmNoAttendance(ana, nov.id, "Leave");

    expect((await performance().attendanceFor(ana, dec.id)).issues).toEqual([{ kind: "no-attendance" }]);
  });
});

describe("access is the Module grant alone", () => {
  it("refuses every operation to Staff without the Performance Module, whatever their role, and saves nothing", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await performance().importAttendance({ fileName: "a.csv", rows: [row(1, "2026-11-03", "08:00", null)] });
    const denied = performance(portal.signIn({ ...staff, role: "Super Admin" }, ["Training", "Employee Information"]));

    for (const call of [() => denied.previewAttendance({ periodId: period.id, rows: [row(1, "2026-11-02")] }), () => denied.importAttendance({ fileName: "b.csv", rows: [row(1, "2026-11-02")] }), () => denied.listAttendanceImports(),
      () => denied.attendanceFor(ana, period.id), () => denied.resolveDay(ana, period.id, "2026-11-03", { type: "Excused" }), () => denied.confirmNoAttendance(ana, period.id, "Leave")]) {
      await expect(call()).rejects.toMatchObject({ reason: "denied" });
    }
    expect((await storedRows()).map((r) => r.date)).toEqual(["2026-11-03"]);
    expect((await db.query(`SELECT 1 FROM hrms_excused_days`)).rows).toEqual([]);
    expect((await db.query(`SELECT 1 FROM hrms_attendance_confirmations`)).rows).toEqual([]);
  });

  it("records each Staff member's own name", async () => {
    await employee("Ana Cruz");
    const bea = portal.signIn({ ...staff, id: "u-bea", name: "Bea Reyes", username: "bea", role: "Cashier" }, ["Performance"]);
    await performance().importAttendance({ fileName: "a.csv", rows: [row(1, "2026-11-02")] });
    await performance(bea).importAttendance({ fileName: "b.csv", rows: [row(1, "2026-11-03")] });

    expect((await performance().listAttendanceImports()).map((i) => [i.fileName, i.importedByName])).toEqual([["b.csv", "Bea Reyes"], ["a.csv", "Ada Okafor"]]);
    await expect(performanceFor(undefined, db).listAttendanceImports()).rejects.toMatchObject({ reason: "invalid" });
  });
});
