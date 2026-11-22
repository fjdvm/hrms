import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryJobPostingAnnouncements } from "@/lib/job-postings";
import { deliverStaffNotifications } from "@/lib/staff-notifications";
import { MAX_RETRIES, RETRY_AFTER_MS, deliverTrainingNotices, trainingNoticesJob, type SendEmail } from "@/lib/training-notices";
import type { MaterialFiles } from "@/lib/training-material-files";
import { TrainingError, trainingsFor } from "@/lib/trainings";
import type { TrainingTerms } from "@/lib/training-terms";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
let clock: Date;
let gatewayUp: boolean;
let audits: Record<string, any>[]; // eslint-disable-line @typescript-eslint/no-explicit-any
let bell: { body: Record<string, unknown> & { userIds: string[] } }[];
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const files: MaterialFiles = { requestUpload: vi.fn(), confirm: vi.fn(), remove: vi.fn(), viewUrl: vi.fn() };
const trainings = (sessionHandle: string | undefined = handle) => trainingsFor(sessionHandle, db, () => clock, files);
const terms = (overrides: Partial<TrainingTerms> = {}): TrainingTerms => ({
  title: "Food safety refresher", trainer: "QA Manager", description: "", objectives: "", date: "2026-11-18",
  startTime: "09:00", endTime: "11:00", mode: "In person", location: "Main kitchen", ...overrides,
});
const FORBIDDEN = /password|token|secret|authorization|card|cvv/i;

let count = 0;
async function employee(name: string, email: string | null = `${name.split(" ")[0].toLowerCase()}@example.test`) {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Sat', 'None', 'Paolo', 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, email ?? ""])).rows[0].id;
}
const outbox = async () => (await db.query<{ id: string; payload: Record<string, any> }>(`SELECT id, payload FROM public.hrms_audit_outbox ORDER BY id`)).rows; // eslint-disable-line @typescript-eslint/no-explicit-any
const staffRows = async () => (await db.query<{ id: string; payload: Record<string, unknown> }>(`SELECT id, payload FROM public.hrms_staff_notifications ORDER BY id`)).rows;
/** Every event the gateway received, whatever the order of delivery. */
const actions = () => audits.map((event) => event.action);
const newTraining = async (overrides: Partial<TrainingTerms> = {}) => trainings().create(terms(overrides));

beforeEach(async () => {
  count = 0;
  gatewayUp = true;
  audits = [];
  bell = [];
  clock = new Date("2026-11-14T02:00:00Z");
  vi.mocked(files.requestUpload).mockReset().mockResolvedValue({ fileId: "file-1", uploadUrl: "https://files.test/put" });
  vi.mocked(files.confirm).mockReset().mockResolvedValue(undefined);
  vi.mocked(files.remove).mockReset().mockResolvedValue(undefined);
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
  portal.directory = [
    { id: "t-1", username: "tia", modules: ["Training"] }, { id: "t-2", username: "tom", modules: ["Training", "Performance"] },
    { id: "p-1", username: "pam", modules: ["Performance"] },
  ];
  handle = portal.signIn(staff, ["Training"]);
  const boundary = portalFetch(portal);
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "hrms-key");
  vi.stubEnv("NOTIFICATIONS_APP", "HRMS");
  vi.stubEnv("HRMS_APP_URL", "https://hrms.test");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://gateway.test")) return boundary(input, init);
    if (!gatewayUp) return Response.json({}, { status: 503 });
    if (url.endsWith("/audit/events")) { audits.push(JSON.parse(String(init?.body))); return Response.json({}, { status: 201 }); }
    bell.push({ body: JSON.parse(String(init?.body)) });
    return Response.json({}, { status: 202 });
  });
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("one Audit event per Staff action", () => {
  it("records every Training mutation with the Staff member's Portal id, a target naming the Training, and a stable key", async () => {
    const ann = await employee("Ann Reyes");
    const id = await newTraining();
    await trainings().assign(id, { employeeIds: [ann] });
    await trainings().update(id, terms({ title: "Food safety, revised" }), { notify: false });
    await trainings().update(id, terms({ title: "Food safety, revised", date: "2026-11-20" }), { notify: true });
    await trainings().sendReminder(id);
    clock = new Date("2026-11-21T02:00:00Z");
    await trainings().markResults(id, { marks: [{ employeeId: ann, status: "Completed", completedOn: "2026-11-20" }] });
    await trainings().recordFeedback(id, ann, { rating: 5, comments: "Very useful" });
    await trainings().markResults(id, { marks: [{ employeeId: ann, status: "Assigned" }] });
    await trainings().unassign(id, ann);
    await trainings().cancel(id, { reason: "Trainer is unavailable", notify: false });

    expect(actions()).toEqual([
      "training.created", "training.employee_assigned", "training.updated", "training.rescheduled", "training.reminder_sent",
      "training.results_marked", "training.feedback_recorded", "training.results_marked", "training.employee_unassigned", "training.cancelled",
    ]);
    for (const event of audits) {
      expect(event).toMatchObject({
        source: "HRMS", module: "Training", outcome: "success",
        actor: { type: "user", id: "u-ada", display_name: "Ada Okafor" },
        target: { type: "training", id: String(id), display_name: expect.stringContaining("Food safety") },
      });
      expect(event.description).toContain("Ada Okafor");
      expect(event.description).toContain("Food safety");
      expect(event.idempotency_key).toBeTruthy();
    }
    expect(new Set(audits.map((event) => event.idempotency_key)).size).toBe(audits.length);
    expect(await outbox()).toHaveLength(0); // all delivered
  });

  it("sends training.rescheduled for a changed date or time and training.updated for anything else, and nothing when nothing changed", async () => {
    const id = await newTraining();
    await trainings().update(id, terms({ description: "More detail" }), { notify: false });
    await trainings().update(id, terms({ description: "More detail", startTime: "10:00" }), { notify: false });
    await trainings().update(id, terms({ description: "More detail", startTime: "10:00" }), { notify: false });
    expect(actions()).toEqual(["training.created", "training.updated", "training.rescheduled"]);
  });

  it("writes one event for an action that touches several Employees, with their ids and a count within 4 KB", async () => {
    const ids = [await employee("A One"), await employee("B Two"), await employee("C Three")];
    const id = await newTraining();
    audits.length = 0;
    await trainings().assign(id, { employeeIds: ids });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ training_id: id, employee_ids: ids, employee_count: 3 });
    clock = new Date("2026-11-21T02:00:00Z");
    audits.length = 0;
    await trainings().markResults(id, { marks: ids.map((employeeId) => ({ employeeId, status: "Completed" as const, completedOn: "2026-11-20" })) });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata).toMatchObject({ employee_ids: ids, employee_count: 3, completed: 3, did_not_attend: 0 });
  });

  it("lists at most 100 Employee ids but always counts them all, so a whole department stays within 4 KB", async () => {
    const id = await newTraining();
    for (let i = 0; i < 130; i += 1) await employee(`Person ${i}`);
    audits.length = 0;
    await trainings().assign(id, { department: "Retail" });
    expect(audits).toHaveLength(1);
    expect(audits[0].metadata.employee_count).toBe(130);
    expect(audits[0].metadata.employee_ids).toHaveLength(100);
    expect(Buffer.byteLength(JSON.stringify(audits[0].metadata), "utf8")).toBeLessThan(4096);
  });

  it("keeps Staff-typed text out of the metadata and never uses a forbidden key", async () => {
    const ann = await employee("Ann Reyes");
    const id = await newTraining({ description: "SECRET-DESCRIPTION-TEXT" });
    await trainings().assign(id, { employeeIds: [ann] });
    clock = new Date("2026-11-21T02:00:00Z");
    await trainings().markResults(id, { marks: [{ employeeId: ann, status: "Completed", completedOn: "2026-11-20" }] });
    await trainings().recordFeedback(id, ann, { rating: 4, comments: "FEEDBACK-COMMENT-TEXT" });
    await trainings().markResults(id, { marks: [{ employeeId: ann, status: "Assigned" }] });
    const other = await newTraining({ date: "2026-11-25" });
    await trainings().cancel(other, { reason: "CANCEL-REASON-TEXT", notify: true });
    const walk = (value: unknown, visit: (key: string, nested: unknown) => void) => {
      if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
      else if (value && typeof value === "object") for (const [key, nested] of Object.entries(value)) { visit(key, nested); walk(nested, visit); }
    };
    expect(audits.length).toBeGreaterThan(6);
    for (const event of audits) {
      walk(event.metadata, (key) => expect(key).not.toMatch(FORBIDDEN));
      const metadata = JSON.stringify(event.metadata ?? {});
      for (const typed of ["SECRET-DESCRIPTION-TEXT", "FEEDBACK-COMMENT-TEXT", "CANCEL-REASON-TEXT"]) expect(metadata).not.toContain(typed);
      expect(Buffer.byteLength(metadata, "utf8")).toBeLessThan(4096);
    }
  });

  it("records a material upload when it is confirmed, once, and a delete, with the Training as the target when there is one", async () => {
    const id = await newTraining();
    audits.length = 0;
    await trainings().requestMaterial({ filename: "guide.pdf", contentType: "application/pdf", size: 1000 }, id);
    expect(audits).toHaveLength(0); // asking for an upload address is not an upload
    await trainings().confirmMaterial("file-1");
    await trainings().confirmMaterial("file-1");
    expect(actions()).toEqual(["training_material.uploaded"]);
    expect(audits[0]).toMatchObject({ target: { type: "training", id: String(id) }, metadata: { file_id: "file-1", training_id: id, size: 1000 } });
    await trainings().deleteMaterial("file-1");
    expect(actions()).toEqual(["training_material.uploaded", "training_material.deleted"]);
    expect(audits[1].metadata).toMatchObject({ file_id: "file-1", training_id: id });
  });

  it("claims confirmed form uploads when the Training is created and reports how many", async () => {
    await trainings().requestMaterial({ filename: "guide.pdf", contentType: "application/pdf", size: 1000 });
    await trainings().confirmMaterial("file-1");
    expect(audits[0]).toMatchObject({ action: "training_material.uploaded", target: { type: "training_material", id: "file-1" } });
    const id = await trainings().create(terms(), ["file-1"]);
    expect(audits.at(-1)).toMatchObject({ action: "training.created", metadata: { training_id: id, materials_attached: 1 } });
  });

  it("records a notice retry", async () => {
    const ann = await employee("Ann Reyes");
    const id = await newTraining();
    await trainings().assign(id, { employeeIds: [ann] });
    const failing: SendEmail = async () => { throw new Error("mail down"); };
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (let i = 0; i <= MAX_RETRIES; i += 1) { await deliverTrainingNotices(db, () => clock, failing); clock = new Date(clock.getTime() + RETRY_AFTER_MS); }
    const { rows } = await db.query<{ id: number; state: string }>(`SELECT id, state FROM public.hrms_training_notices`);
    expect(rows[0].state).toBe("Failed");
    audits.length = 0;
    await trainings().retryNotice(id, rows[0].id);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "training.notice_retried", metadata: { training_id: id, notice_id: rows[0].id, employee_id: ann } });
  });

  it("sends nothing for reads, the schedule preview or printing", async () => {
    const ann = await employee("Ann Reyes", null);
    const id = await newTraining();
    await trainings().assign(id, { employeeIds: [ann] });
    audits.length = 0;
    await trainings().list();
    await trainings().read(id);
    await trainings().log(id);
    await trainings().schedule([id], { includeNames: true });
    await trainings().printSchedule([id], { includeNames: true });
    expect(audits).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
  });
});

describe("the change, its event and its notification commit together", () => {
  it("leaves no event and no notification when a mutation is refused", async () => {
    const ann = await employee("Ann Reyes");
    const id = await newTraining();
    await trainings().assign(id, { employeeIds: [ann] });
    await trainings().cancel(id, { reason: "Off", notify: false });
    gatewayUp = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
    gatewayUp = true;
    const open = await newTraining({ date: "2026-11-25" });
    gatewayUp = false;
    const before = { audit: (await outbox()).length, notes: (await staffRows()).length };
    await expect(trainings().update(id, terms({ title: "New title" }), { notify: false })).rejects.toMatchObject({ reason: "conflict" });
    await expect(trainings().cancel(id, { reason: "Again", notify: false })).rejects.toMatchObject({ reason: "conflict" });
    await expect(trainings().assign(id, { employeeIds: [ann] })).rejects.toMatchObject({ reason: "conflict" });
    await expect(trainings().sendReminder(id)).rejects.toMatchObject({ reason: "conflict" });
    await expect(trainings().assign(open, { employeeIds: [] })).rejects.toMatchObject({ reason: "validation" });
    await expect(trainings().assign(open, { employeeIds: [999] })).rejects.toMatchObject({ reason: "validation" });
    expect({ audit: (await outbox()).length, notes: (await staffRows()).length }).toEqual(before);
  });

  it("refuses a cancel that a recorded result has made impossible, writing nothing", async () => {
    const ann = await employee("Ann Reyes");
    const id = await newTraining();
    await trainings().assign(id, { employeeIds: [ann] });
    clock = new Date("2026-11-21T02:00:00Z");
    await trainings().markResults(id, { marks: [{ employeeId: ann, status: "Completed", completedOn: "2026-11-20" }] });
    const before = { audit: audits.length, notes: (await staffRows()).length };
    await expect(trainings().cancel(id, { reason: "Too late", notify: true })).rejects.toBeInstanceOf(TrainingError);
    expect(audits).toHaveLength(before.audit);
    expect((await staffRows()).length).toBe(before.notes);
    expect((await db.query("SELECT 1 FROM public.hrms_trainings WHERE cancelled_at IS NOT NULL")).rows).toHaveLength(0);
  });

  it("refuses Staff without the Training Module and queues nothing", async () => {
    const id = await newTraining();
    const other = portal.signIn({ id: "u-bo", name: "Bo", username: "bo", email: "bo@example.test", role: "Clerk" }, ["Performance"]);
    audits.length = 0;
    await expect(trainings(other).create(terms())).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(other).cancel(id, { reason: "x", notify: false })).rejects.toMatchObject({ reason: "denied" });
    await expect(trainings(other).deleteMaterial("file-1")).rejects.toMatchObject({ reason: "denied" });
    expect(audits).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
    expect(await staffRows()).toHaveLength(0);
  });

  it("keeps a successful Staff action when audit-logs is down, then delivers the event once from the maintenance route", async () => {
    gatewayUp = false;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const id = await newTraining();
    expect(id).toBeGreaterThan(0);
    expect((await db.query("SELECT 1 FROM public.hrms_trainings")).rows).toHaveLength(1);
    const queued = await outbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ action: "training.created", target: { id: String(id) } });
    expect(log).toHaveBeenCalled();
    gatewayUp = true;
    await db.query("UPDATE public.hrms_audit_outbox SET next_attempt_at = '2000-01-01'");
    await retryJobPostingAnnouncements(db);
    await retryJobPostingAnnouncements(db);
    expect(audits).toHaveLength(1);
    expect(audits[0].idempotency_key).toBe(queued[0].payload.idempotency_key);
    expect(await outbox()).toHaveLength(0);
  });
});

describe("Staff notifications to the Training Module holders", () => {
  it("tells them once when a Training is cancelled, linking to it, and does not flush it itself", async () => {
    const id = await newTraining();
    await trainings().cancel(id, { reason: "Trainer unavailable", notify: false });
    const rows = await staffRows();
    expect(rows.map((row) => row.id)).toEqual([`training.cancelled:${id}`]);
    expect(rows[0].payload).toMatchObject({ type: "training", link: `/training/${id}` });
    expect(bell).toHaveLength(0);
    await deliverStaffNotifications(db);
    expect(bell).toHaveLength(1);
    expect([...bell[0].body.userIds].sort()).toEqual(["t-1", "t-2"]);
    expect(String(bell[0].body.link)).toBe(`https://hrms.test/training/${id}`);
  });

  it("tells them about every reschedule with its own id, so a second one is not dropped", async () => {
    const id = await newTraining();
    await trainings().update(id, terms({ date: "2026-11-20" }), { notify: false });
    await trainings().update(id, terms({ date: "2026-11-22" }), { notify: false });
    const events = (await db.query<{ id: number }>(`SELECT id FROM public.hrms_training_events ORDER BY id`)).rows.map((row) => row.id);
    expect(events).toHaveLength(2);
    expect((await staffRows()).map((row) => row.id)).toEqual(events.map((event) => `training.rescheduled:${event}`));
  });

  it("tells them once when an Employee becomes Not reached, queued in the statement that marks the notice Failed", async () => {
    const ann = await employee("Ann Reyes");
    const id = await newTraining();
    await trainings().assign(id, { employeeIds: [ann] });
    expect(await staffRows()).toHaveLength(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: SendEmail = async () => { throw new Error("mail down"); };
    for (let i = 0; i < MAX_RETRIES; i += 1) { await deliverTrainingNotices(db, () => clock, failing); clock = new Date(clock.getTime() + RETRY_AFTER_MS); }
    expect(await staffRows()).toHaveLength(0); // still Retrying
    await deliverTrainingNotices(db, () => clock, failing);
    const noticeId = (await db.query<{ id: number }>(`SELECT id FROM public.hrms_training_notices`)).rows[0].id;
    const rows = await staffRows();
    expect(rows.map((row) => row.id)).toEqual([`training.not-reached:${noticeId}`]);
    expect(rows[0].payload).toMatchObject({ type: "training", link: `/training/${id}/log` });
    await deliverTrainingNotices(db, () => clock, failing);
    expect(await staffRows()).toHaveLength(1);
  });

  it("flushes Staff notifications at the end of the 15-minute job and sends no Audit event itself", async () => {
    const ann = await employee("Ann Reyes");
    const id = await newTraining();
    await trainings().assign(id, { employeeIds: [ann] });
    audits.length = 0;
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing: SendEmail = async () => { throw new Error("mail down"); };
    const job = trainingNoticesJob(db, () => clock, failing, deliverStaffNotifications);
    const call = () => job(new Request("https://hrms.test/api/cron/training-notices", { headers: { authorization: "Bearer cron-secret" } }));
    for (let i = 0; i <= MAX_RETRIES; i += 1) { expect((await call()).status).toBe(200); clock = new Date(clock.getTime() + RETRY_AFTER_MS); }
    expect(bell.map((sent) => sent.body.type)).toEqual(["training"]);
    expect([...bell[0].body.userIds].sort()).toEqual(["t-1", "t-2"]);
    expect(audits).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
  });

  it("raises no Staff notification for create, assign, results, feedback, materials or reminders", async () => {
    const ann = await employee("Ann Reyes");
    const id = await newTraining();
    await trainings().assign(id, { employeeIds: [ann] });
    await trainings().sendReminder(id);
    await trainings().requestMaterial({ filename: "guide.pdf", contentType: "application/pdf", size: 10 }, id);
    await trainings().confirmMaterial("file-1");
    await trainings().deleteMaterial("file-1");
    clock = new Date("2026-11-21T02:00:00Z");
    await trainings().markResults(id, { marks: [{ employeeId: ann, status: "Completed", completedOn: "2026-11-20" }] });
    await trainings().recordFeedback(id, ann, { rating: 3 });
    expect(await staffRows()).toHaveLength(0);
  });
});
