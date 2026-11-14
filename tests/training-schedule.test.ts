import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trainingsFor } from "@/lib/trainings";
import { MAX_SCHEDULE_TRAININGS, nameList, needPrintedWarning, scheduleCsv, scheduleFileName, schedulePage, schedulePageCount, scheduleRangeLabel, type ScheduleSheet, type TrainingTerms } from "@/lib/training-terms";
import type { MaterialFiles } from "@/lib/training-material-files";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
let clock: Date;
const staff = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const files: MaterialFiles = { requestUpload: vi.fn(), confirm: vi.fn(), remove: vi.fn(), viewUrl: vi.fn() };
const trainings = (sessionHandle: string | undefined = handle) => trainingsFor(sessionHandle, db, () => clock, files);
const terms = (overrides: Partial<TrainingTerms> = {}): TrainingTerms => ({
  title: "POS and cash handling", trainer: "HR", description: "", objectives: "", date: "2026-11-20", startTime: "14:00", endTime: "16:00",
  mode: "Online", location: "https://meet.example.test/pos", ...overrides,
});

let count = 0;
async function employee(name: string, email = `${name.split(" ")[0].toLowerCase()}@example.test`) {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, email])).rows[0].id;
}
const row = async (trainingId: number, employeeId: number) => (await db.query<{ printed_at: string | null; printed_date: string | null; reprint_needed: boolean }>(
  `SELECT printed_at, printed_date::text AS printed_date, reprint_needed FROM public.hrms_training_assignments WHERE training_id = $1 AND employee_id = $2`, [trainingId, employeeId])).rows[0];

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

describe("choosing Trainings for a schedule", () => {
  it("offers Trainings from today on, soonest first, and leaves out Cancelled and past ones", async () => {
    const [today, later, cancelled] = [await trainings().create(terms({ title: "Today", date: "2026-11-14", startTime: "15:00" })), await trainings().create(terms({ title: "Later", date: "2026-11-20" })), await trainings().create(terms({ title: "Cancelled", date: "2026-11-18" }))];
    await db.query(`INSERT INTO public.hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name) VALUES ('Past', 'HR', '2026-11-10', '09:00', '10:00', 'Online', 'https://x.test', 'Ada')`);
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now() WHERE id = $1`, [cancelled]);
    expect((await trainings().printable()).map((training) => [training.id, training.title])).toEqual([[today, "Today"], [later, "Later"]]);
  });
});

describe("the schedule", () => {
  async function seeded() {
    const a = await trainings().create(terms({ title: "Food safety", date: "2026-11-18", startTime: "09:00", endTime: "11:00", mode: "In person", location: "Main kitchen" }));
    const b = await trainings().create(terms());
    const [ana, bea, cy] = [await employee("Ana Dizon"), await employee("Bea Cruz", ""), await employee("Cy Reyes")];
    await trainings().assign(a, { employeeIds: [ana, bea] });
    await trainings().assign(b, { employeeIds: [bea, cy] });
    return { a, b, ana, bea, cy };
  }

  it("lists the chosen Trainings in date order with times, mode, venue or link and trainer, whatever order they were chosen in", async () => {
    const { a, b } = await seeded();
    const sheet = await trainings().schedule([b, a], { includeNames: false });
    expect(sheet.items.map((item) => [item.title, item.date, item.startTime, item.endTime, item.mode, item.location])).toEqual([
      ["Food safety", "2026-11-18", "09:00", "11:00", "In person", "Main kitchen"],
      ["POS and cash handling", "2026-11-20", "14:00", "16:00", "Online", "https://meet.example.test/pos"],
    ]);
    expect(sheet).toMatchObject({ printedOn: "2026-11-14", printedBy: "Ada Okafor", includeNames: false });
  });

  it("includes the assigned names only when asked, and always counts them", async () => {
    const { a, b } = await seeded();
    const without = await trainings().schedule([a, b], { includeNames: false });
    expect(without.items.map((item) => [item.assigned, item.assignedCount])).toEqual([[null, 2], [null, 2]]);
    const withNames = await trainings().schedule([a, b], { includeNames: true });
    expect(withNames.items.map((item) => item.assigned)).toEqual([["Ana Dizon", "Bea Cruz"], ["Bea Cruz", "Cy Reyes"]]);
  });

  it("names the no-email Employees who need a printed schedule, once each, and leaves Cancelled assignments out", async () => {
    const { a, b, bea } = await seeded();
    expect((await trainings().schedule([a, b], { includeNames: true })).needPrinted).toEqual([{ employeeId: bea, name: "Bea Cruz" }]);
    await db.query(`UPDATE public.hrms_training_assignments SET status = 'Cancelled' WHERE employee_id = $1`, [bea]);
    const sheet = await trainings().schedule([a, b], { includeNames: true });
    expect(sheet.needPrinted).toEqual([]);
    expect(sheet.items[0].assigned).toEqual(["Ana Dizon"]);
  });

  it("refuses no Trainings, too many, unknown ones and Cancelled ones", async () => {
    const { a } = await seeded();
    await expect(trainings().schedule([], { includeNames: true })).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().schedule(Array.from({ length: MAX_SCHEDULE_TRAININGS + 1 }, (_, i) => i + 1), { includeNames: true })).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().schedule([a, 999], { includeNames: true })).rejects.toMatchObject({ reason: "not-found" });
    await expect(trainings().schedule([-1], { includeNames: true })).rejects.toMatchObject({ reason: "validation" });
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now() WHERE id = $1`, [a]);
    await expect(trainings().schedule([a], { includeNames: true })).rejects.toMatchObject({ reason: "conflict" });
  });

  it("is closed to Staff without the Training Module", async () => {
    const { a } = await seeded();
    const denied = portal.signIn(staff, ["Offers"]);
    await expect(trainings(denied).printable()).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(denied).schedule([a], { includeNames: true })).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(denied).printSchedule([a], { includeNames: true })).rejects.toMatchObject({ reason: "denied" });
  });
});

describe("printing marks no-email Employees as printed", () => {
  it("marks them with when and the date on the sheet, once names are included, and not the Employees who get an email", async () => {
    const id = await trainings().create(terms());
    const [ana, bea] = [await employee("Ana Dizon"), await employee("Bea Cruz", "")];
    await trainings().assign(id, { employeeIds: [ana, bea] });
    expect(await trainings().printSchedule([id], { includeNames: true })).toMatchObject({ marked: 1 });
    expect(await row(id, bea)).toMatchObject({ printed_date: "2026-11-20", reprint_needed: false });
    expect(new Date((await row(id, bea)).printed_at!).toISOString()).toBe(clock.toISOString());
    expect(await row(id, ana)).toMatchObject({ printed_at: null, printed_date: null });
  });

  it("marks no one when the sheet has no names, since it doesn't say who it is for", async () => {
    const id = await trainings().create(terms());
    const bea = await employee("Bea Cruz", "");
    await trainings().assign(id, { employeeIds: [bea] });
    expect(await trainings().printSchedule([id], { includeNames: false })).toMatchObject({ marked: 0 });
    expect(await row(id, bea)).toMatchObject({ printed_at: null });
    // Previewing never marks anyone either.
    await trainings().schedule([id], { includeNames: true });
    expect(await row(id, bea)).toMatchObject({ printed_at: null });
  });

  it("clears Reprint needed after a reschedule, and the next reschedule flags a reprint again with the printed date as the old date", async () => {
    const id = await trainings().create(terms());
    const bea = await employee("Bea Cruz", "");
    await trainings().assign(id, { employeeIds: [bea] });
    await trainings().printSchedule([id], { includeNames: true });
    clock = new Date("2026-11-14T05:00:00Z");
    await trainings().update(id, terms({ date: "2026-11-27" }), { notify: false });
    expect(await row(id, bea)).toMatchObject({ reprint_needed: true, printed_date: "2026-11-20" });
    const logged = (await trainings().log(id)).needsPrinted[0];
    expect(logged).toMatchObject({ reprintNeeded: true, printedDate: "2026-11-20" });
    expect((await trainings().read(id)).assigned[0]).toMatchObject({ reprintNeeded: true, printedDate: "2026-11-20" });
    clock = new Date("2026-11-14T06:00:00Z");
    await trainings().printSchedule([id], { includeNames: true });
    expect(await row(id, bea)).toMatchObject({ reprint_needed: false, printed_date: "2026-11-27" });
    expect((await trainings().log(id)).needsPrinted[0]).toMatchObject({ reprintNeeded: false, printedDate: "2026-11-27" });
  });

  it("leaves Cancelled assignments and other Trainings' Employees alone", async () => {
    const [a, b] = [await trainings().create(terms()), await trainings().create(terms({ title: "Other" }))];
    const bea = await employee("Bea Cruz", "");
    await trainings().assign(a, { employeeIds: [bea] });
    await trainings().assign(b, { employeeIds: [bea] });
    await trainings().printSchedule([a], { includeNames: true });
    expect(await row(a, bea)).not.toMatchObject({ printed_at: null });
    expect(await row(b, bea)).toMatchObject({ printed_at: null });
  });
});

describe("the schedule's pure rules", () => {
  it("words the date range", () => {
    expect(scheduleRangeLabel(["2026-11-20", "2026-11-16", "2026-11-21"])).toBe("16 – 21 November 2026");
    expect(scheduleRangeLabel(["2026-11-28", "2026-12-03"])).toBe("28 November – 3 December 2026");
    expect(scheduleRangeLabel(["2026-12-30", "2027-01-02"])).toBe("30 December 2026 – 2 January 2027");
    expect(scheduleRangeLabel(["2026-11-20"])).toBe("20 November 2026");
    expect(scheduleRangeLabel([])).toBe("");
  });

  it("splits the sheet into A4 pages, fewer Trainings per page when names are listed", () => {
    const items = Array.from({ length: 12 }, (_, i) => i);
    expect(schedulePageCount({ items: items as never, includeNames: true })).toBe(3);
    expect(schedulePageCount({ items: items as never, includeNames: false })).toBe(2);
    expect(schedulePageCount({ items: [], includeNames: false })).toBe(1);
    expect(schedulePage(items, true, 2)).toEqual([10, 11]);
  });

  it("words the no-email warning and the name list", () => {
    expect(needPrintedWarning([])).toBeNull();
    expect(needPrintedWarning([{ name: "Mylene Santos" }])).toBe("1 employee on these trainings needs a printed schedule: Mylene Santos.");
    expect(needPrintedWarning([{ name: "A" }, { name: "B" }, { name: "C" }])).toBe("3 employees on these trainings need a printed schedule: A, B and C.");
    expect(nameList(["A", "B"])).toBe("A and B");
  });

  it("writes CSV with one row per Training, the names when included, and guards against spreadsheet formulas", () => {
    const sheet: ScheduleSheet = {
      printedOn: "2026-11-14", printedBy: "Ada", includeNames: true, needPrinted: [],
      items: [{ id: 1, title: '=HYPERLINK("x")', trainer: "QA, Manager", date: "2026-11-20", startTime: "14:00", endTime: "16:00", mode: "Online", location: "https://x.test", assignedCount: 2, assigned: ["Ana Dizon", "+Bea"] }],
    };
    const lines = scheduleCsv(sheet).trimEnd().split("\r\n");
    expect(lines[0]).toBe("Training,Date,Start time,End time,Mode,Venue or meeting link,Trainer,Assigned,Assigned employees");
    expect(lines[1]).toBe('"\'=HYPERLINK(""x"")",2026-11-20,14:00,16:00,Online,https://x.test,"QA, Manager",2,Ana Dizon; +Bea');
    expect(scheduleCsv({ ...sheet, includeNames: false, items: [{ ...sheet.items[0], assigned: null }] }).split("\r\n")[0]).not.toContain("Assigned employees");
    // A cell that starts with a formula character is guarded; the joined names start with a letter here.
    expect(scheduleCsv({ ...sheet, items: [{ ...sheet.items[0], assigned: ["=Ana"] }] }).split("\r\n")[1]).toContain(",'=Ana")
    expect(scheduleFileName(sheet, "csv")).toBe("training-schedule-2026-11-14.csv");
  });
});
