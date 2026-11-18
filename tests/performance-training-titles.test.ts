import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PerformanceError, performanceFor } from "@/lib/performance";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
/** 10:00 on 1 Dec 2026 in Manila. */
const CLOCK = new Date("2026-12-01T02:00:00Z");
const performance = (session: string | undefined = handle, now: Date = CLOCK) => performanceFor(session, db, () => now);

const SECRET = { trainer: "Secret Trainer Reyes", description: "Secret description of the session", location: "Secret Venue Hall 9" };
async function training(title: string, date: string, { objectives = "", cancelled = false, time = "09:00", ...rest }: { objectives?: string; cancelled?: boolean; time?: string; trainer?: string } = {}) {
  const id = (await db.query<{ id: number }>(`INSERT INTO public.hrms_trainings (title, trainer, description, objectives, training_date, start_time, end_time, mode, location, created_by_name, cancelled_at, cancel_reason)
    VALUES ($1, $2, $3, $4, $5, $6::time, ($6::time + interval '2 hours'), 'In person', $7, 'Ada', $8, $9) RETURNING id`,
  [title, rest.trainer ?? SECRET.trainer, SECRET.description, objectives, date, time, SECRET.location, cancelled ? "2026-11-20T00:00:00Z" : null, cancelled ? "Trainer unavailable" : null])).rows[0].id;
  return id;
}
async function assign(trainingId: number, name: string, status: "Assigned" | "Completed" | "Did not attend") {
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [Math.floor(Math.random() * 1e6)])).rows[0].id;
  const employee = (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Cashier', 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Active', 'Ada') RETURNING id`,
  [`2026-${Math.floor(Math.random() * 1e6)}`, offer, Math.floor(Math.random() * 1e6), name, `${name.split(" ")[0].toLowerCase()}${Math.floor(Math.random() * 1e6)}@example.test`])).rows[0].id;
  await db.query(`INSERT INTO public.hrms_training_assignments (training_id, employee_id, status, completed_on) VALUES ($1, $2, $3, $4)`, [trainingId, employee, status, status === "Completed" ? "2026-11-20" : null]);
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
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

describe("what a Performance holder gets: titles and nothing else", () => {
  it("returns only the id and the title of each scheduled Training, with every other field kept out", async () => {
    const pos = await training("POS and cash handling", "2026-12-15", { objectives: "Count the drawer accurately" });
    await assign(pos, "Mylene Santos Private", "Completed");
    await assign(pos, "Ben Dela Cruz Private", "Assigned");
    const titles = await performance().scheduledTrainingTitles();
    expect(titles).toEqual([{ id: pos, title: "POS and cash handling" }]);
    expect(Object.keys(titles[0]).sort()).toEqual(["id", "title"]);
    const everything = JSON.stringify(titles);
    for (const secret of [SECRET.trainer, SECRET.description, SECRET.location, "Count the drawer accurately", "2026-12-15", "09:00", "In person", "Mylene", "Ben Dela", "Completed", "Assigned"]) expect(everything).not.toContain(secret);
  });
  it("is empty when no Training is scheduled", async () => {
    expect(await performance().scheduledTrainingTitles()).toEqual([]);
    expect(await performance().scheduledTrainingsForSuggestions()).toEqual([]);
  });
});

describe("which Trainings are scheduled", () => {
  it("leaves out a cancelled Training and one that has already been held, and keeps today's and later ones, nearest first", async () => {
    const later = await training("Later session", "2027-02-01");
    const today = await training("Today's session", "2026-12-01", { time: "14:00" });
    const soon = await training("Soon session", "2026-12-10");
    await training("Cancelled session", "2026-12-20", { cancelled: true });
    await training("Held last week", "2026-11-24");
    await training("Held yesterday", "2026-11-30");
    expect((await performance().scheduledTrainingTitles()).map((t) => t.id)).toEqual([today, soon, later]);
  });
  it("breaks the day at Manila midnight, not at UTC midnight", async () => {
    const id = await training("30 November session", "2026-11-30");
    // 11:59:59 PM on 30 Nov in Manila (15:59:59 UTC): still scheduled.
    expect((await performance(handle, new Date("2026-11-30T15:59:59Z")).scheduledTrainingTitles()).map((t) => t.id)).toEqual([id]);
    // 12:00:00 AM on 1 Dec in Manila (16:00:00 UTC): held.
    expect(await performance(handle, new Date("2026-11-30T16:00:00Z")).scheduledTrainingTitles()).toEqual([]);
  });
  it("is the same rule the Trainings page uses for Upcoming", async () => {
    const { trainingStatus } = await import("@/lib/training-terms");
    for (const [date, cancelled] of [["2026-11-30", false], ["2026-12-01", false], ["2026-12-02", false], ["2026-12-05", true]] as const) {
      const id = await training(`Session ${date}`, date, { cancelled });
      const listed = (await performance().scheduledTrainingTitles()).some((t) => t.id === id);
      expect(listed).toBe(trainingStatus({ date, cancelled }, CLOCK) === "Upcoming");
    }
  });
});

describe("the objectives, for the AI request only", () => {
  it("adds the objectives to the same Trainings and still returns no trainer, date, venue, assignee or result", async () => {
    const id = await training("POS and cash handling", "2026-12-15", { objectives: "Count the drawer accurately" });
    await training("Cancelled one", "2026-12-16", { cancelled: true, objectives: "Never shown" });
    await assign(id, "Mylene Santos Private", "Completed");
    const forAi = await performance().scheduledTrainingsForSuggestions();
    expect(forAi).toEqual([{ id, title: "POS and cash handling", objectives: "Count the drawer accurately" }]);
    expect(Object.keys(forAi[0]).sort()).toEqual(["id", "objectives", "title"]);
    const everything = JSON.stringify(forAi);
    for (const secret of [SECRET.trainer, SECRET.description, SECRET.location, "2026-12-15", "Mylene", "Completed", "Never shown"]) expect(everything).not.toContain(secret);
  });
  it("is the same list as the titles", async () => {
    await training("A", "2026-12-05"); await training("B", "2026-12-06"); await training("C", "2026-12-07", { cancelled: true });
    const titles = (await performance().scheduledTrainingTitles()).map((t) => t.id);
    expect((await performance().scheduledTrainingsForSuggestions()).map((t) => t.id)).toEqual(titles);
  });
});

describe("access", () => {
  it("needs the Performance Module and not the Training Module", async () => {
    await training("POS and cash handling", "2026-12-15");
    // Performance without Training: allowed.
    expect(await performance().scheduledTrainingTitles()).toHaveLength(1);
    // Performance with Training: allowed too.
    const both = portal.signIn({ ...staff, id: "u-bo", username: "bo", name: "Bo Reyes" }, ["Performance", "Training"]);
    expect(await performance(both).scheduledTrainingTitles()).toHaveLength(1);
    // Training without Performance, and neither: refused, so holding Training does not open this lookup.
    const trainingOnly = portal.signIn({ ...staff, id: "u-cy", username: "cy", name: "Cy Lim" }, ["Training"]);
    const nobody = portal.signIn({ ...staff, id: "u-di", username: "di", name: "Di Tan" }, ["Applications"]);
    for (const session of [trainingOnly, nobody]) {
      for (const lookup of [() => performance(session).scheduledTrainingTitles(), () => performance(session).scheduledTrainingsForSuggestions()]) {
        const error = await lookup().then(() => undefined, (e: unknown) => e);
        expect(error).toBeInstanceOf(PerformanceError);
        expect((error as PerformanceError).reason).toBe("denied");
      }
    }
  });
  it("refuses a lapsed session, and says so when the Portal cannot answer", async () => {
    await training("POS and cash handling", "2026-12-15");
    for (const board of [performance("nope"), performanceFor(undefined, db, () => CLOCK)]) {
      const error = await board.scheduledTrainingTitles().then(() => undefined, (e: unknown) => e);
      expect((error as PerformanceError).reason).toBe("invalid");
    }
    portal.unavailable = true;
    const down = await performance().scheduledTrainingTitles().then(() => undefined, (e: unknown) => e);
    expect((down as PerformanceError).reason).toBe("unavailable");
  });
});
