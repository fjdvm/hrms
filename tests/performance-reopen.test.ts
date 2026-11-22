import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeriodError, REASON_MAX_LENGTH, ReopenError, RosterError, SubmitError, performanceFor, type RawAttendanceRow } from "@/lib/performance";
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
const reopenProblem = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(ReopenError);
  return (error as ReopenError).problem;
};
const reopens = async () => (await db.query<Record<string, unknown>>(`SELECT * FROM hrms_evaluation_reopens ORDER BY id`)).rows;
const BIDI = String.fromCharCode(0x202e);
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

/** An Employee submitted at 97 (full on-time month, both Trainings, rating 80), ready to be reopened. */
async function submitted(name = "Ana Cruz") {
  const { period, id } = await ready(name);
  await performance().submitEvaluation(id, period.id);
  return { period, id };
}
/** Weights changed for everyone after the first submission, so a recompute that used them would give a different score. */
async function changeWeights() {
  const [defaultSet] = await performance().listWeightSets();
  await performance().saveWeightSet({ id: defaultSet.id, weights: { attendanceRate: 10, punctuality: 10, fullShift: 10, trainingCompletion: 10, evaluatorRating: 60 } });
  await performance().saveWeightSet({ position: "Branch Cashier", weights: { attendanceRate: 50, punctuality: 20, fullShift: 10, trainingCompletion: 10, evaluatorRating: 10 } });
  await performance().setKpiStatus("fullShift", "Inactive");
}

describe("reopening", () => {
  it("returns an Evaluated evaluation to In review with the reason, who and when", async () => {
    const { period, id } = await submitted();
    const reopened = await performance().reopenEvaluation(id, period.id, "  A bad   import was corrected. ");

    expect(reopened).toMatchObject({ employeeId: id, periodId: period.id, status: "In review", version: 1, reason: "A bad import was corrected.", reopenedByName: "Ada Okafor" });
    expect(reopened.reopenedAt).toMatch(/^\d{4}-\d{2}-\d{2}/);
    expect(await evaluationStatus()).toEqual(["In review"]);
    expect(await reopens()).toEqual([expect.objectContaining({ version: 1, reason: "A bad import was corrected.", reopened_by_id: "u-ada", reopened_by_name: "Ada Okafor" })]);
    const roster = await performance().roster(period.id);
    expect(roster.rows[0].status).toBe("In review");
    expect(roster.counts).toEqual({ All: 1, Draft: 0, "In review": 1, Evaluated: 0 });
    expect(roster.progress).toEqual({ evaluated: 0, total: 1, percent: 0 });
    const detail = await performance().evaluationFor(id, period.id);
    expect(detail).toMatchObject({ status: "In review", submitted: null, rulesFrozen: true });
    expect(detail.history).toEqual([expect.objectContaining({ version: 1, outcome: "scored", score: 97, rating: 80, weightSetName: "Default set", submittedByName: "Ada Okafor",
      reopened: { reason: "A bad import was corrected.", reopenedByName: "Ada Okafor", reopenedAt: reopened.reopenedAt } })]);
  });

  it("only reopens an Evaluated evaluation: a Draft, an In review one and an already reopened one are refused", async () => {
    const period = await performance().openPeriod(NOV);
    const draft = await employee("Cy Dela Cruz");
    const inReview = await employee("Dan Uy");
    await performance().saveRating(inReview, period.id, { rating: 70 });
    const { id } = await submitted("Ana Cruz");

    expect(await reopenProblem(performance().reopenEvaluation(draft, period.id, "Because"))).toBe("not-evaluated");
    expect(await reopenProblem(performance().reopenEvaluation(inReview, period.id, "Because"))).toBe("not-evaluated");
    await performance().reopenEvaluation(id, period.id, "First reopen");
    expect(await reopenProblem(performance().reopenEvaluation(id, period.id, "Second reopen"))).toBe("not-evaluated");
    expect(await reopens()).toHaveLength(1);
    expect(await evaluationStatus()).toEqual(expect.arrayContaining(["In review"]));
  });

  it("requires a reason, checked in the interface, and refuses one with characters that do not belong or that is too long", async () => {
    const { period, id } = await submitted();
    for (const reason of [undefined, null, "", "   ", "\n\t "]) expect(await reopenProblem(performance().reopenEvaluation(id, period.id, reason as never))).toBe("reason-required");
    for (const reason of ["bad\u0000", "bad" + BIDI, "bad\u0007", 42, {}, ["x"], true]) expect(await reopenProblem(performance().reopenEvaluation(id, period.id, reason as never))).toBe("reason-invalid");
    expect(await reopenProblem(performance().reopenEvaluation(id, period.id, "x".repeat(REASON_MAX_LENGTH + 1)))).toBe("reason-too-long");
    expect(await evaluationStatus()).toEqual(["Evaluated"]);
    expect(await reopens()).toEqual([]);
    expect(await performance().reopenEvaluation(id, period.id, "x".repeat(REASON_MAX_LENGTH))).toMatchObject({ status: "In review" });
  });

  it("checks the reason before anything else, so a request that bypasses the screen is refused the same way", async () => {
    const period = await performance().openPeriod(NOV);
    expect(await reopenProblem(performance().reopenEvaluation(999, period.id, ""))).toBe("reason-required");
    expect(await reopenProblem(performance().reopenEvaluation(999, 999, undefined as never))).toBe("reason-required");
  });

  it("keeps the previously submitted version exactly as it was: score, KPI results, weights, formulas, rating, who and when", async () => {
    const { period, id } = await submitted();
    const versionBefore = await submissions();
    const resultsBefore = (await db.query<Record<string, unknown>>(`SELECT * FROM hrms_evaluation_results ORDER BY kpi_id`)).rows;
    await performance().reopenEvaluation(id, period.id, "Correcting the import");

    expect(await submissions()).toEqual(versionBefore);
    expect((await db.query<Record<string, unknown>>(`SELECT * FROM hrms_evaluation_results ORDER BY kpi_id`)).rows).toEqual(resultsBefore);
    expect(Number(versionBefore[0].score)).toBe(97);
    expect(versionBefore[0]).toMatchObject({ rating: 80, weight_set_name: "Default set", submitted_by_name: "Ada Okafor" });
  });

  it("is protected in the database: a reopen record can be neither changed nor deleted, and a version is reopened once", async () => {
    const { period, id } = await submitted();
    await performance().reopenEvaluation(id, period.id, "Correcting the import");

    await expect(db.query(`UPDATE hrms_evaluation_reopens SET reason = 'x'`)).rejects.toThrow(/never changed or deleted/);
    await expect(db.query(`DELETE FROM hrms_evaluation_reopens`)).rejects.toThrow(/never changed or deleted/);
    await expect(db.query(`INSERT INTO hrms_evaluation_reopens (evaluation_id, version, reason, reopened_by_id, reopened_by_name) VALUES (1, 1, 'again', 'a', 'A')`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO hrms_evaluation_reopens (evaluation_id, version, reason, reopened_by_id, reopened_by_name) VALUES (1, 7, 'no such version', 'a', 'A')`)).rejects.toThrow();
  });
});

describe("after a reopen", () => {
  it("recomputes from the corrected attendance under the same weights, and a weight change made in between does not alter it", async () => {
    const { period, id } = await submitted();
    await changeWeights();
    await performance().reopenEvaluation(id, period.id, "The first import was the wrong month's file");
    // A corrected import: every day late, so Punctuality drops to 0.
    await attend(id, "08:30");

    const detail = await performance().evaluationFor(id, period.id);
    // The weights saved at the first submission (30, 25, 15, 15, 15): 100 x 30 + 0 x 25 + 100 x 15 + 100 x 15 + 80 x 15, over 100 = 72.
    expect(detail.score).toEqual({ outcome: "scored", value: 72 });
    expect(detail.kpis.find((k) => k.id === "punctuality")).toMatchObject({ status: "scored", result: 0, weight: 25 });
    expect(detail.weights).toEqual(WEIGHTS);
    expect(detail.weightSet).toMatchObject({ name: "Default set", isDefault: true });
    expect(detail.kpis.find((k) => k.id === "fullShift")).toMatchObject({ status: "scored", weight: 15 });
    expect(detail.rulesFrozen).toBe(true);
    expect((await performance().roster(period.id)).rows[0].score).toEqual({ outcome: "scored", value: 72 });
    // Had today's weights applied, the Branch Cashier set (50, 20, 10, 10, 10, Full shift inactive) would have given a different score.
    expect(detail.score).not.toEqual({ outcome: "scored", value: 78 });
  });

  it("uses the current Training results and the current rating", async () => {
    const { period, id } = await submitted();
    await performance().reopenEvaluation(id, period.id, "A Training result was entered wrongly");
    await db.query(`UPDATE hrms_training_assignments SET status = 'Did not attend' WHERE employee_id = $1 AND training_id = (SELECT min(training_id) FROM hrms_training_assignments WHERE employee_id = $1)`, [id]);
    await performance().saveRating(id, period.id, { rating: 100 });

    const detail = await performance().evaluationFor(id, period.id);
    expect(detail.kpis.find((k) => k.id === "trainingCompletion")).toMatchObject({ result: 50 });
    // 30 + 25 + 15 + 50 x 15 / 100 + 100 x 15 / 100 = 92.5.
    expect(detail.score).toEqual({ outcome: "scored", value: 92.5 });
    expect(detail.rating).toMatchObject({ value: 100 });
  });

  it("keeps the deactivated KPIs of the first submission, and a KPI deactivated since has no effect", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    await attend(id);
    await train(id, ["Completed", "Completed"]);
    await performance().setKpiStatus("fullShift", "Inactive");
    await performance().saveRating(id, period.id, { rating: 80 });
    await performance().submitEvaluation(id, period.id);
    await performance().setKpiStatus("fullShift", "Active");
    await performance().setKpiStatus("punctuality", "Inactive");
    await performance().reopenEvaluation(id, period.id, "Checking the figures");

    const detail = await performance().evaluationFor(id, period.id);
    expect(detail.kpis.find((k) => k.id === "fullShift")).toMatchObject({ status: "not-applicable", reason: "inactive" });
    expect(detail.kpis.find((k) => k.id === "punctuality")).toMatchObject({ status: "scored" });
  });

  it("keeps the floor saved at the first submission", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    await attend(id);
    await performance().saveRating(id, period.id, { rating: 80 });
    // A first submission saved with a stricter floor (90%) than today's 60%; 85% of the weight remains with no Training due.
    const evaluationId = (await db.query<{ id: number }>(`SELECT id FROM hrms_evaluations WHERE employee_id = $1`, [id])).rows[0].id;
    await db.query(`INSERT INTO hrms_evaluation_submissions (evaluation_id, version, outcome, score, rating, comments, weight_set_id, weight_set_name, weight_set_default, weights, weights_used, formulas, figures, submitted_by_id, submitted_by_name)
      VALUES ($1, 1, 'scored', 90.0, 80, '', 1, 'Default set', true, $2::jsonb, $2::jsonb, $3::jsonb, '{}'::jsonb, 'u-x', 'X')`,
    [evaluationId, JSON.stringify(WEIGHTS), JSON.stringify({ version: "2026-11", kpis: {}, graceMinutes: 10, floorPercent: 90 })]);

    expect((await performance().evaluationFor(id, period.id)).score).toEqual({ outcome: "insufficient-data" });
  });

  it("submits again through the same four checks and saves a new version, never overwriting the first", async () => {
    const { period, id } = await submitted();
    await changeWeights();
    await performance().reopenEvaluation(id, period.id, "Correcting the import");
    await performance().importAttendance({ fileName: "partial.csv", rows: [...fullMonth(id, "08:30").slice(0, 20), { employeeNumber: NUMBER(id), date: "2026-11-30", timeIn: "08:30", timeOut: null }] });

    const refused = await missingOf(performance().submitEvaluation(id, period.id));
    expect(refused.missing.map((c) => c.id)).toEqual(["issues-resolved"]);
    await performance().resolveDay(id, period.id, "2026-11-30", { type: "Excused", reason: "Approved leave" });
    const again = await performance().submitEvaluation(id, period.id);

    expect(again).toMatchObject({ version: 2, status: "Evaluated" });
    expect(again.score).not.toBe(97);
    const saved = await submissions();
    expect(saved).toHaveLength(2);
    expect(Number(saved[0].score)).toBe(97);
    expect(saved[1]).toMatchObject({ version: 2, rating: 80, weight_set_name: "Default set", submitted_by_name: "Ada Okafor" });
    // The new version was saved with the first submission's weights and formulas, not today's.
    expect(saved[1].weights).toEqual(WEIGHTS);
    expect(saved[1].formulas).toEqual(saved[0].formulas);
    const detail = await performance().evaluationFor(id, period.id);
    expect(detail).toMatchObject({ status: "Evaluated", submitted: { version: 2 }, score: { outcome: "scored", value: Number(saved[1].score) } });
    expect(detail.history.map((h) => [h.version, h.score, h.reopened?.reason ?? null])).toEqual([[1, 97, "Correcting the import"], [2, Number(saved[1].score), null]]);
    expect((await db.query(`SELECT 1 FROM hrms_evaluation_results`)).rows).toHaveLength(10);
  });

  it("can be reopened again after the second submit, one reopen per version", async () => {
    const { period, id } = await submitted();
    await performance().reopenEvaluation(id, period.id, "First correction");
    await performance().submitEvaluation(id, period.id);
    await performance().reopenEvaluation(id, period.id, "Second correction");

    expect((await reopens()).map((r) => [r.version, r.reason])).toEqual([[1, "First correction"], [2, "Second correction"]]);
    expect((await performance().evaluationFor(id, period.id)).history).toHaveLength(2);
  });
});

describe("the audit event", () => {
  it("is queued with the reopen and delivered through the audit gateway with who, when and why", async () => {
    const { period, id } = await submitted();
    calls = [];
    await performance().reopenEvaluation(id, period.id, "The first import was the wrong file");

    const sent = calls.filter((c) => c.url.startsWith(GATEWAY));
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatchObject({
      source: "HRMS", module: "Performance", action: "record.updated", outcome: "success",
      actor: { type: "user", id: "u-ada", display_name: "Ada Okafor" },
      target: { type: "evaluation", id: `${id}:${period.id}`, display_name: "Ana Cruz · November 2026" },
      description: "Ada Okafor reopened the evaluation of Ana Cruz for November 2026: The first import was the wrong file",
      metadata: { operation: "evaluation.reopened", employee_id: id, period_id: period.id, version: 1, reason: "The first import was the wrong file" },
    });
    expect(await outbox()).toEqual([]);
    expect((await db.query<{ actor_name: string; detail: unknown }>(`SELECT actor_name, detail FROM hrms_performance_audit WHERE action = 'evaluation-reopened'`)).rows)
      .toEqual([{ actor_name: "Ada Okafor", detail: { employeeId: id, periodId: period.id, version: 1, reason: "The first import was the wrong file" } }]);
  });

  it("stays queued for a retry when the gateway fails, and the reopen still stands", async () => {
    const { period, id } = await submitted();
    gatewayStatus = 500;
    await performance().reopenEvaluation(id, period.id, "Correcting the import");

    expect(await outbox()).toHaveLength(1);
    expect(await evaluationStatus()).toEqual(["In review"]);
  });

  it("is written for nothing that was refused", async () => {
    const { period, id } = await submitted();
    calls = [];
    await reopenProblem(performance().reopenEvaluation(id, period.id, ""));

    expect(await outbox()).toEqual([]);
    expect(calls.filter((c) => c.url.startsWith(GATEWAY))).toEqual([]);
    expect((await db.query(`SELECT 1 FROM hrms_performance_audit WHERE action = 'evaluation-reopened'`)).rows).toEqual([]);
  });

  it("sends no email or notification", async () => {
    const { period, id } = await submitted();
    const mailTables = (await db.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name ~ 'notif|notice|email|mail' AND table_name <> 'hrms_staff_notifications'`)).rows.map((r) => r.table_name); // a reopen tells the Performance holders in the bell, by design (#481); nothing else leaves
    const countRows = async () => Promise.all(mailTables.map(async (t) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t}`)).rows[0].n));
    const before = await countRows();
    calls = [];
    await performance().reopenEvaluation(id, period.id, "Correcting the import");

    expect(await countRows()).toEqual(before);
    expect(calls.filter((c) => !c.url.startsWith(FAKE_PORTAL_URL) && !c.url.endsWith("/audit/events"))).toEqual([]);
  });
});

describe("two reopens at the same moment", () => {
  it("cannot both succeed: one reopens, the other is refused", async () => {
    const { period, id } = await submitted();
    calls = [];
    const results = await Promise.allSettled([performance().reopenEvaluation(id, period.id, "First"), performance().reopenEvaluation(id, period.id, "Second")]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(ReopenError);
    expect((refused.reason as ReopenError).problem).toBe("not-evaluated");
    expect(await reopens()).toHaveLength(1);
    expect(calls.filter((c) => c.url.startsWith(GATEWAY))).toHaveLength(1);
    expect(await evaluationStatus()).toEqual(["In review"]);
  });
});

describe("who can reopen", () => {
  it("refuses an Employee who is not on the roster, and an unknown Employee or period", async () => {
    const period = await performance().openPeriod(NOV);
    const onboarding = await employee("Cy Dela Cruz", { status: "Onboarding" });

    await expect(performance().reopenEvaluation(onboarding, period.id, "Reason")).rejects.toBeInstanceOf(RosterError);
    for (const id of [999, 0, -1]) await expect(performance().reopenEvaluation(id, period.id, "Reason")).rejects.toBeInstanceOf(PeriodError);
    await expect(performance().reopenEvaluation(onboarding, 999, "Reason")).rejects.toBeInstanceOf(PeriodError);
  });

  it("is the Module grant alone, with each Staff member's own name recorded", async () => {
    const { period, id } = await submitted();
    const denied = performance(portal.signIn({ ...staff, role: "Super Admin" }, ["Training", "Employee Information"]));

    await expect(denied.reopenEvaluation(id, period.id, "Reason")).rejects.toMatchObject({ reason: "denied" });
    await expect(performanceFor(undefined, db).reopenEvaluation(id, period.id, "Reason")).rejects.toMatchObject({ reason: "invalid" });
    expect(await reopens()).toEqual([]);
    expect(await evaluationStatus()).toEqual(["Evaluated"]);
    const bea = portal.signIn({ ...staff, id: "u-bea", name: "Bea Reyes", username: "bea", role: "Cashier" }, ["Performance"]);
    expect(await performance(bea).reopenEvaluation(id, period.id, "Reason")).toMatchObject({ reopenedByName: "Bea Reyes" });
    expect((await reopens())[0]).toMatchObject({ reopened_by_id: "u-bea", reopened_by_name: "Bea Reyes" });
  });
});
