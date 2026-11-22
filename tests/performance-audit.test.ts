import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { retryJobPostingAnnouncements } from "@/lib/job-postings";
import { PerformanceError, performanceFor, type RawAttendanceRow } from "@/lib/performance";
import type { AiClient, AiConfig } from "@/lib/ai";
import { deliverStaffNotifications } from "@/lib/staff-notifications";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

type Sent = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
let db: PGlite;
let portal: FakePortal;
let handle: string;
let gatewayUp: boolean;
let audits: Sent[];
let bell: { body: Record<string, unknown> & { userIds: string[] } }[];
let ai: { client?: AiClient; config?: AiConfig } = {};
const clock = new Date("2026-12-01T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock, ai);
const config = (): AiConfig => ({ apiKey: "sk-test", model: "gpt-4.1-mini", enabled: { "job-draft": true, suggestions: true }, limits: { "job-draft": 20, suggestions: 60 }, budget: null });
const FORBIDDEN = /password|token|secret|authorization|card|cvv/i;
const NOV = { type: "Month", year: 2026, month: 11 } as const;
let count = 0;

async function employee(name: string) {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count])).rows[0].id;
  const id = (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Active', 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, `${name.split(" ")[0].toLowerCase()}${count}@example.test`])).rows[0].id;
  await db.query(`UPDATE public.hrms_employees SET shift_start = '08:00', shift_end = '17:00', working_days = $2::smallint[] WHERE id = $1`, [id, [1, 2, 3, 4, 5]]);
  return id;
}
const NUMBER = (id: number) => `2026-${String(id).padStart(3, "0")}`;
const WEEKDAYS = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`).filter((d) => { const day = new Date(`${d}T00:00:00Z`).getUTCDay(); return day >= 1 && day <= 5; });
const fullMonth = (id: number, withoutTimeOut: string[] = []): RawAttendanceRow[] => WEEKDAYS.map((date) => ({ employeeNumber: NUMBER(id), date, timeIn: "08:00", timeOut: withoutTimeOut.includes(date) ? "" : "17:00" }));
async function train(employeeId: number) {
  let day = 2;
  for (const status of ["Completed", "Completed"]) {
    const t = (await db.query<{ id: number }>(`INSERT INTO public.hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name)
      VALUES ('Session', 'QA', $1, '09:00', '11:00', 'In person', 'Kitchen', 'Ada') RETURNING id`, [`2026-11-${String(day++).padStart(2, "0")}`])).rows[0].id;
    await db.query(`INSERT INTO public.hrms_training_assignments (training_id, employee_id, status) VALUES ($1, $2, $3)`, [t, employeeId, status]);
  }
}
const outbox = async () => (await db.query<{ id: string; payload: Sent }>(`SELECT id, payload FROM public.hrms_audit_outbox ORDER BY id`)).rows;
const staffRows = async () => (await db.query<{ id: string; payload: Record<string, unknown> }>(`SELECT id, payload FROM public.hrms_staff_notifications ORDER BY id`)).rows;
const history = async () => (await db.query<{ action: string }>(`SELECT action FROM public.hrms_performance_audit ORDER BY id`)).rows.map((row) => row.action);
const actions = () => audits.map((event) => event.action);
/** Setting up is audited too, so tests clear it and look only at what they are about. */
const settle = async () => { audits = []; bell = []; await db.query("DELETE FROM public.hrms_audit_outbox"); await db.query("DELETE FROM public.hrms_staff_notifications"); };
async function inReview(name = "Ana Cruz") {
  const period = (await performance().listPeriods())[0] ?? (await performance().openPeriod(NOV));
  const id = await employee(name);
  await performance().importAttendance({ fileName: `emp-${id}.csv`, rows: fullMonth(id) });
  await train(id);
  await performance().saveRating(id, period.id, { rating: 80, comments: "Reliable and punctual." });
  return { period, id };
}
async function evaluated(name?: string) {
  const { period, id } = await inReview(name);
  await performance().submitEvaluation(id, period.id);
  return { period, id };
}

beforeEach(async () => {
  count = 0;
  gatewayUp = true;
  audits = [];
  bell = [];
  ai = { client: undefined, config: config() };
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  portal = new FakePortal();
  portal.directory = [{ id: "p-1", username: "pam", modules: ["Performance"] }, { id: "p-2", username: "pia", modules: ["Performance", "Training"] }, { id: "t-1", username: "tia", modules: ["Training"] }];
  handle = portal.signIn(staff, ["Performance"]);
  const boundary = portalFetch(portal);
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith("https://gateway.test")) return boundary(input, init);
    if (!gatewayUp) return Response.json({}, { status: 503 });
    if (url.endsWith("/audit/events")) { audits.push(JSON.parse(String(init?.body))); return Response.json({}, { status: 201 }); }
    bell.push({ body: JSON.parse(String(init?.body)) });
    return Response.json({}, { status: 202 });
  });
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "gateway-key");
  vi.stubEnv("NOTIFICATIONS_APP", "HRMS");
  vi.stubEnv("HRMS_APP_URL", "https://hrms.test");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("one Audit event per Staff action", () => {
  it("records KPI, weight-set, period and calendar changes with the Staff member's Portal id and a readable target", async () => {
    const WEIGHTS = { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 };
    await performance().setKpiStatus("punctuality", "Inactive");
    await performance().setKpiStatus("punctuality", "Inactive"); // no change, no event
    await performance().setKpiStatus("punctuality", "Active");
    const created = await performance().saveWeightSet({ position: "Branch Cashier", weights: WEIGHTS });
    await performance().saveWeightSet({ id: created.id, position: "Branch Cashier", weights: { ...WEIGHTS, attendanceRate: 35, evaluatorRating: 10 } });
    const period = await performance().openPeriod(NOV);
    const entry = await performance().addNonWorkingDate({ date: "2026-11-30", name: "Bonifacio Day", type: "Holiday" });
    await performance().updateNonWorkingDate(entry.id, { date: "2026-11-27", name: "Company day off", type: "Closure" });
    await performance().removeNonWorkingDate(entry.id);

    expect(actions()).toEqual(["kpi.deactivated", "kpi.activated", "weight_set.created", "weight_set.updated", "performance_period.opened",
      "non_working_date.added", "non_working_date.updated", "non_working_date.removed"]);
    for (const event of audits) {
      expect(event).toMatchObject({ source: "HRMS", module: "Performance", outcome: "success", actor: { type: "user", id: "u-ada", display_name: "Ada Okafor" } });
      expect(event.description).toContain("Ada Okafor");
      expect(event.idempotency_key).toBeTruthy();
    }
    expect(audits[0].target).toMatchObject({ type: "kpi", id: "punctuality", display_name: "Punctuality" });
    expect(audits[2].target).toMatchObject({ type: "weight_set", id: String(created.id), display_name: "Branch Cashier" });
    expect(audits[4].target).toMatchObject({ type: "performance_period", id: String(period.id), display_name: "November 2026" });
    expect(audits[4].metadata).toMatchObject({ period_id: period.id, period_type: "Month", grace_minutes: 10 });
    expect(audits[5].target).toMatchObject({ type: "non_working_date", id: String(entry.id), display_name: "2026-11-30" });
    expect(audits[6].metadata).toMatchObject({ date: "2026-11-27", date_before: "2026-11-30" });
    expect(new Set(audits.map((event) => event.idempotency_key)).size).toBe(audits.length);
    // Nothing Staff typed (the set name, the calendar name or notes) is in a metadata.
    expect(JSON.stringify(audits.map((event) => event.metadata))).not.toMatch(/Bonifacio|Company day off|Branch Cashier/);
    expect(await outbox()).toHaveLength(0);
  });

  it("records an attendance import as one event with counts, never the rows", async () => {
    await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    audits = [];
    const rows = [...fullMonth(id), { employeeNumber: "9999-999", date: "2026-11-02", timeIn: "08:00", timeOut: "17:00" }];
    const saved = await performance().importAttendance({ fileName: "november.csv", rows });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "attendance.imported", target: { type: "attendance_import", id: String(saved.id), display_name: "november.csv" } });
    expect(audits[0].metadata).toEqual({ import_id: saved.id, total_rows: rows.length, usable_rows: WEEKDAYS.length, rejected_rows: 1 });
    expect(Buffer.byteLength(JSON.stringify(audits[0].metadata), "utf8")).toBeLessThan(4096);
  });

  it("records excusing several days as one event with the dates, and nothing when every date was already excused", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    const missing = WEEKDAYS.slice(0, 3);
    await performance().importAttendance({ fileName: "n.csv", rows: fullMonth(id, missing) });
    audits = [];
    await performance().excuseDays(id, period.id, ["2026-11-02", "2026-11-03", "2026-11-04"]);
    await performance().excuseDays(id, period.id, ["2026-11-02"]); // already excused: nothing changes, no event
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: "attendance_day.excused", target: { type: "attendance", id: `${id}:${period.id}`, display_name: "Ana Cruz · November 2026" },
      metadata: { employee_id: id, period_id: period.id, dates: ["2026-11-02", "2026-11-03", "2026-11-04"], date_count: 3 } });
  });

  it("records resolving a day as Excused or Absent, and confirming no attendance, without the reason", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz");
    const bo = await employee("Bo Lim");
    await performance().importAttendance({ fileName: "n.csv", rows: fullMonth(ana, [WEEKDAYS[3], WEEKDAYS[4]]) });
    audits = [];
    await performance().resolveDay(ana, period.id, WEEKDAYS[3], { type: "Excused", reason: "SECRET-EXCUSE-TEXT" });
    await performance().resolveDay(ana, period.id, WEEKDAYS[4], { type: "Absent", reason: "SECRET-ABSENT-TEXT" });
    await performance().confirmNoAttendance(bo, period.id, "SECRET-NO-ATTENDANCE-TEXT");
    expect(actions()).toEqual(["attendance_day.excused", "attendance_day.marked_absent", "attendance.no_attendance_confirmed"]);
    expect(audits[0].target).toMatchObject({ type: "attendance_day", id: `${ana}:${period.id}:${WEEKDAYS[3]}`, display_name: `Ana Cruz · ${WEEKDAYS[3]}` });
    expect(audits[0].metadata).toMatchObject({ employee_id: ana, period_id: period.id, date: WEEKDAYS[3] });
    expect(audits[2].target).toMatchObject({ type: "attendance", id: `${bo}:${period.id}`, display_name: "Bo Lim · November 2026" });
    expect(JSON.stringify(audits)).not.toMatch(/SECRET-/);
  });

  it("records a saved rating with the rating and whether the comments changed, never the comments", async () => {
    const { period, id } = await inReview();
    audits = [];
    await performance().saveRating(id, period.id, { rating: 90, comments: "COMMENT-TEXT-ONE" });
    await performance().saveRating(id, period.id, { rating: 95, comments: "COMMENT-TEXT-ONE" });
    expect(actions()).toEqual(["rating.saved", "rating.saved"]);
    expect(audits[0]).toMatchObject({ target: { type: "evaluation", id: `${id}:${period.id}`, display_name: "Ana Cruz · November 2026" }, metadata: { rating: 90, comments_changed: true, first: false } });
    expect(audits[1].metadata).toMatchObject({ rating: 95, comments_changed: false });
    expect(JSON.stringify(audits)).not.toContain("COMMENT-TEXT");
  });

  it("records a development need flagged by hand and one flagged from an AI suggestion, and nothing for generating or dismissing", async () => {
    const { period, id } = await evaluated();
    ai = { client: async () => ({ ok: true, output: { suggestions: [
      { kpiId: "evaluatorRating", gap: "Gap one", trainingId: null, recommendation: "Coach one", reason: "Because." },
      { kpiId: "evaluatorRating", gap: "Gap two", trainingId: null, recommendation: "Coach two", reason: "Because." },
    ] }, inputTokens: 1, outputTokens: 1 }), config: config() };
    await settle();
    const generated = await performance().generateSuggestions(id, period.id);
    if (!generated.ok) throw new Error("not generated");
    const [first, second] = generated.set.suggestions;
    await performance().dismissSuggestion(second.id);
    expect(audits).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);

    const need = await performance().flagDevelopmentNeed(id, period.id, { gap: "NEED-GAP-TEXT", action: "NEED-ACTION-TEXT" });
    const fromAi = await performance().flagSuggestion(first.id);
    expect(actions()).toEqual(["development_need.flagged", "development_need.flagged"]);
    expect(audits[0]).toMatchObject({ target: { type: "evaluation", id: `${id}:${period.id}`, display_name: "Ana Cruz · November 2026" }, metadata: { need_id: need.id, from_suggestion: false } });
    expect(audits[1].metadata).toMatchObject({ need_id: fromAi.id, from_suggestion: true, suggestion_id: first.id });
    expect(JSON.stringify(audits)).not.toMatch(/NEED-GAP|NEED-ACTION|Gap one|Coach one/);
  });

  it("never uses a forbidden key or Staff-typed text in a metadata, and keeps every metadata under 4 KB", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    await performance().importAttendance({ fileName: "n.csv", rows: fullMonth(id) });
    await performance().excuseDays(id, period.id, WEEKDAYS);
    const entry = await performance().addNonWorkingDate({ date: "2026-11-30", name: "A holiday", type: "Holiday" });
    await performance().removeNonWorkingDate(entry.id);
    const walk = (value: unknown, visit: (key: string) => void) => {
      if (Array.isArray(value)) value.forEach((item) => walk(item, visit));
      else if (value && typeof value === "object") for (const [key, nested] of Object.entries(value)) { visit(key); walk(nested, visit); }
    };
    expect(audits.length).toBeGreaterThan(3);
    for (const event of audits) {
      walk(event.metadata, (key) => expect(key).not.toMatch(FORBIDDEN));
      expect(Buffer.byteLength(JSON.stringify(event.metadata ?? {}), "utf8")).toBeLessThan(4096);
    }
  });

  it("keeps the existing submit and reopen events and the local history exactly as before", async () => {
    const { period, id } = await inReview();
    await performance().submitEvaluation(id, period.id);
    await performance().reopenEvaluation(id, period.id, "Correcting the import");
    const events = audits.filter((event) => event.action === "record.updated");
    expect(events.map((event) => event.metadata.operation)).toEqual(["evaluation.submitted", "evaluation.reopened"]);
    expect(events[1].description).toBe("Ada Okafor reopened the evaluation of Ana Cruz for November 2026: Correcting the import");
    expect(await history()).toEqual(expect.arrayContaining(["period-opened", "attendance-imported", "rating-saved", "evaluation-submitted", "evaluation-reopened"]));
  });
});

describe("the change, its history, its event and its notification commit together", () => {
  it("leaves none of them when a mutation is refused", async () => {
    const { period, id } = await evaluated();
    await settle();
    const before = { history: (await history()).length };
    await expect(performance().saveRating(id, period.id, { rating: 10 })).rejects.toBeDefined(); // already submitted
    await expect(performance().setKpiStatus("nonsense", "Active")).rejects.toBeDefined();
    await expect(performance().addNonWorkingDate({ date: "not-a-date", name: "x", type: "Holiday" })).rejects.toBeDefined();
    await expect(performance().flagDevelopmentNeed(id, period.id, { gap: "", action: "" })).rejects.toBeDefined();
    await expect(performance().reopenEvaluation(id, 999, "x")).rejects.toBeDefined();
    expect(audits).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
    expect(await staffRows()).toHaveLength(0);
    expect((await history()).length).toBe(before.history);
  });

  it("refuses Staff without the Performance Module and queues nothing", async () => {
    const other = portal.signIn({ id: "u-bo", name: "Bo", username: "bo", email: "bo@example.test", role: "Clerk" }, ["Training"]);
    await settle();
    await expect(performance(other).openPeriod(NOV)).rejects.toBeInstanceOf(PerformanceError);
    await expect(performance(other).setKpiStatus("punctuality", "Inactive")).rejects.toBeInstanceOf(PerformanceError);
    await expect(performance(other).flagDevelopmentNeed(1, 1, { gap: "g", action: "a" })).rejects.toBeInstanceOf(PerformanceError);
    expect(audits).toHaveLength(0);
    expect(await outbox()).toHaveLength(0);
    expect(await staffRows()).toHaveLength(0);
  });

  it("keeps a successful Staff action when audit-logs is down, then delivers the event once from the maintenance route", async () => {
    gatewayUp = false;
    const period = await performance().openPeriod(NOV);
    expect(period.id).toBeGreaterThan(0);
    expect((await db.query("SELECT 1 FROM public.hrms_evaluation_periods")).rows).toHaveLength(1);
    const queued = await outbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].payload).toMatchObject({ action: "performance_period.opened" });
    gatewayUp = true;
    await db.query("UPDATE public.hrms_audit_outbox SET next_attempt_at = '2000-01-01'");
    await retryJobPostingAnnouncements(db);
    await retryJobPostingAnnouncements(db);
    expect(audits).toHaveLength(1);
    expect(audits[0].idempotency_key).toBe(queued[0].payload.idempotency_key);
    expect(await outbox()).toHaveLength(0);
  });
});

describe("Staff notifications to the Performance Module holders", () => {
  it("tells them about a reopen, once per reopen, with only the reason already shown, linking to the Evaluation", async () => {
    const { period, id } = await evaluated();
    await settle();
    await performance().reopenEvaluation(id, period.id, "Correcting the import");
    const first = await staffRows();
    expect(first.map((row) => row.id)).toEqual([`performance.reopened:${(await db.query<{ id: number }>("SELECT id FROM public.hrms_evaluations")).rows[0].id}:1`]);
    expect(first[0].payload).toEqual({ type: "performance", title: "Evaluation reopened", body: `Ana Cruz's evaluation for November 2026 was reopened: Correcting the import`, link: `/performance/evaluation/${id}?period=${period.id}` });
    expect(bell).toHaveLength(0); // the Staff action does not flush it
    await performance().submitEvaluation(id, period.id);
    await performance().reopenEvaluation(id, period.id, "Wrong rating");
    expect((await staffRows()).map((row) => row.id).sort()).toEqual([first[0].id, first[0].id.replace(/:1$/, ":2")].sort());
    await deliverStaffNotifications(db);
    expect(bell).toHaveLength(2);
    expect([...bell[0].body.userIds].sort()).toEqual(["p-1", "p-2"]);
    expect(String(bell[0].body.link)).toBe(`https://hrms.test/performance/evaluation/${id}?period=${period.id}`);
  });

  it("tells them about a development need, by hand or from a suggestion, naming no gap or action", async () => {
    const { period, id } = await evaluated();
    ai = { client: async () => ({ ok: true, output: { suggestions: [{ kpiId: "evaluatorRating", gap: "AI-GAP-TEXT", trainingId: null, recommendation: "AI-RECOMMENDATION", reason: "Because." }] }, inputTokens: 1, outputTokens: 1 }), config: config() };
    const generated = await performance().generateSuggestions(id, period.id);
    if (!generated.ok) throw new Error("not generated");
    await settle();
    const need = await performance().flagDevelopmentNeed(id, period.id, { gap: "TYPED-GAP-TEXT", action: "TYPED-ACTION-TEXT" });
    const fromAi = await performance().flagSuggestion(generated.set.suggestions[0].id);
    const rows = await staffRows();
    expect(rows.map((row) => row.id).sort()).toEqual([`performance.need-flagged:${need.id}`, `performance.need-flagged:${fromAi.id}`].sort());
    for (const row of rows) {
      expect(row.payload).toMatchObject({ type: "performance", title: "Development need flagged", link: `/performance/evaluation/${id}?period=${period.id}` });
      expect(JSON.stringify(row.payload)).not.toMatch(/TYPED-|AI-GAP|AI-RECOMMENDATION/);
    }
    expect(bell).toHaveLength(0);
  });

  it("raises none for a rating, KPI or weight setup, a period, the calendar or attendance changes", async () => {
    const WEIGHTS = { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 };
    const { period, id } = await inReview();
    await settle();
    await performance().setKpiStatus("fullShift", "Inactive");
    await performance().saveWeightSet({ position: "Cook", weights: WEIGHTS });
    await performance().saveRating(id, period.id, { rating: 70 });
    const entry = await performance().addNonWorkingDate({ date: "2026-11-30", name: "Holiday", type: "Holiday" });
    await performance().updateNonWorkingDate(entry.id, { date: "2026-11-27", name: "Holiday", type: "Holiday" });
    await performance().removeNonWorkingDate(entry.id);
    await performance().excuseDays(id, period.id, ["2026-11-02"]);
    await performance().confirmNoAttendance(await employee("Cy Dee"), period.id, "No records");
    expect(audits.length).toBeGreaterThan(5);
    expect(await staffRows()).toHaveLength(0);
  });
});
