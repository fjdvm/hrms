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
