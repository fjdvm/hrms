import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trainingsFor } from "@/lib/trainings";
import { HISTORY_TABS, historyHref, historyRowsFor, historyTabFromParam } from "@/lib/training-terms";
import type { MaterialFiles } from "@/lib/training-material-files";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
// 14 Nov 2026, 10:00 in Manila.
let clock: Date;
const staff = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const files: MaterialFiles = { requestUpload: vi.fn(), confirm: vi.fn(), remove: vi.fn(), viewUrl: vi.fn() };
const trainings = (sessionHandle: string | undefined = handle) => trainingsFor(sessionHandle, db, () => clock, files);

let count = 0;
async function employee(name: string, status = "Active") {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Main kitchen, Antipolo', 'Ada') RETURNING id`, [count])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, 'x@example.test', 'Production Staff', 'Production', 'Main kitchen, Antipolo', '2026-01-05', 19000, 'Full-time', 'Mon-Sat', 'None', 'Paolo', $5, 'Ada') RETURNING id`,
  [`BR-EMP-${String(count).padStart(4, "0")}`, offer, count, name, status])).rows[0].id;
}
async function assign(title: string, date: string, employeeId: number, status = "Assigned", completedOn: string | null = null, cancelled = false, startTime = "09:00") {
  const id = (await db.query<{ id: number }>(`INSERT INTO public.hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name, cancelled_at)
    VALUES ($1, 'QA Manager', $2, $3, $3::time + interval '1 hour', 'In person', 'Kitchen', 'Ada', $4) RETURNING id`, [title, date, startTime, cancelled ? "2026-11-01T00:00:00Z" : null])).rows[0].id;
  await db.query(`INSERT INTO public.hrms_training_assignments (training_id, employee_id, status, completed_on) VALUES ($1, $2, $3, $4)`, [id, employeeId, status, completedOn]);
  return id;
}

beforeEach(async () => {
  count = 0;
  clock = new Date("2026-11-14T02:00:00Z");
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  portal = new FakePortal();
  handle = portal.signIn(staff, ["Training"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** Noel's six Trainings, as in the design: two upcoming, one cancelled, two completed, one did not attend. */
async function noel() {
  const id = await employee("Noel Garcia");
  await assign("Halaya batch quality checks", "2026-11-19", id, "Assigned", null, false, "10:00");
  await assign("Food safety and hygiene refresher", "2026-11-18", id);
  await assign("Allergen labeling", "2026-11-12", id, "Cancelled", null, true, "13:00");
  await assign("Safe lifting and ergonomics", "2026-11-10", id, "Completed", "2026-11-10", false, "08:00");
  await assign("Fire safety and evacuation drill", "2026-11-05", id, "Completed", "2026-11-05", false, "08:00");
  await assign("Knife handling basics", "2026-09-14", id, "Did not attend");
  return id;
}

describe("an Employee's Training history", () => {
  it("lists every Training they were assigned to, most recent first, with result and completion date", async () => {
    const history = await trainings().history(await noel());
    expect(history.employee).toMatchObject({ name: "Noel Garcia", employeeNumber: "BR-EMP-0001", position: "Production Staff", status: "Active" });
    expect(history.rows.map((row) => [row.title, row.result, row.completedOn])).toEqual([
      ["Halaya batch quality checks", "Assigned", null],
      ["Food safety and hygiene refresher", "Assigned", null],
      ["Allergen labeling", "Cancelled", null],
      ["Safe lifting and ergonomics", "Completed", "2026-11-10"],
      ["Fire safety and evacuation drill", "Completed", "2026-11-05"],
      ["Knife handling basics", "Did not attend", null],
    ]);
    expect(history.rows[0]).toMatchObject({ trainer: "QA Manager", date: "2026-11-19", startTime: "10:00", endTime: "11:00", mode: "In person" });
  });

  it("counts each tab: All, Upcoming (assigned and still to come), Completed, Did not attend, Cancelled", async () => {
    const { counts, rows } = await trainings().history(await noel());
    expect(counts).toEqual({ All: 6, Upcoming: 2, Completed: 2, "Did not attend": 1, Cancelled: 1 });
    expect(historyRowsFor(rows, "Upcoming").map((row) => row.title)).toEqual(["Halaya batch quality checks", "Food safety and hygiene refresher"]);
    expect(historyRowsFor(rows, "Cancelled").map((row) => row.title)).toEqual(["Allergen labeling"]);
    expect(historyRowsFor(rows, "All")).toHaveLength(6);
  });

  it("reads a Cancelled Training as Cancelled and shows no completion date for anything but Completed", async () => {
    const id = await employee("Ana Dizon");
    await assign("Cancelled later", "2026-11-25", id, "Assigned", null, true);
    await assign("Stray date", "2026-11-03", id, "Did not attend", "2026-11-03");
    const rows = (await trainings().history(id)).rows;
    expect(rows.find((row) => row.title === "Cancelled later")).toMatchObject({ result: "Cancelled", upcoming: false });
    expect(rows.find((row) => row.title === "Stray date")).toMatchObject({ result: "Did not attend", completedOn: null });
  });

  it("flags a past Training whose result is still not recorded, which is in All only", async () => {
    const id = await employee("Ana Dizon");
    await assign("Past, no result", "2026-11-03", id);
    const history = await trainings().history(id);
    expect(history.rows[0]).toMatchObject({ result: "Assigned", resultsNotRecorded: true, upcoming: false });
    expect(history.counts).toEqual({ All: 1, Upcoming: 0, Completed: 0, "Did not attend": 0, Cancelled: 0 });
  });

  it("shows an Employee with no Trainings an empty history, and keeps one Employee's Trainings out of another's", async () => {
    await noel();
    const other = await employee("Bea Cruz");
    expect(await trainings().history(other)).toMatchObject({ rows: [], counts: { All: 0, Upcoming: 0 } });
  });

  it("lists the Employee records for the picker by name, and refuses an unknown Employee", async () => {
    await employee("Noel Garcia"); await employee("Ana Dizon");
    expect((await trainings().historyEmployees()).map((employee) => employee.name)).toEqual(["Ana Dizon", "Noel Garcia"]);
    await expect(trainings().history(999)).rejects.toMatchObject({ reason: "not-found" });
    await expect(trainings().history(-1)).rejects.toMatchObject({ reason: "not-found" });
  });

  it("is closed to Staff without the Training Module", async () => {
    const id = await noel();
    const denied = portal.signIn(staff, ["Employee Information"]);
    await expect(trainings(denied).history(id)).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(denied).historyEmployees()).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings("unknown").history(id)).rejects.toMatchObject({ reason: "invalid" });
  });
});

describe("the history URL state", () => {
  it("reads a tab from the URL, falling back to All, and links back to it", () => {
    expect(HISTORY_TABS.map((tab) => historyTabFromParam(tab.toLowerCase().replace(/ /g, "-")))).toEqual([...HISTORY_TABS]);
    expect(historyTabFromParam("nonsense")).toBe("All");
    expect(historyTabFromParam(undefined)).toBe("All");
    expect(historyHref(7, "All")).toBe("/training/history?employee=7");
    expect(historyHref(7, "Did not attend")).toBe("/training/history?employee=7&tab=did-not-attend");
  });
});
