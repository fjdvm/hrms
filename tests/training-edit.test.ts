import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverTrainingNotices, type SendEmail } from "@/lib/training-notices";
import { scheduleChangedEmail } from "@/lib/training-email";
import { trainingsFor } from "@/lib/trainings";
import { readTrainingForm, scheduleDiffers, type TrainingTerms } from "@/lib/training-terms";
import type { MaterialFiles } from "@/lib/training-material-files";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
let clock: Date;
const staff = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const files: MaterialFiles = { requestUpload: vi.fn(), confirm: vi.fn(), remove: vi.fn(), viewUrl: vi.fn() };
const trainings = (sessionHandle: string | undefined = handle) => trainingsFor(sessionHandle, db, () => clock, files);
const sent: { id: string; payload: { to: string; title: string; body: string } }[] = [];
const mailer: SendEmail = async (email) => { sent.push(email as never); };
const base: TrainingTerms = { title: "POS and cash handling", trainer: "HR", description: "Count cash.", objectives: "", date: "2026-11-20", startTime: "14:00", endTime: "16:00", mode: "Online", location: "https://meet.example.test/pos" };

let count = 0;
async function employee(name: string, email = `${name.split(" ")[0].toLowerCase()}@example.test`) {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, email])).rows[0].id;
}
/** A Training with Ana and Cy (with email) and Bea (no email) assigned. */
async function seeded() {
  const id = await trainings().create(base);
  await trainings().assign(id, { employeeIds: [await employee("Ana Dizon"), await employee("Bea Cruz", ""), await employee("Cy Reyes")] });
  await deliverTrainingNotices(db, () => clock, mailer);
  sent.length = 0;
  // The edit comes later than the assignment, as it would in real life.
  clock = new Date(clock.getTime() + 3_600_000);
  return id;
}
const notices = async () => (await db.query<{ kind: string; state: string; employee: string }>(`
  SELECT n.kind, n.state, e.full_name AS employee FROM public.hrms_training_notices n JOIN public.hrms_employees e ON e.id = n.employee_id ORDER BY n.id`)).rows;

beforeEach(async () => {
  count = 0; sent.length = 0;
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

describe("editing a Training", () => {
  it("edits title, description, objectives and trainer without a reschedule: no notice, no event, no caption", async () => {
    const id = await seeded();
    const result = await trainings().update(id, { ...base, title: "POS basics", description: "New text", objectives: "Count cash\nVoid sales", trainer: "QA" }, { notify: true });
    expect(result).toEqual({ changed: true, rescheduled: false, notified: 0, needPrintedSchedule: 0 });
    const detail = await trainings().read(id);
    expect(detail).toMatchObject({ title: "POS basics", description: "New text", trainer: "QA", objectiveList: ["Count cash", "Void sales"], rescheduledFrom: null });
    expect(await notices()).toHaveLength(2);
    expect((await trainings().log(id)).scheduleChanges).toEqual([]);
    expect(detail.assigned.every((person) => !person.reprintNeeded)).toBe(true);
  });

  it("does nothing when nothing changed", async () => {
    const id = await seeded();
    expect(await trainings().update(id, base, { notify: true })).toMatchObject({ changed: false, rescheduled: false });
  });

  it("a reschedule stays Upcoming, keeps the previous date, and records a Schedule changed entry", async () => {
    const id = await seeded();
    const result = await trainings().update(id, { ...base, date: "2026-11-27", startTime: "09:00", endTime: "11:00" }, { notify: true });
    expect(result).toMatchObject({ changed: true, rescheduled: true, notified: 2, needPrintedSchedule: 1 });
    const detail = await trainings().read(id);
    expect(detail).toMatchObject({ status: "Upcoming", date: "2026-11-27", rescheduledFrom: "2026-11-20" });
    expect((await trainings().list()).rows[0]).toMatchObject({ status: "Upcoming", rescheduledFrom: "2026-11-20" });
    const [change] = (await trainings().log(id)).scheduleChanges;
    expect(change).toMatchObject({ notified: true, notifiedCount: 2, needsPrinted: 1, from: { date: "2026-11-20", startTime: "14:00" }, to: { date: "2026-11-27", startTime: "09:00" } });
    expect(await trainings().logPreview(id)).toMatchObject([{ kind: "Schedule changed", needPrinted: 1, notified: true }, { kind: "Assignment" }]);
  });

  it("queues a Schedule changed email per assigned Employee with an email when Notify is on, saying before and now", async () => {
    const id = await seeded();
    await trainings().update(id, { ...base, date: "2026-11-27" }, { notify: true });
    expect((await notices()).filter((notice) => notice.kind === "Schedule changed").map((notice) => notice.employee)).toEqual(["Ana Dizon", "Cy Reyes"]);
    await deliverTrainingNotices(db, () => clock, mailer);
    expect(sent.map((email) => email.payload.to).sort()).toEqual(["ana@example.test", "cy@example.test"]);
    const body = sent[0].payload.body;
    expect(sent[0].payload.title).toBe("Schedule changed: POS and cash handling");
    expect(body).toContain("Before: Fri, 20 Nov 2026 · 2:00 – 4:00 PM · Online");
    expect(body).toContain("Now: Fri, 27 Nov 2026 · 2:00 – 4:00 PM · Online");
    expect(body).toContain("Meeting link: https://meet.example.test/pos");
  });

  it("sends nothing when Notify is off, but still records the change and flags the no-email Employee for a reprint", async () => {
    const id = await seeded();
    const result = await trainings().update(id, { ...base, date: "2026-11-27" }, { notify: false });
    expect(result).toMatchObject({ rescheduled: true, notified: 0, needPrintedSchedule: 1 });
    expect((await notices()).filter((notice) => notice.kind === "Schedule changed")).toEqual([]);
    const log = await trainings().log(id);
    expect(log.scheduleChanges[0]).toMatchObject({ notified: false, notifiedCount: 0 });
    expect(await trainings().logPreview(id)).toMatchObject([{ kind: "Schedule changed", notified: false }, { kind: "Assignment" }]);
    const detail = await trainings().read(id);
    expect(detail.assigned.map((person) => [person.name, person.reprintNeeded])).toEqual([["Ana Dizon", false], ["Bea Cruz", true], ["Cy Reyes", false]]);
  });

  it("a time or venue change alone is a reschedule but adds no 'Rescheduled from' caption, and a later date change keeps one", async () => {
    const id = await seeded();
    await trainings().update(id, { ...base, location: "https://meet.example.test/new" }, { notify: true });
    expect(await trainings().read(id)).toMatchObject({ rescheduledFrom: null, location: "https://meet.example.test/new" });
    expect((await trainings().log(id)).scheduleChanges).toHaveLength(1);
    await trainings().update(id, { ...base, location: "https://meet.example.test/new", date: "2026-11-25" }, { notify: false });
    expect((await trainings().read(id)).rescheduledFrom).toBe("2026-11-20");
    await trainings().update(id, { ...base, location: "https://meet.example.test/new", date: "2026-11-25", startTime: "10:00" }, { notify: false });
    expect((await trainings().read(id)).rescheduledFrom).toBe("2026-11-20");
  });

  it("changing Mode to In person takes a venue instead of a link", async () => {
    const id = await seeded();
    await trainings().update(id, { ...base, mode: "In person", location: "Main kitchen" }, { notify: true });
    await deliverTrainingNotices(db, () => clock, mailer);
    expect(sent[0].payload.body).toContain("Venue: Main kitchen");
    await expect(trainings().update(id, { ...base, mode: "In person", location: "Main kitchen" }, { notify: true }).then((r) => r.changed)).resolves.toBe(false);
    await expect(trainings().update(id, { ...base, mode: "Online", location: "not a link" }, { notify: true })).rejects.toMatchObject({ reason: "validation" });
  });

  it("refuses a past date, but lets a Training that already happened keep its date while its text is fixed", async () => {
    const id = await seeded();
    await expect(trainings().update(id, { ...base, date: "2026-11-01" }, { notify: true })).rejects.toMatchObject({ reason: "validation" });
    clock = new Date("2026-11-30T02:00:00Z");
    expect(await trainings().update(id, { ...base, title: "POS and cash handling (fixed)" }, { notify: true })).toMatchObject({ changed: true, rescheduled: false });
    expect((await trainings().read(id)).status).toBe("Completed");
    // Moving it to a future date makes it Upcoming again.
    await trainings().update(id, { ...base, title: "POS and cash handling (fixed)", date: "2026-12-04" }, { notify: false });
    expect((await trainings().read(id)).status).toBe("Upcoming");
  });

  it("refuses a Cancelled or unknown Training, bad input, and Staff without the Training Module", async () => {
    const id = await seeded();
    await expect(trainings().update(999, base, { notify: true })).rejects.toMatchObject({ reason: "not-found" });
    await expect(trainings().update(id, { ...base, title: "  " }, { notify: true })).rejects.toMatchObject({ reason: "validation" });
    const denied = portal.signIn(staff, ["Offers"]);
    await expect(trainings(denied).update(id, base, { notify: true })).rejects.toMatchObject({ reason: "denied" });
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now() WHERE id = $1`, [id]);
    await expect(trainings().update(id, { ...base, title: "x" }, { notify: true })).rejects.toMatchObject({ reason: "conflict" });
  });

  it("leaves unrelated Employees and their other notices alone", async () => {
    const id = await seeded();
    const other = await trainings().create({ ...base, title: "Other" });
    await trainings().assign(other, { employeeIds: [await employee("Dee Santos")] });
    await trainings().update(id, { ...base, date: "2026-11-27" }, { notify: true });
    expect((await notices()).filter((notice) => notice.employee === "Dee Santos" && notice.kind === "Schedule changed")).toEqual([]);
  });
});

describe("the edit rules and email", () => {
  it("tells a reschedule from a text edit", () => {
    expect(scheduleDiffers(base, { ...base })).toBe(false);
    expect(scheduleDiffers(base, { ...base, endTime: "17:00" })).toBe(true);
    expect(scheduleDiffers(base, { ...base, mode: "In person" })).toBe(true);
  });

  it("accepts keeping a past date when editing, and rejects moving to one", () => {
    expect(readTrainingForm({ ...base }, "2026-12-01", { currentDate: "2026-11-20" }).errors.date).toBeUndefined();
    expect(readTrainingForm({ ...base, date: "2026-11-21" }, "2026-12-01", { currentDate: "2026-11-20" }).errors.date).toBeDefined();
    expect(readTrainingForm({ ...base }, "2026-12-01").errors.date).toBeDefined();
  });

  it("words the Schedule changed email without a gendered pronoun", () => {
    const email = scheduleChangedEmail("Ana Dizon", { ...base, date: "2026-11-27" }, base);
    expect(email.body).toMatch(/^Hi Ana,/);
    expect(email.body).not.toMatch(/\b(she|he|her|his)\b/i);
  });
});
