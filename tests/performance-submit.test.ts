import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeriodError, RatingError, RosterError, SubmitError, performanceFor, type RawAttendanceRow } from "@/lib/performance";
import type { Database } from "@/lib/database";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const clock = new Date("2026-12-01T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const GATEWAY = "https://gateway.test";
let gatewayStatus = 201;
let calls: { url: string; method: string; body: unknown }[] = [];
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock);
let count = 0;

async function employee(name: string, { start = "2026-01-05", days = [1, 2, 3, 4, 5] as number[] | null, status = "Active", position = "Branch Cashier" } = {}) {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, $2, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count, start])).rows[0].id;
  const id = (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, $6, 'Retail', 'Cainta branch', $7, 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', $8, 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, `${name.split(" ")[0].toLowerCase()}${count}@example.test`, position, start, status])).rows[0].id;
  if (days) await db.query(`UPDATE public.hrms_employees SET shift_start = '08:00', shift_end = '17:00', working_days = $2::smallint[] WHERE id = $1`, [id, days]);
  return id;
}
const NUMBER = (id: number) => `2026-${String(id).padStart(3, "0")}`;
const WEEKDAYS = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`).filter((d) => {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
});
const fullMonth = (id: number, timeIn = "08:00"): RawAttendanceRow[] => WEEKDAYS.map((date) => ({ employeeNumber: NUMBER(id), date, timeIn, timeOut: "17:00" }));
const attend = (id: number, timeIn?: string) => performance().importAttendance({ fileName: `emp-${id}.csv`, rows: fullMonth(id, timeIn) });
async function train(employeeId: number, results: ("Completed" | "Did not attend" | "Assigned")[]) {
  let day = 2;
  for (const status of results) {
    const t = (await db.query<{ id: number }>(`INSERT INTO public.hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name)
      VALUES ('Session', 'QA', $1, '09:00', '11:00', 'In person', 'Kitchen', 'Ada') RETURNING id`, [`2026-11-${String(day++).padStart(2, "0")}`])).rows[0].id;
    await db.query(`INSERT INTO public.hrms_training_assignments (training_id, employee_id, status) VALUES ($1, $2, $3)`, [t, employeeId, status]);
  }
}
const NOV = { type: "Month", year: 2026, month: 11 } as const;
const WEIGHTS = { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 };
/** An Employee ready to submit: a full on-time month, both Trainings completed and a rating of 80, so the score is 97. */
async function ready(name = "Ana Cruz") {
  const period = (await performance().listPeriods())[0] ?? (await performance().openPeriod(NOV));
  const id = await employee(name);
  await attend(id);
  await train(id, ["Completed", "Completed"]);
  await performance().saveRating(id, period.id, { rating: 80, comments: "Reliable and punctual." });
  return { period, id };
}
const submissions = async () => (await db.query<Record<string, unknown>>(`SELECT * FROM hrms_evaluation_submissions ORDER BY id`)).rows;
const outbox = async () => (await db.query<{ id: string; attempts: number; payload: Record<string, unknown> }>(`SELECT id, attempts, payload FROM hrms_audit_outbox ORDER BY id`)).rows;
const evaluationStatus = async () => (await db.query<{ status: string }>(`SELECT status FROM hrms_evaluations ORDER BY id`)).rows.map((r) => r.status);
const missingOf = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(SubmitError);
  return error as SubmitError;
};

beforeEach(async () => {
  count = 0;
  gatewayStatus = 201;
  calls = [];
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
  const portalOnly = portalFetch(portal);
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
    return url.startsWith(GATEWAY) ? new Response(JSON.stringify({ id: "x" }), { status: gatewayStatus }) : portalOnly(input as never, init);
  });
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("API_GATEWAY_URL", GATEWAY);
  vi.stubEnv("API_GATEWAY_KEY", "gateway-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("submitting an evaluation", () => {
  it("locks it as Evaluated when all four checks pass, and says what was saved", async () => {
    const { period, id } = await ready();
    const before = await performance().evaluationFor(id, period.id);
    expect(before.submit).toMatchObject({ unlocked: true });

    const submitted = await performance().submitEvaluation(id, period.id);

    expect(submitted).toMatchObject({ employeeId: id, periodId: period.id, status: "Evaluated", version: 1, score: 97, outcome: "scored", weightSetName: "Default set", submittedByName: "Ada Okafor" });
    expect(await evaluationStatus()).toEqual(["Evaluated"]);
    const roster = await performance().roster(period.id);
    expect(roster.rows[0]).toMatchObject({ status: "Evaluated", score: { outcome: "scored", value: 97 } });
    expect(roster.counts).toEqual({ All: 1, Draft: 0, "In review": 0, Evaluated: 1 });
    expect(roster.progress).toEqual({ evaluated: 1, total: 1, percent: 100 });
  });

  it("saves the KPI results, the weighted score, the weights used, the formulas, the weight set name and the rating", async () => {
    const { period, id } = await ready();
    await performance().submitEvaluation(id, period.id);

    const [saved] = await submissions();
    expect(saved).toMatchObject({ version: 1, outcome: "scored", rating: 80, comments: "Reliable and punctual.", weight_set_name: "Default set", weight_set_default: true, submitted_by_id: "u-ada", submitted_by_name: "Ada Okafor" });
    expect(Number(saved.score)).toBe(97);
    expect(saved.weights).toEqual(WEIGHTS);
    expect(saved.weights_used).toEqual(WEIGHTS);
    expect(saved.formulas).toMatchObject({ version: "2026-11", graceMinutes: 10, floorPercent: 60, kpis: { punctuality: expect.stringContaining("grace period"), fullShift: expect.stringContaining("before the shift end") } });
    expect(saved.figures).toMatchObject({ shift: { start: "08:00", end: "17:00" }, graceMinutes: 10, counts: { counted: 21, present: 21, late: 0, earlyOut: 0 } });
    const results = (await db.query<{ kpi_id: string; status: string; result: string; weight: number; weight_used: string; points: string }>(
      `SELECT kpi_id, status, result::text, weight, weight_used::text, points::text FROM hrms_evaluation_results ORDER BY kpi_id`)).rows;
    expect(results.map((r) => [r.kpi_id, r.status, Number(r.result), r.weight, Number(r.weight_used), Number(r.points)])).toEqual([
      ["attendanceRate", "scored", 100, 30, 30, 30], ["evaluatorRating", "scored", 80, 15, 15, 12], ["fullShift", "scored", 100, 15, 15, 15], ["punctuality", "scored", 100, 25, 25, 25], ["trainingCompletion", "scored", 100, 15, 15, 15],
    ]);
  });

  it("reads the same figures from the saved version as were shown before submitting", async () => {
    const { period, id } = await ready();
    const before = await performance().evaluationFor(id, period.id);
    await performance().submitEvaluation(id, period.id);
    const after = await performance().evaluationFor(id, period.id);

    expect(after.status).toBe("Evaluated");
    expect(after.score).toEqual(before.score);
    expect(after.kpis).toEqual(before.kpis);
    expect(after.weightsUsed).toEqual(before.weightsUsed);
    expect(after.scheduledDays).toEqual(before.scheduledDays);
    expect(after.counts).toEqual(before.counts);
    expect(after.submitted).toMatchObject({ version: 1, submittedByName: "Ada Okafor", formulas: { version: "2026-11" } });
    expect(after.submit).toMatchObject({ unlocked: false, reason: null });
    expect(after.rating).toMatchObject({ value: 80, comments: "Reliable and punctual." });
  });

  it("is refused for an evaluation that is already submitted", async () => {
    const { period, id } = await ready();
    await performance().submitEvaluation(id, period.id);

    expect((await missingOf(performance().submitEvaluation(id, period.id))).problem).toBe("already-submitted");
    expect(await submissions()).toHaveLength(1);
  });
});

describe("the four checks", () => {
  it("refuses Submit, naming each check that is not met, and saves nothing", async () => {
    const period = await performance().openPeriod(NOV);
    const noShift = await employee("Cy Dela Cruz", { days: null });

    const error = await missingOf(performance().submitEvaluation(noShift, period.id));
    expect(error.problem).toBe("checks-missing");
    expect(error.missing.map((c) => c.id)).toEqual(["attendance-imported", "shift-set", "issues-resolved", "rating-entered"]);
    expect(error.message).toBe("Submit refused: Attendance imported, Shift set, Attendance issues resolved, Rating entered not met.");
    expect(error.missing.every((c) => typeof c.reason === "string" && c.reason.length > 0)).toBe(true);
    expect(await submissions()).toEqual([]);
    expect(await outbox()).toEqual([]);
    expect(calls.filter((c) => c.url.startsWith(GATEWAY))).toEqual([]);
  });

  it("refuses when the rating is missing", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    await attend(id);

    expect((await missingOf(performance().submitEvaluation(id, period.id))).missing.map((c) => c.id)).toEqual(["rating-entered"]);
    expect(await evaluationStatus()).toEqual([]);
  });

  it("refuses when attendance is not imported", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    await performance().saveRating(id, period.id, { rating: 80 });

    expect((await missingOf(performance().submitEvaluation(id, period.id))).missing.map((c) => c.id)).toEqual(["attendance-imported", "issues-resolved"]);
    expect(await evaluationStatus()).toEqual(["In review"]);
  });

  it("refuses when the shift is not set", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz", { days: null });
    await performance().importAttendance({ fileName: "a.csv", rows: [{ employeeNumber: NUMBER(id), date: "2026-11-02", timeIn: "08:00", timeOut: "17:00" }] });
    await performance().saveRating(id, period.id, { rating: 80 });

    expect((await missingOf(performance().submitEvaluation(id, period.id))).missing.map((c) => c.id)).toEqual(["shift-set"]);
  });

  it("refuses while attendance issues are open, and allows it once they are resolved", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    await performance().importAttendance({ fileName: "a.csv", rows: [...fullMonth(id).slice(0, 20), { employeeNumber: NUMBER(id), date: "2026-11-30", timeIn: "08:00", timeOut: null }] });
    await performance().saveRating(id, period.id, { rating: 80 });

    const error = await missingOf(performance().submitEvaluation(id, period.id));
    expect(error.missing.map((c) => [c.id, c.reason])).toEqual([["issues-resolved", "1 attendance issue to resolve."]]);
    await performance().resolveDay(id, period.id, "2026-11-30", { type: "Absent", reason: "No call" });
    expect(await performance().submitEvaluation(id, period.id)).toMatchObject({ status: "Evaluated", outcome: "scored" });
  });

  it("is checked in the interface, so a request that bypasses the screen is refused the same way", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    await performance().saveRating(id, period.id, { rating: 80 });
    // Even a direct change of the status does not make an unready evaluation submittable through the interface.
    expect((await missingOf(performance().submitEvaluation(id, period.id))).problem).toBe("checks-missing");
    expect(await submissions()).toEqual([]);
  });
});

describe("what does not block Submit", () => {
  it("lets a Not-applicable Training through, and saves it as Not applicable with the weights rescaled", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Bea Reyes");
    await attend(id);
    await performance().saveRating(id, period.id, { rating: 70 });

    const submitted = await performance().submitEvaluation(id, period.id);
    // (100 x 30 + 100 x 25 + 100 x 15 + 70 x 15) / 85 = 94.7.
    expect(submitted).toMatchObject({ score: 94.7, outcome: "scored" });
    const detail = await performance().evaluationFor(id, period.id);
    expect(detail.kpis.find((k) => k.id === "trainingCompletion")).toMatchObject({ status: "not-applicable", reason: "no-training-due", result: null, points: null });
    expect(Object.values(detail.weightsUsed).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    const [saved] = await submissions();
    expect(saved.weights_used).not.toHaveProperty("trainingCompletion");
  });

  it("saves a deactivated KPI as left out", async () => {
    const { period, id } = await ready();
    await performance().setKpiStatus("fullShift", "Inactive");
    await performance().submitEvaluation(id, period.id);

    expect((await performance().evaluationFor(id, period.id)).kpis.find((k) => k.id === "fullShift")).toMatchObject({ status: "not-applicable", reason: "inactive" });
  });

  it("saves an Insufficient data result with no score, for an Employee with confirmed no attendance", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Dan Uy");
    await performance().confirmNoAttendance(id, period.id, "On unpaid leave all month");
    await performance().saveRating(id, period.id, { rating: 50 });

    const submitted = await performance().submitEvaluation(id, period.id);
    expect(submitted).toMatchObject({ outcome: "insufficient-data", score: null });
    expect((await submissions())[0]).toMatchObject({ outcome: "insufficient-data", score: null });
    expect((await performance().roster(period.id)).rows[0]).toMatchObject({ status: "Evaluated", score: { outcome: "insufficient-data" } });
  });
});

describe("a submitted evaluation does not change", () => {
  it("whatever is changed afterwards: attendance, weights, formulas' inputs, the calendar, Training results, the Employee's record", async () => {
    const { period, id } = await ready();
    await performance().submitEvaluation(id, period.id);
    const baseline = await performance().evaluationFor(id, period.id);
    const baselineRow = (await performance().roster(period.id)).rows[0];

    // New attendance, much worse, replacing the rows.
    await performance().importAttendance({ fileName: "late.csv", rows: fullMonth(id, "11:30") });
    // A weight set, a weight and a KPI changed.
    const [defaultSet] = await performance().listWeightSets();
    await performance().saveWeightSet({ id: defaultSet.id, weights: { attendanceRate: 10, punctuality: 10, fullShift: 10, trainingCompletion: 10, evaluatorRating: 60 } });
    await performance().saveWeightSet({ position: "Branch Cashier", weights: { attendanceRate: 50, punctuality: 20, fullShift: 10, trainingCompletion: 10, evaluatorRating: 10 } });
    await performance().setKpiStatus("punctuality", "Inactive");
    // The company calendar and an excused day.
    await performance().addNonWorkingDate({ date: "2026-11-30", name: "Bonifacio Day", type: "Holiday" });
    await performance().excuseDays(id, period.id, ["2026-11-03"]);
    // Training results edited afterwards.
    await db.query(`UPDATE hrms_training_assignments SET status = 'Did not attend' WHERE employee_id = $1`, [id]);
    // The Employee's shift changed.
    await db.query(`UPDATE hrms_employees SET shift_start = '06:00', shift_end = '14:00', working_days = ARRAY[1,2,3,4,5,6]::smallint[] WHERE id = $1`, [id]);

    const after = await performance().evaluationFor(id, period.id);
    expect(after.score).toEqual(baseline.score);
    expect(after.kpis).toEqual(baseline.kpis);
    expect(after.weightsUsed).toEqual(baseline.weightsUsed);
    expect(after.weights).toEqual(baseline.weights);
    expect(after.weightSet).toEqual(baseline.weightSet);
    expect(after.scheduledDays).toEqual(baseline.scheduledDays);
    expect(after.excusedDays).toEqual(baseline.excusedDays);
    expect(after.counts).toEqual(baseline.counts);
    expect(after.shift).toEqual(baseline.shift);
    expect(after.rating).toEqual(baseline.rating);
    expect((await performance().roster(period.id)).rows[0]).toEqual(baselineRow);
    expect(after.score).toEqual({ outcome: "scored", value: 97 });
  });

  it("refuses a rating change, and a second evaluation of the same kind is untouched", async () => {
    const { period, id } = await ready();
    await performance().submitEvaluation(id, period.id);

    await expect(performance().saveRating(id, period.id, { rating: 5 })).rejects.toBeInstanceOf(RatingError);
    expect((await performance().evaluationFor(id, period.id)).rating?.value).toBe(80);
  });

  it("is protected in the database: a saved version can be neither changed nor deleted", async () => {
    const { period, id } = await ready();
    await performance().submitEvaluation(id, period.id);

    await expect(db.query(`UPDATE hrms_evaluation_submissions SET score = 1`)).rejects.toThrow(/never changed or deleted/);
    await expect(db.query(`DELETE FROM hrms_evaluation_submissions`)).rejects.toThrow(/never changed or deleted/);
    await expect(db.query(`UPDATE hrms_evaluation_results SET result = 1`)).rejects.toThrow(/never changed or deleted/);
    await expect(db.query(`DELETE FROM hrms_evaluation_results`)).rejects.toThrow(/never changed or deleted/);
    expect(Number((await submissions())[0].score)).toBe(97);
  });
});

describe("the audit event", () => {
  it("is queued with the submit and delivered through the audit gateway with the Staff member, the Employee and the period", async () => {
    const { period, id } = await ready();
    await performance().submitEvaluation(id, period.id);

    const sent = calls.filter((c) => c.url.startsWith(GATEWAY));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ url: `${GATEWAY}/audit/events`, method: "POST" });
    expect(sent[0].body).toMatchObject({
      source: "HRMS", module: "Performance", action: "record.updated", outcome: "success",
      actor: { type: "user", id: "u-ada", display_name: "Ada Okafor" },
      target: { type: "evaluation", id: `${id}:${period.id}`, display_name: "Ana Cruz · November 2026" },
      description: "Ada Okafor submitted the evaluation of Ana Cruz for November 2026.",
      metadata: { operation: "evaluation.submitted", employee_id: id, employee_number: NUMBER(id), period_id: period.id, version: 1 },
    });
    expect((sent[0].body as { idempotency_key: string }).idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    expect(await outbox()).toEqual([]);
    expect((await db.query<{ actor_name: string; detail: unknown }>(`SELECT actor_name, detail FROM hrms_performance_audit WHERE action = 'evaluation-submitted'`)).rows)
      .toEqual([{ actor_name: "Ada Okafor", detail: { employeeId: id, periodId: period.id, version: 1, outcome: "scored" } }]);
  });

  it("stays queued for a retry when the gateway fails, and the submit still stands", async () => {
    gatewayStatus = 500;
    const { period, id } = await ready();
    expect(await performance().submitEvaluation(id, period.id)).toMatchObject({ status: "Evaluated" });

    const queued = await outbox();
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ attempts: 1, payload: { action: "record.updated", metadata: { operation: "evaluation.submitted", version: 1 } } });
    expect(await evaluationStatus()).toEqual(["Evaluated"]);
  });

  it("stays queued when the gateway is not configured", async () => {
    vi.stubEnv("API_GATEWAY_URL", "");
    const { period, id } = await ready();
    await performance().submitEvaluation(id, period.id);

    expect(await outbox()).toHaveLength(1);
    expect(calls.filter((c) => c.url.startsWith(GATEWAY))).toEqual([]);
  });

  it("is written for nothing that was refused", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    await missingOf(performance().submitEvaluation(id, period.id));

    expect(await outbox()).toEqual([]);
    expect((await db.query(`SELECT 1 FROM hrms_performance_audit WHERE action = 'evaluation-submitted'`)).rows).toEqual([]);
  });
});

describe("no email or notification", () => {
  it("is sent: nothing leaves but the audit event, and no notification row is written", async () => {
    const { period, id } = await ready();
    const mailTables = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name ~ 'notif|notice|email|mail'`)).rows.map((r) => r.table_name);
    expect(mailTables.length).toBeGreaterThan(0);
    const countRows = async () => Promise.all(mailTables.map(async (t) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n));
    const before = await countRows();
    calls = [];

    await performance().submitEvaluation(id, period.id);

    expect(await countRows()).toEqual(before);
    const hosts = [...new Set(calls.map((c) => new URL(c.url).origin))];
    expect(hosts.sort()).toEqual([FAKE_PORTAL_URL, GATEWAY].sort());
    expect(calls.filter((c) => !c.url.startsWith(FAKE_PORTAL_URL) && !c.url.endsWith("/audit/events"))).toEqual([]);
  });
});

describe("two submits at the same moment", () => {
  it("cannot both succeed: one saves, the other is refused", async () => {
    const { period, id } = await ready();
    const results = await Promise.allSettled([performance().submitEvaluation(id, period.id), performance().submitEvaluation(id, period.id)]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(SubmitError);
    expect((refused.reason as SubmitError).problem).toBe("already-submitted");
    expect(await submissions()).toHaveLength(1);
    expect(await outbox()).toEqual([]);
    expect(calls.filter((c) => c.url.startsWith(GATEWAY))).toHaveLength(1);
  });

  it("saves nothing when the rating was changed between reading it and locking, and says so", async () => {
    const { period, id } = await ready();
    const racing: Database = { query: async <T,>(sql: string, values?: unknown[]) => {
      if (/WITH locked AS/.test(sql)) await db.query(`UPDATE hrms_evaluations SET rating = 5, rated_at = clock_timestamp()`);
      return { rows: (await db.query<T>(sql, values)).rows };
    } };

    const error = await missingOf(performanceFor(handle, racing, () => clock).submitEvaluation(id, period.id));
    expect(error.problem).toBe("changed");
    expect(await submissions()).toEqual([]);
    expect(await evaluationStatus()).toEqual(["In review"]);
  });
});

describe("who and what", () => {
  it("refuses an Employee who is not on the roster, an unknown Employee and an unknown period", async () => {
    const period = await performance().openPeriod(NOV);
    const onboarding = await employee("Cy Dela Cruz", { status: "Onboarding" });

    await expect(performance().submitEvaluation(onboarding, period.id)).rejects.toBeInstanceOf(RosterError);
    for (const id of [999, 0, -1]) await expect(performance().submitEvaluation(id, period.id)).rejects.toBeInstanceOf(PeriodError);
    await expect(performance().submitEvaluation(onboarding, 999)).rejects.toBeInstanceOf(PeriodError);
  });

  it("is the Module grant alone, with each Staff member's own name recorded", async () => {
    const { period, id } = await ready();
    const denied = performance(portal.signIn({ ...staff, role: "Super Admin" }, ["Training", "Employee Information"]));

    await expect(denied.submitEvaluation(id, period.id)).rejects.toMatchObject({ reason: "denied" });
    await expect(performanceFor(undefined, db).submitEvaluation(id, period.id)).rejects.toMatchObject({ reason: "invalid" });
    expect(await submissions()).toEqual([]);
    const bea = portal.signIn({ ...staff, id: "u-bea", name: "Bea Reyes", username: "bea", role: "Cashier" }, ["Performance"]);
    expect(await performance(bea).submitEvaluation(id, period.id)).toMatchObject({ submittedByName: "Bea Reyes" });
    expect((await submissions())[0]).toMatchObject({ submitted_by_id: "u-bea", submitted_by_name: "Bea Reyes" });
  });
});
