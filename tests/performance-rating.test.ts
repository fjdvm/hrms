import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COMMENTS_MAX_LENGTH, PeriodError, RatingError, RosterError, performanceFor } from "@/lib/performance";
import { readComments, readRating } from "@/lib/performance-rating";
import { cleanMultiline, hasDisallowedText } from "@/lib/validators/text";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const clock = new Date("2026-12-01T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock);
let count = 0;
// Built from code points so no bidirectional character is ever written into this file.
const BIDI = String.fromCharCode(0x202e);
const ISOLATE = String.fromCharCode(0x2066);

async function employee(name: string, { start = "2026-01-05", days = [1, 2, 3, 4, 5] as number[] | null, status = "Active" } = {}) {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, $2, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count, start])).rows[0].id;
  const id = (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', 'Retail', 'Cainta branch', $6, 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', $7, 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, `${name.split(" ")[0].toLowerCase()}${count}@example.test`, start, status])).rows[0].id;
  if (days) await db.query(`UPDATE public.hrms_employees SET shift_start = '08:00', shift_end = '17:00', working_days = $2::smallint[] WHERE id = $1`, [id, days]);
  return id;
}
const NOV = { type: "Month", year: 2026, month: 11 } as const;
const stored = async () => (await db.query<{ employee_id: number; rating: number; comments: string; status: string; rated_by_id: string; rated_by_name: string; rated_at: string }>(
  `SELECT employee_id, rating, comments, status, rated_by_id, rated_by_name, rated_at::text FROM hrms_evaluations ORDER BY id`)).rows;
const audit = async () => (await db.query<{ actor_name: string; action: string; subject_id: string; detail: Record<string, unknown> }>(`SELECT actor_name, action, subject_id, detail FROM hrms_performance_audit WHERE action = 'rating-saved' ORDER BY id`)).rows;
const ratingProblem = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(RatingError);
  return (error as RatingError).problem;
};

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

describe("the rating and comments rules", () => {
  it("takes a whole number from 0 to 100, and nothing else", () => {
    expect([0, 1, 50, 99, 100].map(readRating)).toEqual([0, 1, 50, 99, 100]);
    for (const bad of [-1, 101, 50.5, Number.NaN, Number.POSITIVE_INFINITY, "80", null, undefined, true, [], {}, 1e3]) expect(() => readRating(bad)).toThrow(RatingError);
  });

  it("makes comments optional and cleans them, keeping line breaks", () => {
    expect([readComments(undefined), readComments(null), readComments(""), readComments("   ")]).toEqual(["", "", "", ""]);
    expect(readComments("  Reliable   and\tpunctual.  ")).toBe("Reliable and punctual.");
    expect(readComments("First line.\r\n\r\n\r\n\r\nSecond   line.\n  Third. ")).toBe("First line.\n\nSecond line.\nThird.");
    expect(readComments("Café — “quoted” ✓ 日本語 😀")).toBe("Café — “quoted” ✓ 日本語 😀");
  });

  it("refuses characters that do not belong in comments, and comments that are too long", () => {
    for (const bad of ["a\u0000b", "a\u0007b", "a\u001bb", "bad" + BIDI + "text", ISOLATE + "x", "ab", 5, {}, ["x"]]) expect(() => readComments(bad)).toThrow(expect.objectContaining({ problem: "comments-invalid" }));
    expect(readComments("x".repeat(COMMENTS_MAX_LENGTH))).toHaveLength(COMMENTS_MAX_LENGTH);
    expect(() => readComments("x".repeat(COMMENTS_MAX_LENGTH + 1))).toThrow(expect.objectContaining({ problem: "comments-too-long" }));
  });

  it("has shared text helpers that agree", () => {
    expect(cleanMultiline("a \r\n b")).toBe("a\nb");
    expect(hasDisallowedText("plain text\twith\nbreaks")).toBe(false);
    expect(hasDisallowedText("bad" + BIDI)).toBe(true);
    expect(hasDisallowedText("bad\u0000")).toBe(true);
  });
});

describe("saving a rating", () => {
  it("stores the evaluation on the first save, pins the Employee to the period and moves Draft to In review", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const before = (await performance().roster(period.id)).rows[0];
    expect(before).toMatchObject({ status: "Draft", rating: null });
    expect(await stored()).toEqual([]);

    const saved = await performance().saveRating(ana, period.id, { rating: 85, comments: "  Reliable and punctual. " });

    expect(saved).toMatchObject({ employeeId: ana, periodId: period.id, rating: 85, comments: "Reliable and punctual.", status: "In review", savedByName: "Ada Okafor" });
    expect(saved.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(await stored()).toEqual([expect.objectContaining({ employee_id: ana, rating: 85, comments: "Reliable and punctual.", status: "In review", rated_by_id: "u-ada", rated_by_name: "Ada Okafor" })]);
    const after = await performance().roster(period.id);
    expect(after.rows[0]).toMatchObject({ status: "In review", rating: 85 });
    expect(after.counts).toEqual({ All: 1, Draft: 0, "In review": 1, Evaluated: 0 });
    expect(after.progress).toEqual({ evaluated: 0, total: 1, percent: 0 });
  });

  it("keeps the Employee on the roster afterwards, whatever later happens to their record", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await performance().saveRating(ana, period.id, { rating: 70 });
    await db.query(`UPDATE hrms_employees SET status = 'Onboarding', start_date = '2027-03-01' WHERE id = $1`, [ana]);

    expect((await performance().roster(period.id)).rows.map((r) => [r.employeeId, r.status])).toEqual([[ana, "In review"]]);
    expect(await performance().saveRating(ana, period.id, { rating: 75 })).toMatchObject({ rating: 75 });
  });

  it("can be done before the attendance is imported and before the shift is set", async () => {
    const period = await performance().openPeriod(NOV);
    const noShift = await employee("Cy Dela Cruz", { days: null });
    const noAttendance = await employee("Dan Uy");

    await performance().saveRating(noShift, period.id, { rating: 60 });
    await performance().saveRating(noAttendance, period.id, { rating: 90, comments: "Strong month." });
    const detail = await performance().evaluationFor(noAttendance, period.id);
    expect(detail.status).toBe("In review");
    expect(detail.submit.checks.map((c) => [c.id, c.passed])).toEqual([["attendance-imported", false], ["shift-set", true], ["issues-resolved", false], ["rating-entered", true]]);
    expect(detail.rating).toMatchObject({ value: 90, comments: "Strong month.", savedByName: "Ada Okafor" });
    expect((await performance().evaluationFor(noShift, period.id)).submit.checks.find((c) => c.id === "shift-set")).toMatchObject({ passed: false });
    // Importing attendance afterwards changes nothing about the rating.
    await performance().importAttendance({ fileName: "a.csv", rows: [{ employeeNumber: "2026-002", date: "2026-11-02", timeIn: "08:00", timeOut: "17:00" }] });
    expect((await performance().evaluationFor(noShift, period.id)).rating?.value).toBe(60);
  });

  it("accepts the ends of the range, and optional comments", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const bea = await employee("Bea Reyes");

    expect(await performance().saveRating(ana, period.id, { rating: 0 })).toMatchObject({ rating: 0, comments: "" });
    expect(await performance().saveRating(bea, period.id, { rating: 100, comments: null })).toMatchObject({ rating: 100, comments: "" });
  });

  it("refuses a rating outside the range or not a whole number, with a specific reason, and stores nothing", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    for (const rating of [-1, 101, 85.5, Number.NaN, "85", null, undefined, true]) {
      expect(await ratingProblem(performance().saveRating(ana, period.id, { rating }))).toBe("rating-invalid");
    }
    expect(await ratingProblem(performance().saveRating(ana, period.id, undefined as never))).toBe("rating-invalid");
    expect(await stored()).toEqual([]);
    await expect(db.query(`INSERT INTO hrms_evaluations (employee_id, period_id, rating, rated_by_id, rated_by_name) VALUES (${ana}, ${period.id}, 101, 'a', 'A')`)).rejects.toThrow();
  });

  it("refuses comments with characters that do not belong, or too long, with a specific reason, and changes nothing", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await performance().saveRating(ana, period.id, { rating: 80, comments: "Original." });

    expect(await ratingProblem(performance().saveRating(ana, period.id, { rating: 90, comments: "bad\u0000" }))).toBe("comments-invalid");
    expect(await ratingProblem(performance().saveRating(ana, period.id, { rating: 90, comments: "bad" + BIDI }))).toBe("comments-invalid");
    expect(await ratingProblem(performance().saveRating(ana, period.id, { rating: 90, comments: 42 }))).toBe("comments-invalid");
    expect(await ratingProblem(performance().saveRating(ana, period.id, { rating: 90, comments: "x".repeat(COMMENTS_MAX_LENGTH + 1) }))).toBe("comments-too-long");
    expect(await stored()).toEqual([expect.objectContaining({ rating: 80, comments: "Original." })]);
  });
});

describe("changing a rating", () => {
  it("replaces the rating and comments while the evaluation is In review, and records who and when", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const bea = portal.signIn({ ...staff, id: "u-bea", name: "Bea Reyes", username: "bea", role: "Cashier" }, ["Performance"]);
    const first = await performance().saveRating(ana, period.id, { rating: 70, comments: "First view." });
    const second = await performance(bea).saveRating(ana, period.id, { rating: 88, comments: "Second view." });

    expect(second).toMatchObject({ rating: 88, comments: "Second view.", savedByName: "Bea Reyes", status: "In review" });
    expect(second.savedAt >= first.savedAt).toBe(true);
    expect(await stored()).toEqual([expect.objectContaining({ rating: 88, comments: "Second view.", rated_by_id: "u-bea", rated_by_name: "Bea Reyes" })]);
    expect((await performance().roster(period.id)).counts.All).toBe(1);
    expect((await performance().evaluationFor(ana, period.id)).rating).toMatchObject({ value: 88, savedByName: "Bea Reyes" });
  });

  it("logs every save with who made it and the previous rating", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const bea = portal.signIn({ ...staff, id: "u-bea", name: "Bea Reyes", username: "bea", role: "Cashier" }, ["Performance"]);
    await performance().saveRating(ana, period.id, { rating: 70, comments: "First." });
    await performance(bea).saveRating(ana, period.id, { rating: 88, comments: "First." });
    await performance().saveRating(ana, period.id, { rating: 88, comments: "Changed." });

    expect((await audit()).map((a) => [a.actor_name, a.subject_id, a.detail])).toEqual([
      ["Ada Okafor", `${ana}:${period.id}`, { employeeId: ana, periodId: period.id, rating: 70, previousRating: null, commentsChanged: true, first: true }],
      ["Bea Reyes", `${ana}:${period.id}`, { employeeId: ana, periodId: period.id, rating: 88, previousRating: 70, commentsChanged: false, first: false }],
      ["Ada Okafor", `${ana}:${period.id}`, { employeeId: ana, periodId: period.id, rating: 88, previousRating: 88, commentsChanged: true, first: false }],
    ]);
  });

  it("refuses a change once the evaluation is submitted, with a specific reason, and keeps what was submitted", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await performance().saveRating(ana, period.id, { rating: 80, comments: "Final." });
    await db.query(`UPDATE hrms_evaluations SET status = 'Evaluated' WHERE employee_id = $1`, [ana]);

    expect(await ratingProblem(performance().saveRating(ana, period.id, { rating: 10, comments: "Sneaky." }))).toBe("already-submitted");
    expect(await stored()).toEqual([expect.objectContaining({ rating: 80, comments: "Final.", status: "Evaluated" })]);
    expect(await audit()).toHaveLength(1);
    // A reopen puts it back In review, and the change is allowed again.
    await db.query(`UPDATE hrms_evaluations SET status = 'In review' WHERE employee_id = $1`, [ana]);
    expect(await performance().saveRating(ana, period.id, { rating: 82 })).toMatchObject({ rating: 82, status: "In review" });
  });

  it("is settled by the database when a submit lands between the check and the write", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    await performance().saveRating(ana, period.id, { rating: 80 });
    // Make the first read see an evaluation In review, then submit it before the write, as a concurrent submit would.
    const racing = performanceFor(handle, { query: async <T,>(sql: string, values?: unknown[]) => {
      const result = await db.query<T>(sql, values);
      if (/SELECT status FROM public\.hrms_evaluations/.test(sql)) await db.query(`UPDATE hrms_evaluations SET status = 'Evaluated' WHERE employee_id = $1`, [ana]);
      return { rows: result.rows as T[] };
    } }, () => clock);

    expect(await ratingProblem(racing.saveRating(ana, period.id, { rating: 5 }))).toBe("already-submitted");
    expect((await stored())[0]).toMatchObject({ rating: 80, status: "Evaluated" });
  });
});

describe("who can be rated", () => {
  it("refuses an Employee who is not on the period's roster, and an unknown Employee or period", async () => {
    const period = await performance().openPeriod(NOV);
    const onboarding = await employee("Cy Dela Cruz", { status: "Onboarding" });
    const later = await employee("Dan Uy", { start: "2026-12-07" });

    await expect(performance().saveRating(onboarding, period.id, { rating: 80 })).rejects.toBeInstanceOf(RosterError);
    await expect(performance().saveRating(later, period.id, { rating: 80 })).rejects.toMatchObject({ problem: "not-in-roster" });
    for (const id of [999, 0, -1, 1.5]) await expect(performance().saveRating(id, period.id, { rating: 80 })).rejects.toBeInstanceOf(PeriodError);
    await expect(performance().saveRating(onboarding, 999, { rating: 80 })).rejects.toBeInstanceOf(PeriodError);
    expect(await stored()).toEqual([]);
  });

  it("rates the same Employee separately in each period", async () => {
    const nov = await performance().openPeriod(NOV);
    const dec = await performance().openPeriod({ type: "Month", year: 2026, month: 12 });
    const ana = await employee("Ana Cruz");
    await performance().saveRating(ana, nov.id, { rating: 70 });
    await performance().saveRating(ana, dec.id, { rating: 90 });

    expect((await stored()).map((r) => r.rating)).toEqual([70, 90]);
    expect((await performance().roster(nov.id)).rows[0].rating).toBe(70);
    expect((await performance().roster(dec.id)).rows[0].rating).toBe(90);
  });
});

describe("access is the Module grant alone", () => {
  it("refuses a Staff member without the Performance Module, whatever their role, and saves nothing", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const denied = performance(portal.signIn({ ...staff, role: "Super Admin" }, ["Training", "Employee Information"]));

    await expect(denied.saveRating(ana, period.id, { rating: 80 })).rejects.toMatchObject({ reason: "denied" });
    await expect(performanceFor(undefined, db).saveRating(ana, period.id, { rating: 80 })).rejects.toMatchObject({ reason: "invalid" });
    expect(await stored()).toEqual([]);
    expect(await audit()).toEqual([]);
    const plain = portal.signIn({ ...staff, role: "Cashier" }, ["Performance"]);
    await expect(performance(plain).saveRating(ana, period.id, { rating: 80 })).resolves.toMatchObject({ rating: 80 });
  });
});
