import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESULTS_NOT_MARKED, TrainingReadError, performanceFor } from "@/lib/performance";
import { trainingsFor } from "@/lib/trainings";
import { resultsDue, type TrainingTotals } from "@/lib/training-terms";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
// 16 Nov 2026, 10:00 in Manila.
let clock = new Date("2026-11-16T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock);
const MONTH = { from: "2026-11-01", to: "2026-11-30" };
let employeeCount = 0;

async function employee(name: string) {
  employeeCount += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [employeeCount])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Ada') RETURNING id`,
  [`2026-${String(employeeCount).padStart(3, "0")}`, offer, employeeCount, name, `${name.split(" ")[0].toLowerCase()}@example.test`])).rows[0].id;
}
/** A Training on a date, optionally cancelled. */
async function training(title: string, date: string, { cancelled = false } = {}) {
  return (await db.query<{ id: number }>(`INSERT INTO public.hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name, cancelled_at)
    VALUES ($1, 'QA Manager', $2, '09:00', '11:00', 'In person', 'Main kitchen', 'Ada', $3) RETURNING id`, [title, date, cancelled ? "2026-11-01T00:00:00Z" : null])).rows[0].id;
}
const assign = (trainingId: number, employeeId: number, status: "Assigned" | "Completed" | "Did not attend" | "Cancelled") =>
  db.query(`INSERT INTO public.hrms_training_assignments (training_id, employee_id, status) VALUES ($1, $2, $3)`, [trainingId, employeeId, status]);

beforeEach(async () => {
  employeeCount = 0;
  clock = new Date("2026-11-16T02:00:00Z");
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

describe("an Employee's Training completion for a range", () => {
  it("counts only held, uncancelled Trainings; Did not attend and results not marked count as not completed", async () => {
    const ana = await employee("Ana Cruz");
    await assign(await training("Held, completed", "2026-11-03"), ana, "Completed");
    await assign(await training("Held, did not attend", "2026-11-05"), ana, "Did not attend");
    await assign(await training("Held, not marked", "2026-11-10"), ana, "Assigned");
    await assign(await training("Held, assignment cancelled", "2026-11-12"), ana, "Cancelled");
    await assign(await training("Training cancelled", "2026-11-08", { cancelled: true }), ana, "Assigned");
    await assign(await training("Today", "2026-11-16"), ana, "Assigned");
    await assign(await training("Later this month", "2026-11-20"), ana, "Completed");
    await assign(await training("Before the range", "2026-10-30"), ana, "Completed");
    await assign(await training("After the range", "2026-12-02"), ana, "Completed");

    expect(await performance().trainingCompletion(ana, MONTH)).toEqual({ completion: { completed: 1, due: 3, percent: 33 }, resultsNotMarked: 1 });
  });

  it("returns the number completed, the number due and the whole percentage", async () => {
    const ana = await employee("Ana Cruz");
    await assign(await training("One", "2026-11-02"), ana, "Completed");
    await assign(await training("Two", "2026-11-04"), ana, "Completed");
    await assign(await training("Three", "2026-11-06"), ana, "Completed");
    await assign(await training("Four", "2026-11-09"), ana, "Did not attend");

    expect((await performance().trainingCompletion(ana, MONTH)).completion).toEqual({ completed: 3, due: 4, percent: 75 });
    const everyone = await employee("Bea Reyes");
    await assign(await training("Five", "2026-11-11"), everyone, "Completed");
    expect((await performance().trainingCompletion(everyone, MONTH)).completion).toEqual({ completed: 1, due: 1, percent: 100 });
  });

  it("is Not applicable when nothing is due, never 0%", async () => {
    const bea = await employee("Bea Reyes");
    expect(await performance().trainingCompletion(bea, MONTH)).toEqual({ completion: null, resultsNotMarked: 0 });

    await assign(await training("Cancelled for her", "2026-11-03"), bea, "Cancelled");
    await assign(await training("Not held yet", "2026-11-25"), bea, "Assigned");
    await assign(await training("Cancelled Training", "2026-11-04", { cancelled: true }), bea, "Completed");
    await assign(await training("Out of range", "2026-09-01"), bea, "Assigned");
    expect(await performance().trainingCompletion(bea, MONTH)).toEqual({ completion: null, resultsNotMarked: 0 });
  });

  it("flags Trainings whose results are not marked, counting each Training once", async () => {
    const ana = await employee("Ana Cruz");
    await assign(await training("A", "2026-11-02"), ana, "Assigned");
    await assign(await training("B", "2026-11-03"), ana, "Assigned");
    await assign(await training("C", "2026-11-04"), ana, "Completed");

    expect(await performance().trainingCompletion(ana, MONTH)).toEqual({ completion: { completed: 1, due: 3, percent: 33 }, resultsNotMarked: 2 });
    expect(RESULTS_NOT_MARKED).toBe("Results not marked");
  });

  it("includes both ends of the range, in Manila time", async () => {
    const ana = await employee("Ana Cruz");
    await assign(await training("First day", "2026-11-03"), ana, "Completed");
    await assign(await training("Last day", "2026-11-05"), ana, "Did not attend");
    await assign(await training("Between", "2026-11-04"), ana, "Completed");

    expect((await performance().trainingCompletion(ana, { from: "2026-11-03", to: "2026-11-03" })).completion).toEqual({ completed: 1, due: 1, percent: 100 });
    expect((await performance().trainingCompletion(ana, { from: "2026-11-03", to: "2026-11-05" })).completion).toEqual({ completed: 2, due: 3, percent: 67 });
    // 01:00 on 16 Nov in Manila is still 15 Nov in UTC: a Training on the 15th has already passed.
    clock = new Date("2026-11-15T17:00:00Z");
    await assign(await training("Yesterday in Manila", "2026-11-15"), ana, "Completed");
    expect((await performance().trainingCompletion(ana, { from: "2026-11-15", to: "2026-11-15" })).completion).toEqual({ completed: 1, due: 1, percent: 100 });
    await assign(await training("Today in Manila", "2026-11-16"), ana, "Completed");
    expect((await performance().trainingCompletion(ana, { from: "2026-11-16", to: "2026-11-16" })).completion).toBeNull();
  });

  it("refuses a bad Employee, date or range, and an Employee that does not exist", async () => {
    const ana = await employee("Ana Cruz");
    for (const [id, range] of [[0, MONTH], [-1, MONTH], [1.5, MONTH], [ana, { from: "2026-11-30", to: "2026-11-01" }], [ana, { from: "2026-13-01", to: "2026-11-30" }],
      [ana, { from: "Nov 1", to: "2026-11-30" }], [ana, { from: "2026-11-01", to: "" }], [ana, undefined as unknown as { from: string; to: string }]] as const) {
      await expect(performance().trainingCompletion(id, range)).rejects.toMatchObject({ reason: "validation" });
    }
    await expect(performance().trainingCompletion(9999, MONTH)).rejects.toBeInstanceOf(TrainingReadError);
    await expect(performance().trainingCompletion(9999, MONTH)).rejects.toMatchObject({ reason: "not-found" });
  });
});

describe("the Trainings card and this read share one definition", () => {
  it("agree on the same data: the Employees' figures add up to the card's", async () => {
    const [ana, bea, cy] = [await employee("Ana Cruz"), await employee("Bea Reyes"), await employee("Cy Dela Cruz")];
    const t1 = await training("Food safety", "2026-11-03");
    const t2 = await training("POS and cash handling", "2026-11-09");
    const t3 = await training("Customer service", "2026-11-12");
    const cancelled = await training("Cancelled session", "2026-11-05", { cancelled: true });
    await training("Upcoming", "2026-11-25");
    for (const [t, e, s] of [[t1, ana, "Completed"], [t1, bea, "Completed"], [t1, cy, "Did not attend"], [t2, ana, "Did not attend"], [t2, bea, "Assigned"],
      [t3, ana, "Cancelled"], [t3, cy, "Completed"], [cancelled, ana, "Completed"], [cancelled, cy, "Assigned"]] as const) await assign(t, e, s);

    const trainingHolder = portal.signIn(staff, ["Training"]);
    const card = (await trainingsFor(trainingHolder, db, () => clock).list()).completion;
    const people = await Promise.all([ana, bea, cy].map(async (id) => (await performance().trainingCompletion(id, MONTH)).completion));

    expect(card).toEqual({ completed: 3, due: 6, percent: 50 });
    const completed = people.reduce((sum, p) => sum + (p?.completed ?? 0), 0);
    const due = people.reduce((sum, p) => sum + (p?.due ?? 0), 0);
    expect({ completed, due, percent: Math.round((completed / due) * 100) }).toEqual(card);
    expect(people.map((p) => p && [p.completed, p.due])).toEqual([[1, 2], [1, 2], [1, 2]]);
  });

  it("agree when nothing is due: the card has no completion and so does the read", async () => {
    const ana = await employee("Ana Cruz");
    await assign(await training("Not held yet", "2026-11-25"), ana, "Assigned");

    const trainingHolder = portal.signIn(staff, ["Training"]);
    expect((await trainingsFor(trainingHolder, db, () => clock).list()).completion).toBeNull();
    expect((await performance().trainingCompletion(ana, MONTH)).completion).toBeNull();
  });

  it("flags the same Trainings as results not recorded when one Employee is assigned", async () => {
    const ana = await employee("Ana Cruz");
    const trainingId = await training("Sheet not marked", "2026-11-06");
    await assign(trainingId, ana, "Assigned");

    const trainingHolder = portal.signIn(staff, ["Training"]);
    const card = await trainingsFor(trainingHolder, db, () => clock).list();
    expect(card.needResults).toEqual([{ id: trainingId, title: "Sheet not marked" }]);
    expect((await performance().trainingCompletion(ana, MONTH)).resultsNotMarked).toBe(1);
  });

  it("is one function the card and the read both call", () => {
    const rows: TrainingTotals[] = [
      { date: "2026-11-03", cancelled: false, due: 2, completed: 1, recorded: 2 },
      { date: "2026-11-05", cancelled: true, due: 3, completed: 3, recorded: 3 },
      { date: "2026-11-10", cancelled: false, due: 1, completed: 0, recorded: 0 },
      { date: "2026-11-20", cancelled: false, due: 4, completed: 0, recorded: 0 },
      { date: "2026-10-31", cancelled: false, due: 9, completed: 9, recorded: 9 },
    ];
    expect(resultsDue(rows, clock, (date) => date.startsWith("2026-11"))).toEqual({ completed: 1, due: 3, completion: { percent: 33, completed: 1, due: 3 }, notMarked: 1 });
    expect(resultsDue([], clock)).toEqual({ completed: 0, due: 0, completion: null, notMarked: 0 });
  });
});

describe("a Performance holder without Training", () => {
  it("sees the figures and no Trainings", async () => {
    const ana = await employee("Ana Cruz");
    await assign(await training("Secret title", "2026-11-03"), ana, "Completed");

    const result = await performance().trainingCompletion(ana, MONTH);
    expect(Object.keys(result).sort()).toEqual(["completion", "resultsNotMarked"]);
    expect(JSON.stringify(result)).not.toMatch(/Secret title|QA Manager|Main kitchen|2026-11-03/);
    await expect(trainingsFor(handle, db, () => clock).list()).rejects.toMatchObject({ reason: "denied" });
  });

  it("is refused to Staff without Performance, even with Training or any role", async () => {
    const ana = await employee("Ana Cruz");
    const trainingOnly = portal.signIn({ ...staff, role: "Super Admin" }, ["Training"]);

    await expect(performance(trainingOnly).trainingCompletion(ana, MONTH)).rejects.toMatchObject({ reason: "denied" });
    const signedOut = performanceFor(undefined, db, () => clock);
    await expect(signedOut.trainingCompletion(ana, MONTH)).rejects.toMatchObject({ reason: "invalid" });
  });
});
