import { shiftTrainingCalendar, trainingCalendarHref, trainingCalendarRange, trainingCalendarState, trainingCalendarTitle } from "@/lib/training-calendar";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trainingsFor, TrainingError } from "@/lib/trainings";
import type { MaterialFiles } from "@/lib/training-material-files";
import { MATERIAL_MAX_BYTES, formatSize, materialProblem, formatTrainingDate, formatTrainingTimes, readTrainingForm, trainingStatus, type TrainingTerms } from "@/lib/training-terms";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
// 14 Nov 2026, 10:00 in Manila.
let clock = new Date("2026-11-14T02:00:00Z");
const staff = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
let employeeCount = 0;
/** An Employee record (with its Offer), as hiring leaves it. An empty email means the Employee has none. */
async function employee(name: string, { email = `${name.split(" ")[0].toLowerCase()}@example.test`, department = "Retail", branch = "Cainta branch" } = {}) {
  employeeCount += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Sat', 'None', 'Paolo', $2, 'Ada') RETURNING id`, [employeeCount, branch])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', $6, $7, '2026-01-05', 19000, 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Ada') RETURNING id`,
  [`2026-${String(employeeCount).padStart(3, "0")}`, offer, employeeCount, name, email, department, branch])).rows[0].id;
}

const files = {
  requestUpload: vi.fn<MaterialFiles["requestUpload"]>(), confirm: vi.fn<MaterialFiles["confirm"]>(),
  remove: vi.fn<MaterialFiles["remove"]>(), viewUrl: vi.fn<MaterialFiles["viewUrl"]>(),
};
let nextFile = 0;
const trainings = (sessionHandle: string | undefined = handle) => trainingsFor(sessionHandle, db, () => clock, files);
const terms = (overrides: Partial<TrainingTerms> = {}): TrainingTerms => ({
  title: "Food safety and hygiene refresher", trainer: "QA Manager", description: "", objectives: "", date: "2026-11-18",
  startTime: "09:00", endTime: "11:00", mode: "In person", location: "Main kitchen, Antipolo", ...overrides,
});

beforeEach(async () => {
  nextFile = 0;
  employeeCount = 0;
  files.requestUpload.mockReset().mockImplementation(async () => ({ fileId: `file-${++nextFile}`, uploadUrl: "https://files.test/put" }));
  files.confirm.mockReset().mockResolvedValue(undefined);
  files.remove.mockReset().mockResolvedValue(undefined);
  files.viewUrl.mockReset().mockResolvedValue("https://files.test/signed");
  clock = new Date("2026-11-14T02:00:00Z");
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
  handle = portal.signIn(staff, ["Training"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});

afterEach(async () => {
  if (!db.closed) await db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("derived Training status in Manila time", () => {
  const at = (iso: string) => new Date(iso);
  it("is Upcoming up to and including the day itself, then Completed", () => {
    // 15 Nov 23:59 in Manila is 15:59 UTC; 16 Nov 00:00 in Manila is 16:00 UTC the day before.
    expect(trainingStatus({ date: "2026-11-15", cancelled: false }, at("2026-11-15T15:59:00Z"))).toBe("Upcoming");
    expect(trainingStatus({ date: "2026-11-15", cancelled: false }, at("2026-11-15T16:00:00Z"))).toBe("Completed");
  });
  it("is Cancelled whatever the date, and never chosen", () => {
    expect(trainingStatus({ date: "2020-01-01", cancelled: true })).toBe("Cancelled");
    expect(trainingStatus({ date: "2999-01-01", cancelled: true })).toBe("Cancelled");
  });
});

describe("Trainings list", () => {
  it("creates Trainings and lists them with counts for All / Upcoming / Past / Cancelled", async () => {
    clock = new Date("2026-11-01T00:00:00Z");
    const past = await trainings().create(terms({ title: "Customer service basics", date: "2026-11-03" }));
    await trainings().create(terms({ title: "Allergen labeling", date: "2026-11-12" }));
    await trainings().create(terms({ title: "POS and cash handling", date: "2026-11-20", mode: "Online", location: "https://meet.example.com/pos" }));
    await trainings().create(terms({ title: "Halaya checks", date: "2026-11-19" }));
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now() WHERE title = 'Allergen labeling'`);
    clock = new Date("2026-11-14T02:00:00Z");

    const all = await trainings().list();
    expect(all.counts).toEqual({ All: 4, Upcoming: 2, Past: 1, Cancelled: 1 });
    expect(all.thisMonth).toBe(4);
    expect(all.rows.map((row) => [row.title, row.status])).toEqual([
      ["Halaya checks", "Upcoming"], ["POS and cash handling", "Upcoming"], ["Allergen labeling", "Cancelled"], ["Customer service basics", "Completed"],
    ]);
    expect((await trainings().list("Upcoming")).rows.map((row) => row.title)).toEqual(["Halaya checks", "POS and cash handling"]);
    expect((await trainings().list("Past")).rows.map((row) => row.id)).toEqual([past]);
    expect((await trainings().list("Cancelled")).rows.map((row) => row.title)).toEqual(["Allergen labeling"]);
  });

  it("stores the title, trainer, description, objectives, one date and time, Mode and link or venue", async () => {
    await trainings().create(terms({ description: "  What it covers ", objectives: "One\n\n  Two  ", mode: "Online", location: "https://meet.example.com/a" }));
    const [row] = (await trainings().list()).rows;
    expect(row).toMatchObject({ title: "Food safety and hygiene refresher", trainer: "QA Manager", date: "2026-11-18", startTime: "09:00", endTime: "11:00", mode: "Online", status: "Upcoming", assigned: 0, completed: 0 });
    const stored = (await db.query<{ description: string; objectives: string; location: string; created_by_name: string }>(`SELECT * FROM public.hrms_trainings`)).rows[0];
    expect(stored).toMatchObject({ description: "What it covers", objectives: "One\nTwo", location: "https://meet.example.com/a", created_by_name: "Ada Okafor" });
  });

  it("counts Assigned and Completed employees and flags a past Training with no result recorded", async () => {
    clock = new Date("2026-11-01T00:00:00Z");
    const recorded = await trainings().create(terms({ date: "2026-11-05" }));
    const unrecorded = await trainings().create(terms({ title: "Safe lifting", date: "2026-11-10" }));
    clock = new Date("2026-11-14T02:00:00Z");
    const [ana, bea] = [await employee("Ana Dizon"), await employee("Bea Cruz")];
    await db.exec(`INSERT INTO public.hrms_training_assignments (training_id, employee_id, status) VALUES
      (${recorded}, ${ana}, 'Completed'), (${recorded}, ${bea}, 'Did not attend'), (${unrecorded}, ${ana}, 'Assigned'), (${unrecorded}, ${bea}, 'Assigned')`);
    const rows = Object.fromEntries((await trainings().list()).rows.map((row) => [row.id, row]));
    expect(rows[recorded]).toMatchObject({ assigned: 2, completed: 1, resultsNotRecorded: false });
    expect(rows[unrecorded]).toMatchObject({ assigned: 2, completed: 0, resultsNotRecorded: true });
  });

  it("refuses every operation without the Training Module", async () => {
    const other = portal.signIn(staff, ["Offers"]);
    await expect(trainings(other).list()).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(other).create(terms())).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings("unknown-handle").list()).rejects.toBeInstanceOf(TrainingError);
    portal.unavailable = true;
    await expect(trainings().list()).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("refuses an invalid Training without saving it", async () => {
    await expect(trainings().create(terms({ title: "  " }))).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().create(terms({ date: "2026-11-13" }))).rejects.toMatchObject({ reason: "validation" });
    expect((await trainings().list()).counts.All).toBe(0);
  });
});

describe("the New training form's rules", () => {
  const raw = (overrides: Record<string, string> = {}) => ({ ...terms(), ...overrides });

  it("normalises whitespace and accepts a complete form", () => {
    const { terms: result, errors } = readTrainingForm(raw({ title: "  Fire   safety  ", location: " Main  kitchen " }), "2026-11-14");
    expect(errors).toEqual({});
    expect(result).toMatchObject({ title: "Fire safety", location: "Main kitchen" });
  });

  it("rejects, with a message and without stripping, markup in text fields", () => {
    const { terms: result, errors } = readTrainingForm(raw({ title: "<b>Hi</b>", trainer: "Ana\u0007" }), "2026-11-14");
    expect(result).toBeNull();
    expect(errors.title).toMatch(/without < or >/);
    expect(errors.trainer).toBeDefined();
  });

  it("needs every required field, a future date, an end after the start, and a link when Online", () => {
    const { errors } = readTrainingForm({ title: "", trainer: "", date: "2026-11-13", startTime: "10:00", endTime: "09:00", mode: "Online", location: "not a link" }, "2026-11-14");
    expect(Object.keys(errors).sort()).toEqual(["date", "endTime", "location", "title", "trainer"]);
    expect(readTrainingForm(raw({ date: "2026-11-14" }), "2026-11-14").errors.date).toBeUndefined();
    expect(readTrainingForm(raw({ mode: "Hybrid" }), "2026-11-14").errors.mode).toBeDefined();
  });

  it("formats dates and times as the list shows them", () => {
    expect(formatTrainingDate("2026-11-16")).toBe("Mon, 16 Nov 2026");
    expect(formatTrainingTimes("08:00", "09:00")).toBe("8:00 – 9:00 AM");
    expect(formatTrainingTimes("11:00", "13:30")).toBe("11:00 AM – 1:30 PM");
  });
});

describe("Training Calendar", () => {
  it("returns Trainings in the date range with Mode, soonest first, and derived status", async () => {
    clock = new Date("2026-11-01T00:00:00Z");
    await trainings().create(terms({ title: "Online POS", date: "2026-11-20", mode: "Online", location: "https://meet.example.com/pos" }));
    await trainings().create(terms({ title: "Kitchen safety", date: "2026-11-20", startTime: "08:00", endTime: "09:00" }));
    await trainings().create(terms({ title: "Allergens", date: "2026-11-05" }));
    await trainings().create(terms({ title: "Next month", date: "2026-12-01" }));
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now() WHERE title = 'Allergens'`);
    clock = new Date("2026-11-14T02:00:00Z");

    const found = await trainings().calendar({ from: "2026-11-01", to: "2026-12-01" });
    expect(found.map((t) => [t.title, t.date, t.mode, t.status])).toEqual([
      ["Allergens", "2026-11-05", "In person", "Cancelled"],
      ["Kitchen safety", "2026-11-20", "In person", "Upcoming"],
      ["Online POS", "2026-11-20", "Online", "Upcoming"],
    ]);
    expect(found[2]).toMatchObject({ location: "https://meet.example.com/pos", startTime: "09:00", endTime: "11:00", assigned: 0 });
  });

  it("includes the first day and leaves out the end day of the range", async () => {
    await trainings().create(terms({ date: "2026-11-16" }));
    expect(await trainings().calendar({ from: "2026-11-16", to: "2026-11-17" })).toHaveLength(1);
    expect(await trainings().calendar({ from: "2026-11-10", to: "2026-11-16" })).toHaveLength(0);
  });

  it("refuses a bad range, and without the Training Module", async () => {
    await expect(trainings().calendar({ from: "2026-11-16", to: "2026-11-16" })).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().calendar({ from: "nope", to: "2026-11-16" })).rejects.toMatchObject({ reason: "validation" });
    const other = portal.signIn(staff, ["Offers"]);
    await expect(trainings(other).calendar({ from: "2026-11-01", to: "2026-12-01" })).rejects.toMatchObject({ reason: "denied" });
  });
});

describe("Training Calendar view state", () => {
  const now = new Date("2026-11-14T02:00:00Z");
  it("defaults to this month, covers whole Monday-first weeks, and steps by month or week", () => {
    const state = trainingCalendarState({}, now);
    expect(state).toEqual({ mode: "month", date: "2026-11-14" });
    expect(trainingCalendarRange(state)).toEqual({ from: "2026-10-26", to: "2026-12-07" });
    expect(shiftTrainingCalendar(state, 1)).toBe("2026-12-01");
    const week = trainingCalendarState({ mode: "week", date: "2026-11-14" }, now);
    expect(trainingCalendarRange(week)).toEqual({ from: "2026-11-09", to: "2026-11-16" });
    expect(shiftTrainingCalendar(week, -1)).toBe("2026-11-07");
    expect(trainingCalendarTitle(week)).toBe("9 – 15 November 2026");
    expect(trainingCalendarState({ mode: "year", date: "2026-13-40" }, now)).toEqual(state);
  });
  it("keeps links short", () => {
    expect(trainingCalendarHref({ mode: "month", date: "2026-11-14" }, now)).toBe("/training/calendar");
    expect(trainingCalendarHref({ mode: "week", date: "2026-11-20" }, now)).toBe("/training/calendar?mode=week&date=2026-11-20");
  });
});

const pdf = { filename: "Handbook.pdf", contentType: "application/pdf", size: 2_400_000 };
const upload = async (id: number | undefined, file = pdf) => {
  const { fileId } = await trainings().requestMaterial(file, id);
  return trainings().confirmMaterial(fileId);
};

describe("Training detail and materials", () => {
  it("reads a Training with its schedule, objectives as a list and Active materials", async () => {
    const id = await trainings().create(terms({ description: "How to count cash.", objectives: "Ring up sales\nCount cash" }));
    await upload(id);
    const detail = await trainings().read(id);
    expect(detail).toMatchObject({ id, title: "Food safety and hygiene refresher", status: "Upcoming", mode: "In person", objectiveList: ["Ring up sales", "Count cash"] });
    expect(detail.materials).toEqual([{ fileId: "file-1", filename: "Handbook.pdf", contentType: "application/pdf", size: 2_400_000 }]);
    await expect(trainings().read(999)).rejects.toMatchObject({ reason: "not-found" });
    await expect(trainings().read(-1)).rejects.toMatchObject({ reason: "not-found" });
  });

  it("asks file-storage for a Private, Permanent File and shows the material only once confirmed", async () => {
    const id = await trainings().create(terms());
    const { fileId, uploadUrl } = await trainings().requestMaterial(pdf, id);
    expect(uploadUrl).toBe("https://files.test/put");
    expect(files.requestUpload).toHaveBeenCalledWith(pdf);
    expect((await trainings().read(id)).materials).toEqual([]);
    expect((await trainings().list()).rows[0].hasMaterials).toBe(false);
    await trainings().confirmMaterial(fileId);
    await trainings().confirmMaterial(fileId);
    expect(files.confirm).toHaveBeenCalledTimes(1);
    expect((await trainings().read(id)).materials).toHaveLength(1);
    expect((await trainings().list()).rows[0].hasMaterials).toBe(true);
  });

  it("attaches files uploaded on the New training form when the Training is saved, and only this Staff member's", async () => {
    const mine = (await upload(undefined)).fileId;
    const unconfirmed = (await trainings().requestMaterial({ ...pdf, filename: "Draft.pdf" })).fileId;
    const other = portal.signIn({ ...staff, username: "bea", name: "Bea" }, ["Training"]);
    const { fileId: theirs } = await trainingsFor(other, db, () => clock, files).requestMaterial(pdf);
    await trainingsFor(other, db, () => clock, files).confirmMaterial(theirs);
    const id = await trainings().create(terms(), [mine, unconfirmed, theirs, "unknown"]);
    expect((await trainings().read(id)).materials.map((m) => m.fileId)).toEqual([mine]);
  });

  it("deletes a material from file-storage and the Training, and keeps it when file-storage fails", async () => {
    const id = await trainings().create(terms());
    const { fileId } = await upload(id);
    files.remove.mockRejectedValueOnce(new Error("offline"));
    await expect(trainings().deleteMaterial(fileId)).rejects.toMatchObject({ reason: "unavailable" });
    expect((await trainings().read(id)).materials).toHaveLength(1);
    await trainings().deleteMaterial(fileId);
    expect(files.remove).toHaveBeenLastCalledWith(fileId);
    expect((await trainings().read(id)).materials).toEqual([]);
    await expect(trainings().deleteMaterial("never-recorded")).rejects.toMatchObject({ reason: "not-found" });
    expect(files.remove).toHaveBeenCalledTimes(2);
  });

  it("refuses files that are not PDF, Word, Excel or images, or are over 10 MB, before asking file-storage", async () => {
    await expect(trainings().requestMaterial({ ...pdf, contentType: "application/zip" })).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().requestMaterial({ ...pdf, size: MATERIAL_MAX_BYTES + 1 })).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().requestMaterial(pdf, 999)).rejects.toMatchObject({ reason: "not-found" });
    expect(files.requestUpload).not.toHaveBeenCalled();
    expect(materialProblem({ ...pdf, size: MATERIAL_MAX_BYTES })).toBeNull();
    expect(materialProblem({ ...pdf, filename: "<x>.pdf" })).not.toBeNull();
    expect(formatSize(2_400_000)).toBe("2.3 MB");
    expect(formatSize(92_160)).toBe("90 KB");
  });

  it("serves a signed address only for Active materials of a Training, and only to Staff with the Module", async () => {
    const id = await trainings().create(terms());
    const { fileId } = await upload(id);
    const pending = (await trainings().requestMaterial(pdf, id)).fileId;
    expect(await trainings().materialUrl(fileId)).toBe("https://files.test/signed");
    await expect(trainings().materialUrl(pending)).rejects.toMatchObject({ reason: "not-found" });
    const denied = portal.signIn(staff, ["Offers"]);
    await expect(trainings(denied).materialUrl(fileId)).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(denied).deleteMaterial(fileId)).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(denied).requestMaterial(pdf)).rejects.toMatchObject({ reason: "denied" });
  });
});

describe("Assigning Employees", () => {
  it("assigns Employees individually and shows them on the Training with their status, and counts them on the list", async () => {
    const id = await trainings().create(terms());
    const [ana, bea] = [await employee("Ana Dizon"), await employee("Bea Cruz", { email: "" })];
    expect(await trainings().assign(id, { employeeIds: [ana, bea] })).toEqual({ added: 2, alreadyAssigned: 0, needPrintedSchedule: 1 });
    const detail = await trainings().read(id);
    expect(detail.assigned).toMatchObject([
      { employeeId: ana, name: "Ana Dizon", email: "ana@example.test", needsPrintedSchedule: false, status: "Assigned", completedOn: null },
      { employeeId: bea, name: "Bea Cruz", email: null, needsPrintedSchedule: true, status: "Assigned" },
    ]);
    expect((await trainings().list()).rows[0]).toMatchObject({ assigned: 2, completed: 0 });
    const stored = (await db.query<{ assigned_by: string }>(`SELECT assigned_by FROM public.hrms_training_assignments LIMIT 1`)).rows[0];
    expect(stored.assigned_by).toBe("ada");
  });

  it("treats a blank or whitespace-only email as no email", async () => {
    const id = await trainings().create(terms());
    const cy = await employee("Cy Reyes", { email: "   " });
    await trainings().assign(id, { employeeIds: [cy] });
    expect((await trainings().read(id)).assigned[0]).toMatchObject({ email: null, needsPrintedSchedule: true });
    expect((await trainings().assignable(id))[0]).toMatchObject({ email: null, alreadyAssigned: true });
  });

  it("assigns a whole department at once, leaving out other departments and anyone already assigned", async () => {
    const id = await trainings().create(terms());
    const ana = await employee("Ana Dizon", { department: "Production" });
    await employee("Bea Cruz", { department: "Production", email: "" });
    await employee("Cy Reyes", { department: "Retail" });
    await trainings().assign(id, { employeeIds: [ana] });
    expect(await trainings().assign(id, { department: "Production" })).toEqual({ added: 1, alreadyAssigned: 1, needPrintedSchedule: 1 });
    expect((await trainings().read(id)).assigned.map((person) => person.name)).toEqual(["Ana Dizon", "Bea Cruz"]);
    await expect(trainings().assign(id, { department: "Nowhere" })).rejects.toMatchObject({ reason: "validation" });
  });

  it("offers Employee records only, flags who is already assigned, and refuses ids that are not Employees", async () => {
    const id = await trainings().create(terms());
    const ana = await employee("Ana Dizon");
    await employee("Bea Cruz");
    await trainings().assign(id, { employeeIds: [ana] });
    expect((await trainings().assignable(id)).map((person) => [person.name, person.alreadyAssigned])).toEqual([["Ana Dizon", true], ["Bea Cruz", false]]);
    // Ada is Staff, not an Employee record: nothing in the list carries her, and no id can reach her.
    expect((await trainings().assignable(id)).map((person) => person.name)).not.toContain("Ada Okafor");
    await expect(trainings().assign(id, { employeeIds: [9999] })).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().assign(id, { employeeIds: [] })).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().assign(id, { employeeIds: [ana, 9999] })).rejects.toMatchObject({ reason: "validation" });
    expect((await trainings().read(id)).assigned).toHaveLength(1);
  });

  it("removes an Employee from a Training and refuses to remove someone who isn't on it", async () => {
    const id = await trainings().create(terms());
    const [ana, bea] = [await employee("Ana Dizon"), await employee("Bea Cruz")];
    await trainings().assign(id, { employeeIds: [ana, bea] });
    await trainings().unassign(id, ana);
    expect((await trainings().read(id)).assigned.map((person) => person.employeeId)).toEqual([bea]);
    await expect(trainings().unassign(id, ana)).rejects.toMatchObject({ reason: "not-found" });
    await expect(trainings().unassign(999, bea)).rejects.toMatchObject({ reason: "not-found" });
  });

  it("refuses to assign to a Cancelled Training or an unknown one, and to anyone without the Training Module", async () => {
    const id = await trainings().create(terms());
    const ana = await employee("Ana Dizon");
    await expect(trainings().assign(999, { employeeIds: [ana] })).rejects.toMatchObject({ reason: "not-found" });
    const denied = portal.signIn(staff, ["Offers"]);
    await expect(trainings(denied).assign(id, { employeeIds: [ana] })).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(denied).assignable(id)).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(denied).unassign(id, ana)).rejects.toMatchObject({ reason: "denied" });
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now() WHERE id = $1`, [id]);
    await expect(trainings().assign(id, { employeeIds: [ana] })).rejects.toMatchObject({ reason: "conflict" });
  });
});

describe("Cancelling a Training", () => {
  const notices = async () => (await db.query<{ kind: string; state: string; email: string; payload: { body: string; title: string } }>(
    `SELECT kind, state, email, payload FROM public.hrms_training_notices ORDER BY id`)).rows;
  const statuses = async (id: number) => (await trainings().read(id)).assigned.map((person) => [person.name, person.status]);

  it("cancels with a reason, shows the Cancelled status and reason, and sets every Assigned employee to Cancelled", async () => {
    const id = await trainings().create(terms());
    await trainings().assign(id, { employeeIds: [await employee("Ana Dizon"), await employee("Rhea Bautista", { email: "" })] });
    const result = await trainings().cancel(id, { reason: "  Our trainer is   unavailable that day.  ", notify: false });
    expect(result).toEqual({ cancelled: 2, notified: 0, needPrintedSchedule: 1 });
    const detail = await trainings().read(id);
    expect(detail).toMatchObject({ status: "Cancelled", cancelReason: "Our trainer is unavailable that day." });
    expect(await statuses(id)).toEqual([["Ana Dizon", "Cancelled"], ["Rhea Bautista", "Cancelled"]]);
    expect((await trainings().list("Cancelled")).rows.map((row) => row.id)).toEqual([id]);
    expect((await trainings().list()).counts).toMatchObject({ Upcoming: 0, Cancelled: 1 });
  });

  it("requires a reason and rejects markup instead of stripping it", async () => {
    const id = await trainings().create(terms());
    for (const reason of ["", "   ", "<b>no</b>", "x".repeat(501)]) {
      await expect(trainings().cancel(id, { reason, notify: true })).rejects.toMatchObject({ reason: "validation" });
    }
    await expect(trainings().cancel(id, { reason: "ok", notify: "yes" as unknown as boolean })).rejects.toMatchObject({ reason: "validation" });
    expect((await trainings().read(id)).status).toBe("Upcoming");
  });

  it("queues a Cancelled notice with the reason for each Employee with an email when notify is on, and none for no-email Employees", async () => {
    const id = await trainings().create(terms());
    await trainings().assign(id, { employeeIds: [await employee("Ana Dizon"), await employee("Rhea Bautista", { email: "  " })] });
    const result = await trainings().cancel(id, { reason: "Trainer unavailable.", notify: true });
    expect(result).toEqual({ cancelled: 2, notified: 1, needPrintedSchedule: 1 });
    // The undelivered Assignment notice stopped; only the Cancelled one is waiting.
    expect(await notices()).toEqual([expect.objectContaining({ kind: "Cancelled", state: "Queued", email: "ana@example.test" })]);
    const [notice] = await notices();
    expect(notice.payload.title).toBe("Cancelled: Food safety and hygiene refresher on Wed, 18 Nov");
    expect(notice.payload.body).toContain("Hi Ana,");
    expect(notice.payload.body).toContain("Reason: Trainer unavailable.");
    expect(notice.payload.body).not.toMatch(/sign in|log in/i);
  });

  it("sends no notice when notify is off, and keeps delivered notices in the log", async () => {
    const id = await trainings().create(terms());
    await trainings().assign(id, { employeeIds: [await employee("Ana Dizon")] });
    await db.query(`UPDATE public.hrms_training_notices SET state = 'Sent'`);
    await trainings().cancel(id, { reason: "Trainer unavailable.", notify: false });
    expect(await notices()).toEqual([expect.objectContaining({ kind: "Assignment", state: "Sent" })]);
  });

  it("leaves Employees with a recorded result alone and refuses once a result exists", async () => {
    const id = await trainings().create(terms());
    const ana = await employee("Ana Dizon");
    await trainings().assign(id, { employeeIds: [ana, await employee("Liza Manalo")] });
    await db.query(`UPDATE public.hrms_training_assignments SET status = 'Completed', completed_on = '2026-11-18' WHERE employee_id = $1`, [ana]);
    await expect(trainings().cancel(id, { reason: "Too late", notify: true })).rejects.toMatchObject({ reason: "conflict" });
    expect((await trainings().read(id)).status).toBe("Upcoming");
  });

  it("cancels once: a second cancel, an unknown id and a user without the Module are refused", async () => {
    const id = await trainings().create(terms());
    await trainings().assign(id, { employeeIds: [await employee("Ana Dizon")] });
    await trainings().cancel(id, { reason: "First", notify: true });
    await expect(trainings().cancel(id, { reason: "Again", notify: true })).rejects.toMatchObject({ reason: "conflict" });
    expect(await notices()).toHaveLength(1);
    expect((await trainings().read(id)).cancelReason).toBe("First");
    await expect(trainings().cancel(999, { reason: "x", notify: true })).rejects.toMatchObject({ reason: "not-found" });
    await expect(trainings(portal.signIn(staff, ["Offers"])).cancel(id, { reason: "x", notify: true })).rejects.toMatchObject({ reason: "denied" });
  });

  it("leaves Cancelled Employees out of Training completion's results due: they are not Assigned or counted as Completed", async () => {
    const id = await trainings().create(terms({ date: "2026-11-14" }));
    await trainings().assign(id, { employeeIds: [await employee("Ana Dizon")] });
    await trainings().cancel(id, { reason: "Typhoon", notify: false });
    expect(await statuses(id)).toEqual([["Ana Dizon", "Cancelled"]]);
    expect((await trainings().list()).rows[0]).toMatchObject({ status: "Cancelled", completed: 0 });
  });
});

/** A Training whose date has passed (create() refuses past dates, so the row is moved back), with these Employees assigned. */
async function heldTraining(date: string, people: string[], overrides: Partial<TrainingTerms> = {}) {
  const id = await trainings().create(terms(overrides));
  await db.query(`UPDATE public.hrms_trainings SET training_date = $2 WHERE id = $1`, [id, date]);
  const ids: number[] = [];
  for (const name of people) ids.push(await employee(name));
  if (ids.length > 0) await trainings().assign(id, { employeeIds: ids });
  return { id, ids };
}
const result = async (id: number) => (await trainings().read(id)).assigned.map((person) => [person.name, person.status, person.completedOn]);

describe("Marking results", () => {
  it("sets Completed with a completion date, Did not attend, and back to Assigned, one or many at a time", async () => {
    const { id, ids } = await heldTraining("2026-11-10", ["Ana Dizon", "Liza Manalo", "Rhea Bautista"]);
    expect(await trainings().markResults(id, { marks: [
      { employeeId: ids[0], status: "Completed", completedOn: "2026-11-10" },
      { employeeId: ids[1], status: "Did not attend" },
    ] })).toEqual({ marked: 2 });
    expect(await result(id)).toEqual([["Ana Dizon", "Completed", "2026-11-10"], ["Liza Manalo", "Did not attend", null], ["Rhea Bautista", "Assigned", null]]);
    expect((await trainings().read(id)).recordedResults).toBe(2);
    // Corrected from the sheet: Ana back to Assigned, Liza Completed later in the week.
    await trainings().markResults(id, { marks: [{ employeeId: ids[0], status: "Assigned" }, { employeeId: ids[1], status: "Completed", completedOn: "2026-11-12" }] });
    expect(await result(id)).toEqual([["Ana Dizon", "Assigned", null], ["Liza Manalo", "Completed", "2026-11-12"], ["Rhea Bautista", "Assigned", null]]);
  });

  it("allows marking on the day of the Training but not before it", async () => {
    const today = await heldTraining("2026-11-14", ["Ana Dizon"]);
    await expect(trainings().markResults(today.id, { marks: [{ employeeId: today.ids[0], status: "Completed", completedOn: "2026-11-14" }] })).resolves.toEqual({ marked: 1 });
    const later = await heldTraining("2026-11-15", ["Liza Manalo"]);
    await expect(trainings().markResults(later.id, { marks: [{ employeeId: later.ids[0], status: "Did not attend" }] })).rejects.toMatchObject({ reason: "early" });
    expect(await result(later.id)).toEqual([["Liza Manalo", "Assigned", null]]);
  });

  it("needs a real completion date between the Training's date and today for everyone marked Completed, and applies nothing otherwise", async () => {
    const { id, ids } = await heldTraining("2026-11-10", ["Ana Dizon", "Liza Manalo"]);
    const bad = (completedOn: string | undefined) => trainings().markResults(id, { marks: [{ employeeId: ids[0], status: "Did not attend" }, { employeeId: ids[1], status: "Completed", completedOn }] });
    for (const date of [undefined, "", "2026-13-40", "2026-11-09", "2026-11-15", "10 Nov 2026"]) await expect(bad(date)).rejects.toMatchObject({ reason: "validation" });
    expect(await result(id)).toEqual([["Ana Dizon", "Assigned", null], ["Liza Manalo", "Assigned", null]]);
  });

  it("refuses an empty request, a duplicate, an unknown status, and Employees who are not assigned", async () => {
    const { id, ids } = await heldTraining("2026-11-10", ["Ana Dizon"]);
    const stranger = await employee("Not Assigned");
    for (const marks of [[], [{ employeeId: ids[0], status: "Completed", completedOn: "2026-11-10" }, { employeeId: ids[0], status: "Did not attend" }],
      [{ employeeId: ids[0], status: "Cancelled" }], [{ employeeId: stranger, status: "Did not attend" }], [{ employeeId: ids[0], status: "Did not attend" }, { employeeId: stranger, status: "Did not attend" }]]) {
      await expect(trainings().markResults(id, { marks: marks as never })).rejects.toMatchObject({ reason: "validation" });
    }
    expect(await result(id)).toEqual([["Ana Dizon", "Assigned", null]]);
  });

  it("never touches a Cancelled employee and refuses a Cancelled Training", async () => {
    const { id, ids } = await heldTraining("2026-11-10", ["Ana Dizon", "Liza Manalo"]);
    await db.query(`UPDATE public.hrms_training_assignments SET status = 'Cancelled' WHERE employee_id = $1`, [ids[1]]);
    await expect(trainings().markResults(id, { marks: [{ employeeId: ids[1], status: "Did not attend" }] })).rejects.toMatchObject({ reason: "validation" });
    expect(await result(id)).toEqual([["Ana Dizon", "Assigned", null], ["Liza Manalo", "Cancelled", null]]);
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now() WHERE id = $1`, [id]);
    await expect(trainings().markResults(id, { marks: [{ employeeId: ids[0], status: "Did not attend" }] })).rejects.toMatchObject({ reason: "conflict" });
  });

  it("refuses an unknown Training and anyone without the Training Module", async () => {
    const { id, ids } = await heldTraining("2026-11-10", ["Ana Dizon"]);
    await expect(trainings().markResults(999, { marks: [{ employeeId: ids[0], status: "Did not attend" }] })).rejects.toMatchObject({ reason: "not-found" });
    await expect(trainings(portal.signIn(staff, ["Offers"])).markResults(id, { marks: [{ employeeId: ids[0], status: "Did not attend" }] })).rejects.toMatchObject({ reason: "denied" });
  });
});

describe("The date lock", () => {
  const edit = (id: number, detail: Awaited<ReturnType<ReturnType<typeof trainings>["read"]>>, change: Partial<TrainingTerms>) =>
    trainings().update(id, { title: detail.title, trainer: detail.trainer, description: detail.description, objectives: detail.objectives, date: detail.date, startTime: detail.startTime, endTime: detail.endTime, mode: detail.mode, location: detail.location, ...change }, { notify: false });

  it("locks date, time, Mode and venue once any Employee has a recorded result, but still lets the text change", async () => {
    const { id, ids } = await heldTraining("2026-11-14", ["Ana Dizon", "Liza Manalo"]);
    const before = await trainings().read(id);
    await trainings().markResults(id, { marks: [{ employeeId: ids[0], status: "Did not attend" }] });
    for (const change of [{ date: "2026-11-20" }, { startTime: "10:00" }, { endTime: "12:00" }, { location: "Another venue" }, { mode: "Online", location: "https://meet.example.test/x" }] as Partial<TrainingTerms>[]) {
      await expect(edit(id, before, change)).rejects.toMatchObject({ reason: "locked" });
    }
    await expect(edit(id, before, { title: "Renamed", description: "New text" })).resolves.toMatchObject({ changed: true, rescheduled: false });
    expect(await trainings().read(id)).toMatchObject({ title: "Renamed", date: "2026-11-14", recordedResults: 1 });
  });

  it("is not locked by Assigned or Cancelled employees, and unlocks when every result is put back to Assigned", async () => {
    const { id, ids } = await heldTraining("2026-11-14", ["Ana Dizon"]);
    const detail = await trainings().read(id);
    expect(detail.recordedResults).toBe(0);
    await expect(edit(id, detail, { date: "2026-11-20" })).resolves.toMatchObject({ rescheduled: true });
    await db.query(`UPDATE public.hrms_trainings SET training_date = '2026-11-14', rescheduled_from = NULL WHERE id = $1`, [id]);
    await trainings().markResults(id, { marks: [{ employeeId: ids[0], status: "Completed", completedOn: "2026-11-14" }] });
    await expect(edit(id, detail, { date: "2026-11-21" })).rejects.toMatchObject({ reason: "locked" });
    await trainings().markResults(id, { marks: [{ employeeId: ids[0], status: "Assigned" }] });
    await expect(edit(id, detail, { date: "2026-11-21" })).resolves.toMatchObject({ rescheduled: true });
  });
});

describe("Training completion", () => {
  const mark = (id: number, ids: number[], statuses: ("Completed" | "Did not attend" | "Assigned")[]) =>
    trainings().markResults(id, { marks: ids.map((employeeId, index) => ({ employeeId, status: statuses[index], completedOn: statuses[index] === "Completed" ? "2026-11-10" : null })) });

  it("is the Completed share of results due for Trainings held this month, as a whole percent with 'X of Y completed'", async () => {
    const a = await heldTraining("2026-11-10", ["Ana Dizon", "Liza Manalo", "Rhea Bautista"]);
    await mark(a.id, a.ids, ["Completed", "Completed", "Did not attend"]);
    const page = await trainings().list();
    expect(page.month).toBe("November 2026");
    expect(page.completion).toEqual({ percent: 67, completed: 2, due: 3 });
  });

  it("rounds to a whole percent and adds up across Trainings", async () => {
    const a = await heldTraining("2026-11-03", ["Ana Dizon", "Liza Manalo", "Rhea Bautista"]);
    await mark(a.id, a.ids, ["Completed", "Assigned", "Did not attend"]);
    expect((await trainings().list()).completion).toEqual({ percent: 33, completed: 1, due: 3 });
    const b = await heldTraining("2026-11-04", ["Carla Mendoza"]);
    await mark(b.id, b.ids, ["Completed"]);
    expect((await trainings().list()).completion).toEqual({ percent: 50, completed: 2, due: 4 });
  });

  it("leaves out Cancelled employees, Cancelled Trainings, Trainings not yet held and Trainings of other months", async () => {
    const held = await heldTraining("2026-11-10", ["Ana Dizon", "Liza Manalo"]);
    await mark(held.id, [held.ids[0]], ["Completed"]);
    await db.query(`UPDATE public.hrms_training_assignments SET status = 'Cancelled' WHERE employee_id = $1`, [held.ids[1]]);
    await heldTraining("2026-11-14", ["Today Person"]);
    await heldTraining("2026-11-25", ["Future Person"]);
    await heldTraining("2026-10-28", ["Last Month Person"]);
    const cancelled = await heldTraining("2026-11-08", ["Gone Person"]);
    await trainings().cancel(cancelled.id, { reason: "Typhoon", notify: false });
    expect((await trainings().list()).completion).toEqual({ percent: 100, completed: 1, due: 1 });
  });

  it("is empty, never 0%, when no Training was held this month or none has anyone to count", async () => {
    expect((await trainings().list()).completion).toBeNull();
    await heldTraining("2026-11-10", []);
    await heldTraining("2026-10-10", ["Ana Dizon"]);
    await trainings().create(terms());
    expect((await trainings().list()).completion).toBeNull();
    const held = await heldTraining("2026-11-09", ["Liza Manalo"]);
    expect((await trainings().list()).completion).toEqual({ percent: 0, completed: 0, due: 1 });
    await db.query(`UPDATE public.hrms_training_assignments SET status = 'Cancelled' WHERE training_id = $1`, [held.id]);
    expect((await trainings().list()).completion).toBeNull();
  });

  it("follows the Manila month, not UTC, and does not depend on the tab chosen", async () => {
    // 30 Nov 2026 17:00 UTC is 1 Dec 01:00 in Manila.
    clock = new Date("2026-11-30T17:00:00Z");
    const november = await heldTraining("2026-11-20", ["Ana Dizon"], { date: "2026-12-20" });
    expect((await trainings().list()).completion).toBeNull();
    clock = new Date("2026-11-30T15:00:00Z");
    await trainings().markResults(november.id, { marks: [{ employeeId: november.ids[0], status: "Completed", completedOn: "2026-11-25" }] });
    for (const tab of ["All", "Upcoming", "Past", "Cancelled"] as const) expect((await trainings().list(tab)).completion).toEqual({ percent: 100, completed: 1, due: 1 });
    expect((await trainings().list()).month).toBe("November 2026");
  });

  it("lists held Trainings of the month that still need results, oldest first, until a result is recorded", async () => {
    const late = await heldTraining("2026-11-10", ["Ana Dizon"], { title: "Later one" });
    const early = await heldTraining("2026-11-03", ["Liza Manalo"], { title: "Earlier one" });
    await heldTraining("2026-10-03", ["Last Month"], { title: "Other month" });
    await heldTraining("2026-11-04", [], { title: "Nobody assigned" });
    expect((await trainings().list()).needResults).toEqual([{ id: early.id, title: "Earlier one" }, { id: late.id, title: "Later one" }]);
    await mark(early.id, early.ids, ["Did not attend"]);
    expect((await trainings().list()).needResults).toEqual([{ id: late.id, title: "Later one" }]);
  });
});
