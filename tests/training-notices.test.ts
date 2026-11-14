import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_RETRIES, RETRY_AFTER_MS, assignmentEmail, deliverTrainingNotices, queueDueReminders, reminderEmail, trainingNoticesJob, type SendEmail } from "@/lib/training-notices";
import { trainingsFor } from "@/lib/trainings";
import type { MaterialFiles } from "@/lib/training-material-files";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
let clock: Date;
const staff = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const files: MaterialFiles = { requestUpload: vi.fn(), confirm: vi.fn(), remove: vi.fn(), viewUrl: vi.fn() };
const trainings = (sessionHandle: string | undefined = handle) => trainingsFor(sessionHandle, db, () => clock, files);
const sent: { id: string; payload: unknown }[] = [];
let failing = false;
const mailer: SendEmail = async (email) => { if (failing) throw new Error("mail down"); sent.push(email); };
const deliver = () => deliverTrainingNotices(db, () => clock, mailer);
const advance = (ms: number) => { clock = new Date(clock.getTime() + ms); };
const minutes = (n: number) => n * 60_000;

let count = 0;
async function employee(name: string, email = `${name.split(" ")[0].toLowerCase()}@example.test`) {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, email])).rows[0].id;
}
const training = () => trainings().create({ title: "POS and cash handling", trainer: "HR", description: "", objectives: "", date: "2026-11-20", startTime: "14:00", endTime: "16:00", mode: "Online", location: "https://meet.example.test/pos" });
const notices = async () => (await db.query<{ state: string; attempts: number; employee: string }>(`
  SELECT n.state, n.attempts, e.full_name AS employee FROM public.hrms_training_notices n JOIN public.hrms_employees e ON e.id = n.employee_id ORDER BY n.id`)).rows;

beforeEach(async () => {
  count = 0; failing = false; sent.length = 0;
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

describe("Assignment notices", () => {
  it("queues an Assignment email for each assigned Employee with an email and sends it, naming when and where", async () => {
    const id = await training();
    const ana = await employee("Ana Dizon");
    await trainings().assign(id, { employeeIds: [ana] });
    expect(await notices()).toEqual([{ state: "Queued", attempts: 0, employee: "Ana Dizon" }]);
    await deliver();
    expect(await notices()).toEqual([{ state: "Sent", attempts: 0, employee: "Ana Dizon" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ to: "ana@example.test", title: "Training assigned: POS and cash handling" });
    const body = (sent[0].payload as { body: string }).body;
    expect(body).toContain("Hi Ana,");
    expect(body).toContain("Fri, 20 Nov 2026");
    expect(body).toContain("2:00 – 4:00 PM");
    expect(body).toContain("Meeting link: https://meet.example.test/pos");
    await deliver();
    expect(sent).toHaveLength(1);
  });

  it("never emails, fails or marks Not reached an Employee with no email, and lists them as Needs printed schedule", async () => {
    const id = await training();
    const bea = await employee("Bea Cruz", "  ");
    expect(await trainings().assign(id, { employeeIds: [bea] })).toMatchObject({ needPrintedSchedule: 1 });
    failing = true;
    for (let i = 0; i < 6; i++) { await deliver(); advance(RETRY_AFTER_MS); }
    expect(await notices()).toEqual([]);
    const log = await trainings().log(id);
    expect(log.notReached).toEqual([]);
    expect(log.needsPrinted).toMatchObject([{ employeeName: "Bea Cruz", email: null, state: "Needs printed schedule", noticeId: null }]);
    expect(log.counts).toEqual({ "All notices": 1, "Not reached": 0, "Needs printed schedule": 1 });
  });

  it("words the email without a gendered pronoun and with the venue for an In person training", () => {
    const email = assignmentEmail("Ana Dizon", { title: "T", trainer: "HR", date: "2026-11-20", startTime: "08:00", endTime: "09:00", mode: "In person", location: "Main kitchen" });
    expect(email.body).toContain("Venue: Main kitchen");
    expect(email.body).not.toMatch(/\b(she|he|her|his)\b/i);
  });
});

describe("retrying a failed email", () => {
  it("retries 3 times about 15 minutes apart, then moves the Employee to Not reached", async () => {
    const id = await training();
    await trainings().assign(id, { employeeIds: [await employee("Ana Dizon")] });
    failing = true;
    await deliver();
    expect(await notices()).toEqual([{ state: "Retrying", attempts: 1, employee: "Ana Dizon" }]);
    // Not due yet: a run a minute later changes nothing.
    advance(minutes(1)); await deliver();
    expect((await notices())[0].attempts).toBe(1);
    for (let retry = 1; retry <= MAX_RETRIES; retry++) {
      advance(RETRY_AFTER_MS); await deliver();
      expect((await notices())[0]).toMatchObject({ attempts: retry + 1, state: retry < MAX_RETRIES ? "Retrying" : "Failed" });
    }
    advance(RETRY_AFTER_MS * 4); await deliver();
    expect((await notices())[0]).toMatchObject({ state: "Failed", attempts: MAX_RETRIES + 1 });
    expect((await trainings().log(id)).notReached.map((row) => row.employeeName)).toEqual(["Ana Dizon"]);
  });

  it("delivers a notice that succeeds on a retry, and stops retrying it", async () => {
    const id = await training();
    await trainings().assign(id, { employeeIds: [await employee("Ana Dizon")] });
    failing = true; await deliver();
    failing = false; advance(RETRY_AFTER_MS); await deliver();
    expect(await notices()).toEqual([{ state: "Sent", attempts: 1, employee: "Ana Dizon" }]);
    expect(sent).toHaveLength(1);
  });

  it("shows Try N of 3 and the next time while Retrying", async () => {
    const id = await training();
    await trainings().assign(id, { employeeIds: [await employee("Ana Dizon")] });
    failing = true; await deliver(); advance(RETRY_AFTER_MS); await deliver();
    const [row] = (await trainings().log(id)).rows;
    expect(row).toMatchObject({ state: "Retrying", attempts: 2 });
    expect(row.nextAttemptAt).toBe(new Date(clock.getTime() + RETRY_AFTER_MS).toISOString());
  });

  it("Retry re-queues a Not reached Employee with a fresh set of retries, and refuses a notice that isn't Failed", async () => {
    const id = await training();
    await trainings().assign(id, { employeeIds: [await employee("Ana Dizon")] });
    failing = true;
    for (let i = 0; i <= MAX_RETRIES; i++) { await deliver(); advance(RETRY_AFTER_MS); }
    const { noticeId } = (await trainings().log(id)).notReached[0];
    failing = false;
    await trainings().retryNotice(id, noticeId!);
    expect(await notices()).toEqual([{ state: "Retrying", attempts: 0, employee: "Ana Dizon" }]);
    await expect(trainings().retryNotice(id, noticeId!)).rejects.toMatchObject({ reason: "conflict" });
    await deliver();
    expect(await notices()).toEqual([{ state: "Sent", attempts: 0, employee: "Ana Dizon" }]);
    expect((await trainings().log(id)).notReached).toEqual([]);
    await expect(trainings().retryNotice(id, 9999)).rejects.toMatchObject({ reason: "not-found" });
  });
});

describe("the Notification log", () => {
  it("has a row per Employee with kind, time and state, newest first, and a preview of the latest events", async () => {
    const id = await training();
    const [ana, bea, cy] = [await employee("Ana Dizon"), await employee("Bea Cruz", ""), await employee("Cy Reyes")];
    await trainings().assign(id, { employeeIds: [ana, bea, cy] });
    failing = true; await deliver();
    const log = await trainings().log(id);
    expect(log.rows.map((row) => [row.employeeName, row.kind, row.state])).toEqual(expect.arrayContaining([
      ["Ana Dizon", "Assignment", "Retrying"], ["Cy Reyes", "Assignment", "Retrying"], ["Bea Cruz", "Assignment", "Needs printed schedule"],
    ]));
    expect(log.counts["All notices"]).toBe(3);
    expect(await trainings().logPreview(id)).toMatchObject([{ kind: "Assignment", sent: 0, retrying: 2, failed: 0, needPrinted: 1 }]);
  });

  it("keeps delivered notices when an Employee is removed, and drops the ones not yet delivered", async () => {
    const id = await training();
    const [ana, cy] = [await employee("Ana Dizon"), await employee("Cy Reyes")];
    await trainings().assign(id, { employeeIds: [ana] });
    await deliver();
    await trainings().assign(id, { employeeIds: [cy] });
    await trainings().unassign(id, ana);
    await trainings().unassign(id, cy);
    expect(await notices()).toEqual([{ state: "Sent", attempts: 0, employee: "Ana Dizon" }]);
    await deliver();
    expect(sent).toHaveLength(1);
  });

  it("refuses the log and Retry without the Training Module, and for an unknown Training", async () => {
    const id = await training();
    const denied = portal.signIn(staff, ["Offers"]);
    await expect(trainings(denied).log(id)).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(denied).retryNotice(id, 1)).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings().log(999)).rejects.toMatchObject({ reason: "not-found" });
  });
});

describe("the scheduled job", () => {
  it("needs the cron secret, then sends what is due", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const id = await training();
    await trainings().assign(id, { employeeIds: [await employee("Ana Dizon")] });
    const job = trainingNoticesJob(db, () => clock, mailer);
    expect((await job(new Request("https://x.test"))).status).toBe(401);
    expect((await job(new Request("https://x.test", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
    expect(sent).toHaveLength(0);
    expect((await job(new Request("https://x.test", { headers: { authorization: "Bearer s3cret" } }))).status).toBe(200);
    expect(sent).toHaveLength(1);
  });
});

describe("Reminders", () => {
  // The Training is on Fri 20 Nov 2026, so its automatic Reminder is due Thu 19 Nov at 8:00 AM Manila time (= 00:00 UTC).
  const at = (iso: string) => { clock = new Date(iso); };
  const queueDue = () => queueDueReminders(db, () => clock);
  const reminders = async () => (await db.query<{ employee: string; state: string; automatic: boolean }>(`
    SELECT e.full_name AS employee, n.state, n.automatic_for IS NOT NULL AS automatic FROM public.hrms_training_notices n
    JOIN public.hrms_employees e ON e.id = n.employee_id WHERE n.kind = 'Reminder' ORDER BY n.id`)).rows;
  const assignAll = async (id: number, ...people: [string, string?][]) => {
    const ids: number[] = [];
    for (const [name, email] of people) ids.push(await employee(name, email));
    await trainings().assign(id, { employeeIds: ids });
    await db.query(`DELETE FROM public.hrms_training_notices`); // leave out the Assignment emails
    return ids;
  };

  it("waits for 8:00 AM Manila time the day before, then queues one Reminder per assigned Employee with an email", async () => {
    const id = await training();
    await assignAll(id, ["Ana Dizon"], ["Liza Manalo"], ["Rhea Bautista", ""]);
    at("2026-11-18T23:59:00Z"); // 7:59 AM on the 19th in Manila
    await queueDue();
    expect(await reminders()).toEqual([]);
    at("2026-11-19T00:00:00Z"); // 8:00 AM
    await queueDue();
    expect(await reminders()).toEqual([{ employee: "Ana Dizon", state: "Queued", automatic: true }, { employee: "Liza Manalo", state: "Queued", automatic: true }]);
  });

  it("is safe to repeat or overlap: each Employee is reminded once for a date, however often the job runs", async () => {
    const id = await training();
    await assignAll(id, ["Ana Dizon"]);
    at("2026-11-19T00:05:00Z");
    await Promise.all([queueDue(), queueDue()]);
    at("2026-11-19T00:20:00Z");
    await queueDue();
    await deliver();
    await deliver();
    expect(await reminders()).toEqual([{ employee: "Ana Dizon", state: "Sent", automatic: true }]);
    expect(sent).toHaveLength(1);
    const payload = sent[0].payload as { to: string; title: string; body: string };
    expect(payload).toMatchObject({ to: "ana@example.test", title: "Reminder: POS and cash handling on Fri, 20 Nov" });
    expect(payload.body).toContain("Hi Ana,");
    expect(payload.body).toContain("Fri, 20 Nov 2026, 2:00 – 4:00 PM");
    expect(payload.body).toContain("Join online: https://meet.example.test/pos");
  });

  it("only reminds about a Training dated tomorrow, and not once the day has come or if the day before was missed", async () => {
    const id = await training();
    await assignAll(id, ["Ana Dizon"]);
    at("2026-11-18T05:00:00Z"); // two days before
    await queueDue();
    at("2026-11-20T01:00:00Z"); // the day itself, 9:00 AM
    await queueDue();
    at("2026-11-21T01:00:00Z");
    await queueDue();
    expect(await reminders()).toEqual([]);
  });

  it("leaves out Cancelled Trainings and Employees who are not still marked Assigned", async () => {
    const id = await training();
    const [ana, liza, rhea] = await assignAll(id, ["Ana Dizon"], ["Liza Manalo"], ["Rhea Bautista"]);
    await db.query(`UPDATE public.hrms_training_assignments SET status = 'Completed' WHERE employee_id = $1`, [ana]);
    await db.query(`UPDATE public.hrms_training_assignments SET status = 'Did not attend' WHERE employee_id = $1`, [liza]);
    at("2026-11-19T00:00:00Z");
    await queueDue();
    expect((await reminders()).map((row) => row.employee)).toEqual(["Rhea Bautista"]);
    await db.query(`DELETE FROM public.hrms_training_notices`);
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now()`);
    await queueDue();
    expect(await reminders()).toEqual([]);
    expect(rhea).toBeGreaterThan(0);
  });

  it("reminds again for a new date after a reschedule", async () => {
    const id = await training();
    await assignAll(id, ["Ana Dizon"]);
    at("2026-11-19T00:00:00Z");
    await queueDue();
    await db.query(`UPDATE public.hrms_trainings SET training_date = '2026-11-23' WHERE id = $1`, [id]);
    at("2026-11-22T00:30:00Z");
    await queueDue();
    expect(await reminders()).toHaveLength(2);
  });

  it("does not send an automatic Reminder to someone Staff already reminded by hand in the last 24 hours", async () => {
    const id = await training();
    await assignAll(id, ["Ana Dizon"], ["Liza Manalo"]);
    at("2026-11-18T23:00:00Z"); // 7:00 AM on the 19th
    await trainings().sendReminder(id);
    await db.query(`DELETE FROM public.hrms_training_notices WHERE employee_id = (SELECT id FROM public.hrms_employees WHERE full_name = 'Liza Manalo')`);
    at("2026-11-19T00:00:00Z");
    await queueDue();
    expect(await reminders()).toEqual([{ employee: "Ana Dizon", state: "Queued", automatic: false }, { employee: "Liza Manalo", state: "Queued", automatic: true }]);
  });

  it("is queued and sent by the scheduled job, which still needs its secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    const id = await training();
    await assignAll(id, ["Ana Dizon"]);
    at("2026-11-19T00:10:00Z");
    const job = trainingNoticesJob(db, () => clock, mailer);
    expect((await job(new Request("https://x.test"))).status).toBe(401);
    expect(await reminders()).toEqual([]);
    expect((await job(new Request("https://x.test", { headers: { authorization: "Bearer s3cret" } }))).status).toBe(200);
    expect(await reminders()).toEqual([{ employee: "Ana Dizon", state: "Sent", automatic: true }]);
    expect(sent).toHaveLength(1);
  });

  it("retries a failed Reminder like any notice, then marks the Employee Not reached", async () => {
    const id = await training();
    await assignAll(id, ["Ana Dizon"]);
    at("2026-11-19T00:00:00Z");
    failing = true;
    await queueDue();
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) { await deliver(); advance(RETRY_AFTER_MS); }
    expect(await reminders()).toEqual([{ employee: "Ana Dizon", state: "Failed", automatic: true }]);
    expect((await trainings().log(id)).notReached.map((row) => [row.employeeName, row.kind])).toEqual([["Ana Dizon", "Reminder"]]);
  });

  it("sends a manual reminder to Employees still Assigned who have an email, and says how many were left out", async () => {
    const id = await training();
    const [, liza] = await assignAll(id, ["Ana Dizon"], ["Liza Manalo"], ["Rhea Bautista", ""], ["Joel Ramirez", "  "]);
    await db.query(`UPDATE public.hrms_training_assignments SET status = 'Cancelled' WHERE employee_id = $1`, [liza]);
    await expect(trainings().sendReminder(id)).resolves.toEqual({ queued: 1, notEmailed: 2 });
    expect(await reminders()).toEqual([{ employee: "Ana Dizon", state: "Queued", automatic: false }]);
    await deliver();
    expect(sent).toHaveLength(1);
    // Showing in the Notification log as a Reminder, and again if Staff send another.
    expect((await trainings().log(id)).rows.filter((row) => row.kind === "Reminder").map((row) => [row.employeeName, row.state])).toEqual([["Ana Dizon", "Sent"]]);
    await trainings().sendReminder(id);
    expect(await reminders()).toHaveLength(2);
  });

  it("refuses a reminder for a Cancelled or past Training, an unknown one, and anyone without the Training Module", async () => {
    const id = await training();
    await assignAll(id, ["Ana Dizon"]);
    await expect(trainings(portal.signIn(staff, ["Offers"])).sendReminder(id)).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings().sendReminder(999)).rejects.toMatchObject({ reason: "not-found" });
    at("2026-11-21T02:00:00Z");
    await expect(trainings().sendReminder(id)).rejects.toMatchObject({ reason: "conflict" });
    at("2026-11-14T02:00:00Z");
    await db.query(`UPDATE public.hrms_trainings SET cancelled_at = now() WHERE id = $1`, [id]);
    await expect(trainings().sendReminder(id)).rejects.toMatchObject({ reason: "conflict" });
    expect(await reminders()).toEqual([]);
  });

  it("words the Reminder with the Training's when and where, and the venue for an In person Training", () => {
    const base = { title: "Safety drill", trainer: "Safety Officer", date: "2026-11-20", startTime: "08:00", endTime: "09:30" };
    expect(reminderEmail("Carla Mendoza", { ...base, mode: "In person", location: "Main kitchen, Antipolo" })).toEqual({
      title: "Reminder: Safety drill on Fri, 20 Nov",
      body: ["Hi Carla,", "", 'This is a reminder about your training "Safety drill" on Fri, 20 Nov 2026, 8:00 – 9:30 AM.', "", "Venue: Main kitchen, Antipolo", "", "Bren Raphael's HR"].join("\n"),
    });
  });
});
