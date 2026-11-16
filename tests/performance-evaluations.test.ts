import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeriodError, RosterError, performanceFor, type RawAttendanceRow, type RosterRow } from "@/lib/performance";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
// 1 Dec 2026, 10:00 in Manila: November is over.
const clock = new Date("2026-12-01T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock);
let count = 0;

type Options = { start?: string; days?: number[] | null; status?: string; position?: string; branch?: string };
/** An Employee numbered 2026-001, 2026-002 ... with a Mon–Fri shift of 8 AM to 5 PM unless `days` says otherwise. */
async function employee(name: string, { start = "2026-01-05", days = [1, 2, 3, 4, 5], status = "Active", position = "Branch Cashier", branch = "Cainta branch" }: Options = {}) {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, $2, 'Full-time', 'Mon-Fri', 'None', 'Paolo', $3, 'Ada') RETURNING id`, [count, start, branch])).rows[0].id;
  const id = (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, $6, 'Retail', $7, $8, 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', $9, 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, `${name.split(" ")[0].toLowerCase()}${count}@example.test`, position, branch, start, status])).rows[0].id;
  if (days) await db.query(`UPDATE public.hrms_employees SET shift_start = '08:00', shift_end = '17:00', working_days = $2::smallint[] WHERE id = $1`, [id, days]);
  return id;
}
const NUMBER = (id: number) => `2026-${String(id).padStart(3, "0")}`;
const WEEKDAYS = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`).filter((d) => {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
});
/** A full month of on-time Mon–Fri attendance for an Employee. */
const fullMonth = (id: number): RawAttendanceRow[] => WEEKDAYS.map((date) => ({ employeeNumber: NUMBER(id), date, timeIn: "08:00", timeOut: "17:00" }));
const attend = (id: number) => performance().importAttendance({ fileName: `emp-${id}.csv`, rows: fullMonth(id) });
/** Saves an evaluation the way the later tickets will: a row with a rating. */
const save = (employeeId: number, periodId: number, rating: number, status: "In review" | "Evaluated" = "In review", comments = "") =>
  db.query(`INSERT INTO hrms_evaluations (employee_id, period_id, rating, comments, status, rated_by_id, rated_by_name) VALUES ($1, $2, $3, $4, $5, 'u-ada', 'Ada Okafor')`, [employeeId, periodId, rating, comments, status]);
/** Trainings held in November that the Employee was assigned, with a result each. */
async function train(employeeId: number, results: ("Completed" | "Did not attend" | "Assigned")[]) {
  let day = 2;
  for (const status of results) {
    const t = (await db.query<{ id: number }>(`INSERT INTO public.hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name)
      VALUES ('Session', 'QA', $1, '09:00', '11:00', 'In person', 'Kitchen', 'Ada') RETURNING id`, [`2026-11-${String(day++).padStart(2, "0")}`])).rows[0].id;
    await db.query(`INSERT INTO public.hrms_training_assignments (training_id, employee_id, status) VALUES ($1, $2, $3)`, [t, employeeId, status]);
  }
}
const NOV = { type: "Month", year: 2026, month: 11 } as const;
const row = (rows: RosterRow[], id: number) => rows.find((r) => r.employeeId === id)!;
const tableCounts = async () => (await db.query<{ n: number }>(`SELECT (SELECT count(*) FROM hrms_evaluations) + (SELECT count(*) FROM hrms_excused_days) + (SELECT count(*) FROM hrms_performance_attendance) + (SELECT count(*) FROM hrms_performance_audit) + (SELECT count(*) FROM hrms_attendance_confirmations) AS n`)).rows[0].n;

beforeEach(async () => {
  count = 0;
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

describe("who is on the roster", () => {
  it("is every Active Employee whose start date is on or before the period's end, and not an Onboarding one", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const bea = await employee("Bea Reyes", { start: "2026-11-30" });
    await employee("Cy Dela Cruz", { status: "Onboarding" });
    await employee("Dan Uy", { start: "2026-12-01" });

    const { rows, counts } = await performance().roster(period.id);
    expect(rows.map((r) => r.employeeId)).toEqual([ana, bea]);
    expect(counts.All).toBe(2);
  });

  it("picks up an Employee who becomes Active, or gets a shift, mid-period with no enrolment", async () => {
    const period = await performance().openPeriod(NOV);
    await employee("Ana Cruz");
    const cy = await employee("Cy Dela Cruz", { status: "Onboarding", days: null });
    expect((await performance().roster(period.id)).rows.map((r) => r.employeeId)).not.toContain(cy);

    await db.query(`UPDATE hrms_employees SET status = 'Active' WHERE id = $1`, [cy]);
    expect(row((await performance().roster(period.id)).rows, cy).score).toEqual({ outcome: "not-scored", reason: "shift-missing" });
    await db.query(`UPDATE hrms_employees SET shift_start = '08:00', shift_end = '17:00', working_days = ARRAY[1,2,3,4,5]::smallint[] WHERE id = $1`, [cy]);
    expect(row((await performance().roster(period.id)).rows, cy).shift).toEqual({ start: "08:00", end: "17:00", workingDays: [1, 2, 3, 4, 5] });
  });

  it("keeps an Employee in the period once an evaluation is saved, whatever later happens to their record", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const bea = await employee("Bea Reyes");
    await save(ana, period.id, 90, "Evaluated");
    await save(bea, period.id, 70);
    await db.query(`UPDATE hrms_employees SET status = 'Onboarding' WHERE id = $1`, [ana]);
    await db.query(`UPDATE hrms_employees SET start_date = '2027-03-01' WHERE id = $1`, [bea]);

    const { rows } = await performance().roster(period.id);
    expect(rows.map((r) => [r.employeeId, r.status])).toEqual([[ana, "Evaluated"], [bea, "In review"]]);
    expect((await performance().evaluationFor(bea, period.id)).status).toBe("In review");
  });

  it("is in name order, and another period's evaluations do not pin anyone here", async () => {
    const nov = await performance().openPeriod(NOV);
    const dec = await performance().openPeriod({ type: "Month", year: 2026, month: 12 });
    const bea = await employee("Bea Reyes");
    const ana = await employee("Ana Cruz");
    const late = await employee("Eli Ramos", { status: "Onboarding" });
    await save(late, dec.id, 80);

    expect((await performance().roster(nov.id)).rows.map((r) => r.employeeId)).toEqual([ana, bea]);
    expect((await performance().roster(dec.id)).rows.map((r) => r.employeeId)).toEqual([ana, bea, late]);
  });
});

describe("the derived status", () => {
  it("is Draft until a rating is saved, In review after, and Evaluated once submitted; a reopen returns it to In review", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const status = async () => row((await performance().roster(period.id)).rows, ana).status;

    expect(await status()).toBe("Draft");
    await save(ana, period.id, 85);
    expect(await status()).toBe("In review");
    await db.query(`UPDATE hrms_evaluations SET status = 'Evaluated' WHERE employee_id = $1`, [ana]);
    expect(await status()).toBe("Evaluated");
    expect((await performance().evaluationFor(ana, period.id)).status).toBe("Evaluated");
    await db.query(`UPDATE hrms_evaluations SET status = 'In review' WHERE employee_id = $1`, [ana]);
    expect(await status()).toBe("In review");
  });
});

describe("the tab counts and progress", () => {
  it("counts every tab, reports 3 of 8 evaluated, and narrows only the rows by tab", async () => {
    const period = await performance().openPeriod(NOV);
    const ids: number[] = [];
    for (const name of ["Ana", "Bea", "Cy", "Dan", "Eli", "Fay", "Gus", "Hal"]) ids.push(await employee(`${name} Test`, { days: name === "Hal" ? null : [1, 2, 3, 4, 5] }));
    for (const id of ids.slice(0, 3)) await save(id, period.id, 90, "Evaluated");
    for (const id of ids.slice(3, 5)) await save(id, period.id, 70);

    const all = await performance().roster(period.id);
    expect(all.counts).toEqual({ All: 8, Draft: 3, "In review": 2, Evaluated: 3 });
    expect(all.progress).toEqual({ evaluated: 3, total: 8, percent: 38 });
    expect(all.rows).toHaveLength(8);
    for (const tab of ["Draft", "In review", "Evaluated"] as const) {
      const narrowed = await performance().roster(period.id, tab);
      expect(narrowed.rows.map((r) => r.status)).toEqual(Array(all.counts[tab]).fill(tab));
      expect(narrowed.counts).toEqual(all.counts);
      expect(narrowed.progress).toEqual(all.progress);
    }
    await expect(performance().roster(period.id, "Submitted" as never)).rejects.toMatchObject({ problem: "unknown-tab" });
  });

  it("names the Employees not scored for a missing shift", async () => {
    const period = await performance().openPeriod(NOV);
    await employee("Ana Cruz");
    const bea = await employee("Bea Reyes", { days: null });
    const cy = await employee("Cy Dela Cruz", { days: null });

    expect((await performance().roster(period.id)).notScored).toEqual([
      { employeeId: bea, employeeNumber: "2026-002", name: "Bea Reyes" },
      { employeeId: cy, employeeNumber: "2026-003", name: "Cy Dela Cruz" },
    ]);
  });

  it("is 0 of 0 for an empty roster", async () => {
    const period = await performance().openPeriod(NOV);

    expect(await performance().roster(period.id)).toMatchObject({ rows: [], counts: { All: 0, Draft: 0, "In review": 0, Evaluated: 0 }, progress: { evaluated: 0, total: 0, percent: 0 }, notScored: [] });
  });
});

describe("each row", () => {
  it("returns the position, branch, shift, scheduled and excused days, attendance status, KPI results, weighted score and weight set", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz", { position: "stock   clerk", branch: "Antipolo branch" });
    await attend(ana);
    await train(ana, ["Completed", "Completed"]);
    await save(ana, period.id, 80);
    await performance().excuseDays(ana, period.id, ["2026-11-10"]);
    await performance().saveWeightSet({ position: "Stock Clerk", weights: { attendanceRate: 40, punctuality: 20, fullShift: 10, trainingCompletion: 10, evaluatorRating: 20 } });

    const result = row((await performance().roster(period.id)).rows, ana);
    expect(result).toMatchObject({
      employeeNumber: "2026-001", name: "Ana Cruz", position: "stock   clerk", branch: "Antipolo branch", status: "In review", rating: 80,
      shift: { start: "08:00", end: "17:00", workingDays: [1, 2, 3, 4, 5] }, scheduledDays: 21, excusedDays: 1,
      attendance: { imported: true, confirmedNone: false, openIssues: 0 }, weightSet: { name: "Stock Clerk", isDefault: false },
    });
    // The position set's weights: 40 x 100 + 20 x 100 + 10 x 100 + 10 x 100 + 20 x 80, over 100 = 96.
    expect(result.score).toEqual({ outcome: "scored", value: 96 });
    expect(result.kpis.map((k) => [k.id, k.status, k.result, k.weight, k.points])).toEqual([
      ["attendanceRate", "scored", 100, 40, 40], ["punctuality", "scored", 100, 20, 20], ["fullShift", "scored", 100, 10, 10], ["trainingCompletion", "scored", 100, 10, 10], ["evaluatorRating", "scored", 80, 20, 16],
    ]);
    expect(result.kpis[0]).toMatchObject({ name: "Attendance rate", source: "Attendance import", target: "100%" });
  });

  it("uses the default set when the position has none, and says so by name", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await attend(ana);
    await train(ana, ["Completed", "Completed"]);
    await save(ana, period.id, 80);

    const result = row((await performance().roster(period.id)).rows, ana);
    expect(result.weightSet).toMatchObject({ name: "Default set", isDefault: true });
    // Default weights 30, 25, 15, 15, 15: 30 + 25 + 15 + 15 + 12 = 97.
    expect(result.score).toEqual({ outcome: "scored", value: 97 });
  });

  it("scores Training completion for the same period, counting results not marked as not completed and flagging them", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await attend(ana);
    await train(ana, ["Completed", "Did not attend", "Assigned", "Completed"]);
    await save(ana, period.id, 100);

    const result = row((await performance().roster(period.id)).rows, ana);
    const training = result.kpis.find((k) => k.id === "trainingCompletion")!;
    expect(training).toMatchObject({ status: "scored", result: 50, flag: "Results not marked" });
    // 30 + 25 + 15 + 50 x 15 / 100 + 15 = 92.5.
    expect(result.score).toEqual({ outcome: "scored", value: 92.5 });
    expect((await performance().evaluationFor(ana, period.id)).resultsNotMarked).toBe(1);
  });

  it("leaves a Not-applicable Training out, rescales the other weights, and keeps the Submit lock off it", async () => {
    const period = await performance().openPeriod(NOV);
    const bea = await employee("Bea Reyes");
    await attend(bea);
    await save(bea, period.id, 70);

    const detail = await performance().evaluationFor(bea, period.id);
    const training = detail.kpis.find((k) => k.id === "trainingCompletion")!;
    expect(training).toMatchObject({ status: "not-applicable", result: null, reason: "no-training-due", points: null, flag: null });
    // (100 x 30 + 100 x 25 + 100 x 15 + 70 x 15) / 85 = 8050 / 85 = 94.7.
    expect(detail.score).toEqual({ outcome: "scored", value: 94.7 });
    expect(Object.values(detail.weightsUsed).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    expect(detail.submit.unlocked).toBe(true);
  });

  it("returns 'not scored: shift missing' for an Employee with no shift", async () => {
    const period = await performance().openPeriod(NOV);
    const cy = await employee("Cy Dela Cruz", { days: null });
    await save(cy, period.id, 90);

    const result = row((await performance().roster(period.id)).rows, cy);
    expect(result).toMatchObject({ shift: null, scheduledDays: null, excusedDays: null, kpis: [], score: { outcome: "not-scored", reason: "shift-missing" } });
    const detail = await performance().evaluationFor(cy, period.id);
    expect(detail).toMatchObject({ shift: null, scheduledDays: [], score: { outcome: "not-scored", reason: "shift-missing" } });
    expect(detail.submit.checks.find((c) => c.id === "shift-set")).toMatchObject({ passed: false });
  });

  it("returns Insufficient data when too little weight remains", async () => {
    const period = await performance().openPeriod(NOV);
    const dan = await employee("Dan Uy");

    // No attendance, no Training due and no rating: nothing is left to score.
    const result = row((await performance().roster(period.id)).rows, dan);
    expect(result.score).toEqual({ outcome: "insufficient-data" });
    expect(result.attendance).toEqual({ imported: false, confirmedNone: false, openIssues: 1 });
    expect(result.kpis.map((k) => k.status)).toEqual(["not-applicable", "not-applicable", "not-applicable", "not-applicable", "not-applicable"]);
  });

  it("scores a confirmed no-attendance as full absence", async () => {
    const period = await performance().openPeriod(NOV);
    const eli = await employee("Eli Ramos");
    await train(eli, ["Completed"]);
    await save(eli, period.id, 100);
    await performance().confirmNoAttendance(eli, period.id, "On unpaid leave");

    const result = row((await performance().roster(period.id)).rows, eli);
    expect(result.attendance).toEqual({ imported: true, confirmedNone: true, openIssues: 0 });
    expect(result.kpis.find((k) => k.id === "attendanceRate")).toMatchObject({ status: "scored", result: 0 });
    // Attendance 30, Training 15 and Rating 15 remain (60 of 100): (0 x 30 + 100 x 15 + 100 x 15) / 60 = 50.
    expect(result.score).toEqual({ outcome: "scored", value: 50 });
  });

  it("leaves a deactivated KPI out of the score", async () => {
    const period = await performance().openPeriod(NOV);
    const fay = await employee("Fay Lim");
    await attend(fay);
    await train(fay, ["Completed"]);
    await save(fay, period.id, 80);
    await performance().setKpiStatus("fullShift", "Inactive");

    const result = row((await performance().roster(period.id)).rows, fay);
    expect(result.kpis.find((k) => k.id === "fullShift")).toMatchObject({ status: "not-applicable", reason: "inactive" });
    // (100 x 30 + 100 x 25 + 100 x 15 + 80 x 15) / 85 = 96.5.
    expect(result.score).toEqual({ outcome: "scored", value: 96.5 });
  });
});

describe("one Employee's evaluation", () => {
  it("returns the period figures, the KPI results, the weight set and rating with comments", async () => {
    const period = await performance().openPeriod({ ...NOV, graceMinutes: 15 });
    const ana = await employee("Ana Cruz");
    await attend(ana);
    await save(ana, period.id, 85, "In review", "Reliable and punctual.");
    await performance().excuseDays(ana, period.id, ["2026-11-04"]);
    await performance().addNonWorkingDate({ date: "2026-11-30", name: "Bonifacio Day", type: "Holiday" });

    const detail = await performance().evaluationFor(ana, period.id);
    expect(detail).toMatchObject({
      employeeId: ana, name: "Ana Cruz", status: "In review", graceMinutes: 15, period: { name: "November 2026", start: "2026-11-01", end: "2026-11-30" },
      excusedDays: ["2026-11-04"], rating: { value: 85, comments: "Reliable and punctual." }, weightSet: { name: "Default set" }, weights: { attendanceRate: 30 },
    });
    expect(detail.scheduledDays).toHaveLength(20);
    expect(detail.scheduledDays).not.toContain("2026-11-30");
    expect(detail.kpis).toHaveLength(5);
    // The roster row and the page come from the same figures.
    const listed = row((await performance().roster(period.id)).rows, ana);
    expect(detail.score).toEqual(listed.score);
    expect(detail.kpis).toEqual(listed.kpis);
  });

  it("returns the four Submit checks, each with its state and a reason for the banner", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");

    let detail = await performance().evaluationFor(ana, period.id);
    expect(detail.submit.checks.map((c) => [c.label, c.passed])).toEqual([["Attendance imported", false], ["Shift set", true], ["Attendance issues resolved", false], ["Rating entered", false]]);
    expect(detail.submit).toMatchObject({ unlocked: false, reason: "Attendance has not been imported for this period. Import it, or confirm there was none." });
    expect(detail.rating).toBeNull();

    await performance().importAttendance({ fileName: "a.csv", rows: [...fullMonth(ana).slice(0, 19), { employeeNumber: NUMBER(ana), date: "2026-11-27", timeIn: "08:00", timeOut: null }, { employeeNumber: NUMBER(ana), date: "2026-11-30", timeIn: "08:00", timeOut: null }] });
    detail = await performance().evaluationFor(ana, period.id);
    expect(detail.issues).toEqual([{ kind: "missing-time-out", date: "2026-11-27" }, { kind: "missing-time-out", date: "2026-11-30" }]);
    expect(detail.submit).toMatchObject({ unlocked: false, reason: "2 attendance issues to resolve.", action: null });

    await performance().resolveDay(ana, period.id, "2026-11-27", { type: "Excused" });
    await performance().resolveDay(ana, period.id, "2026-11-30", { type: "Absent", reason: "No call" });
    detail = await performance().evaluationFor(ana, period.id);
    expect(detail.submit).toMatchObject({ unlocked: false, reason: "Enter the rating.", action: "enter-rating" });
    expect(detail.submit.checks.map((c) => c.passed)).toEqual([true, true, true, false]);

    await save(ana, period.id, 90);
    detail = await performance().evaluationFor(ana, period.id);
    expect(detail.submit).toMatchObject({ unlocked: true, reason: null, action: null });
  });

  it("refuses an Employee who is not in the period's roster, an unknown Employee or period", async () => {
    const period = await performance().openPeriod(NOV);
    const onboarding = await employee("Cy Dela Cruz", { status: "Onboarding" });
    const later = await employee("Dan Uy", { start: "2026-12-07" });

    for (const id of [onboarding, later]) await expect(performance().evaluationFor(id, period.id)).rejects.toBeInstanceOf(RosterError);
    await expect(performance().evaluationFor(onboarding, period.id)).rejects.toMatchObject({ problem: "not-in-roster" });
    await expect(performance().evaluationFor(999, period.id)).rejects.toBeInstanceOf(PeriodError);
    await expect(performance().evaluationFor(0, period.id)).rejects.toBeInstanceOf(PeriodError);
    await expect(performance().evaluationFor(onboarding, 999)).rejects.toBeInstanceOf(PeriodError);
    await expect(performance().roster(999)).rejects.toBeInstanceOf(PeriodError);
  });
});

describe("a read model that writes nothing", () => {
  it("leaves every table as it was", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await attend(ana);
    await save(ana, period.id, 80);
    const before = await tableCounts();

    await performance().roster(period.id);
    await performance().evaluationFor(ana, period.id);
    expect(await tableCounts()).toBe(before);
    // Saving a rating, submitting and reopening are their own operations. Reading is what must write nothing.
    expect(Object.keys(performance()).filter((name) => /^(saveEvaluation|updateEvaluation)/i.test(name))).toEqual([]);
  });
});

describe("access is the Module grant alone", () => {
  it("refuses the roster and the evaluation to Staff without the Performance Module, whatever their role", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const denied = performance(portal.signIn({ ...staff, role: "Super Admin" }, ["Training", "Employee Information"]));

    await expect(denied.roster(period.id)).rejects.toMatchObject({ reason: "denied" });
    await expect(denied.evaluationFor(ana, period.id)).rejects.toMatchObject({ reason: "denied" });
    await expect(performanceFor(undefined, db).roster(period.id)).rejects.toMatchObject({ reason: "invalid" });
    const plain = portal.signIn({ ...staff, role: "Cashier" }, ["Performance"]);
    await expect(performance(plain).roster(period.id)).resolves.toMatchObject({ counts: { All: 1 } });
  });
});
