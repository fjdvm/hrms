import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ACTION_MAX_LENGTH, GAP_MAX_LENGTH, NeedError, PerformanceError, PeriodError, RosterError, performanceFor, type RawAttendanceRow } from "@/lib/performance";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const clock = new Date("2026-12-01T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock);
let count = 0;

async function employee(name: string, { start = "2026-01-05", position = "Branch Cashier" } = {}) {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, $2, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count, start])).rows[0].id;
  const id = (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, $6, 'Retail', 'Cainta branch', $7, 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Active', 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, `${name.split(" ")[0].toLowerCase()}${count}@example.test`, position, start])).rows[0].id;
  await db.query(`UPDATE public.hrms_employees SET shift_start = '08:00', shift_end = '17:00', working_days = $2::smallint[] WHERE id = $1`, [id, [1, 2, 3, 4, 5]]);
  return id;
}
const NUMBER = (id: number) => `2026-${String(id).padStart(3, "0")}`;
const WEEKDAYS = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`).filter((d) => {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
});
const fullMonth = (id: number): RawAttendanceRow[] => WEEKDAYS.map((date) => ({ employeeNumber: NUMBER(id), date, timeIn: "08:00", timeOut: "17:00" }));
async function train(employeeId: number) {
  let day = 2;
  for (const status of ["Completed", "Completed"]) {
    const t = (await db.query<{ id: number }>(`INSERT INTO public.hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name)
      VALUES ('Session', 'QA', $1, '09:00', '11:00', 'In person', 'Kitchen', 'Ada') RETURNING id`, [`2026-11-${String(day++).padStart(2, "0")}`])).rows[0].id;
    await db.query(`INSERT INTO public.hrms_training_assignments (training_id, employee_id, status) VALUES ($1, $2, $3)`, [t, employeeId, status]);
  }
}
const NOV = { type: "Month", year: 2026, month: 11 } as const;
/** A scheduled Training to recommend. */
const scheduledTraining = async (title = "POS and cash handling") =>
  (await db.query<{ id: number }>(`INSERT INTO public.hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name)
    VALUES ($1, 'QA', '2027-01-15', '09:00', '11:00', 'In person', 'Kitchen', 'Ada') RETURNING id`, [title])).rows[0].id;

/** An Employee with a saved rating, so the Evaluation is In review. */
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
const needProblem = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(NeedError);
  return (error as NeedError).problem;
};
const stored = async () => (await db.query<Record<string, unknown>>(`SELECT * FROM public.hrms_development_needs ORDER BY id`)).rows;
const audits = async () => (await db.query<{ actor_id: string; actor_name: string; action: string; subject: string; subject_id: string; detail: Record<string, unknown> }>(
  `SELECT actor_id, actor_name, action, subject, subject_id, detail FROM public.hrms_performance_audit WHERE action = 'development-need-flagged' ORDER BY id`)).rows;
const GAP = "Cash counting at closing is below target.";
const ACTION = "Training: POS and cash handling";
const BIDI = String.fromCharCode(0x202e);

beforeEach(async () => {
  count = 0;
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  portal = new FakePortal();
  handle = portal.signIn(staff, ["Performance"]);
  const portalOnly = portalFetch(portal);
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => String(input).startsWith("https://gateway.test") ? new Response(JSON.stringify({ id: "x" }), { status: 201 }) : portalOnly(input as never, init));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "gateway-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("access", () => {
  it("is the Performance Module grant alone: a Performance-only holder can flag and list, and nobody else can", async () => {
    const { period, id } = await inReview();
    const other = portal.signIn({ ...staff, id: "u-bo", username: "bo", name: "Bo Reyes" }, ["Applications", "Training", "Job Postings"]);
    const flagged = await performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION });
    expect(flagged.flaggedById).toBe("u-ada");
    for (const attempt of [() => performance(other).flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION }), () => performance(other).listDevelopmentNeeds(id, period.id)]) {
      const error = await attempt().then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(PerformanceError);
      expect((error as PerformanceError).reason).toBe("denied");
    }
    expect(await stored()).toHaveLength(1);
  });
  it("refuses a lapsed session and says so when the Portal cannot answer, before anything is written", async () => {
    const { period, id } = await inReview();
    for (const board of [performance("nope"), performanceFor(undefined, db, () => clock)]) {
      const error = await board.flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION }).then(() => undefined, (e: unknown) => e);
      expect((error as PerformanceError).reason).toBe("invalid");
    }
    portal.unavailable = true;
    const down = await performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION }).then(() => undefined, (e: unknown) => e);
    expect((down as PerformanceError).reason).toBe("unavailable");
    expect(await stored()).toEqual([]);
  });
});

describe("flagging a need", () => {
  it("records the Gap, the recommended action, who flagged it and when, as a manual need", async () => {
    const { period, id } = await inReview();
    const need = await performance().flagDevelopmentNeed(id, period.id, { gap: `  ${GAP}  `, action: ACTION });
    expect(need).toMatchObject({ employeeId: id, periodId: period.id, gap: GAP, action: ACTION, trainingId: null, source: "manual", suggestionId: null, flaggedById: "u-ada", flaggedByName: "Ada Okafor" });
    expect(need.flaggedAt).toBeTruthy();
    expect(await stored()).toHaveLength(1);
  });
  it("works on an Evaluation that is In review and on one that is Evaluated", async () => {
    const review = await inReview("Ana Cruz");
    const done = await evaluated("Ben Dela Cruz");
    expect((await performance().evaluationFor(review.id, review.period.id)).status).toBe("In review");
    expect((await performance().evaluationFor(done.id, done.period.id)).status).toBe("Evaluated");
    await performance().flagDevelopmentNeed(review.id, review.period.id, { gap: GAP, action: ACTION });
    await performance().flagDevelopmentNeed(done.id, done.period.id, { gap: GAP, action: ACTION });
    expect(await stored()).toHaveLength(2);
  });
  it("refuses an Evaluation that is still a Draft, with no rating saved, and writes nothing", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Cara Lim");
    expect((await performance().evaluationFor(id, period.id)).status).toBe("Draft");
    expect(await needProblem(performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION }))).toBe("evaluation-not-started");
    expect(await stored()).toEqual([]);
    expect(await audits()).toEqual([]);
  });
  it("leaves the score, the rating and the status unchanged, and sends no email", async () => {
    for (const make of [inReview, evaluated]) {
      const { period, id } = await make(`Emp ${count + 1}`);
      const before = await performance().evaluationFor(id, period.id);
      const emails = (await db.query(`SELECT 1 FROM public.hrms_audit_outbox`)).rows.length;
      await performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION });
      const after = await performance().evaluationFor(id, period.id);
      expect(after.score).toEqual(before.score);
      expect(after.rating).toEqual(before.rating);
      expect(after.status).toBe(before.status);
      expect(after.kpis).toEqual(before.kpis);
      expect((await db.query(`SELECT 1 FROM public.hrms_audit_outbox`)).rows.length).toBe(emails);
    }
  });
  it("refuses an unknown Employee, an unknown period, and an Employee who is not in the period", async () => {
    const { period, id } = await inReview();
    expect(await performance().flagDevelopmentNeed(999, period.id, { gap: GAP, action: ACTION }).then(() => "ok", (e) => (e as PeriodError).problem)).toBe("unknown-employee");
    expect(await performance().flagDevelopmentNeed(id, 999, { gap: GAP, action: ACTION }).then(() => "ok", (e) => (e as PeriodError).problem)).toBe("unknown-period");
    const late = await employee("Dan Uy", { start: "2027-03-01" });
    expect(await performance().flagDevelopmentNeed(late, period.id, { gap: GAP, action: ACTION }).then(() => "ok", (e) => (e as RosterError).problem)).toBe("not-in-roster");
    expect(await stored()).toEqual([]);
  });
});

describe("the Gap and the Recommended action", () => {
  it.each([["gap"], ["action"]] as const)("%s is required: missing, null, empty and only spaces are refused", async (field) => {
    const { period, id } = await inReview();
    const valid = { gap: GAP, action: ACTION };
    for (const value of [undefined, null, "", "   ", " \n\t \n "]) expect(await needProblem(performance().flagDevelopmentNeed(id, period.id, { ...valid, [field]: value }))).toBe(`${field}-required`);
    expect(await stored()).toEqual([]);
  });
  it.each([["gap"], ["action"]] as const)("%s is refused, not quietly changed, with control or direction-override characters or a non-string", async (field) => {
    const { period, id } = await inReview();
    const valid = { gap: GAP, action: ACTION };
    for (const value of ["a\u0000b", `a${BIDI}b`, "a\u0007b", 12, ["x"], {}]) expect(await needProblem(performance().flagDevelopmentNeed(id, period.id, { ...valid, [field]: value }))).toBe(`${field}-invalid`);
    expect(await stored()).toEqual([]);
  });
  it("limits the length after cleaning: exactly the limit is fine and one more is refused", async () => {
    const { period, id } = await inReview();
    await performance().flagDevelopmentNeed(id, period.id, { gap: "g".repeat(GAP_MAX_LENGTH), action: "a".repeat(ACTION_MAX_LENGTH) });
    expect(await needProblem(performance().flagDevelopmentNeed(id, period.id, { gap: "g".repeat(GAP_MAX_LENGTH + 1), action: ACTION }))).toBe("gap-too-long");
    expect(await needProblem(performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: "a".repeat(ACTION_MAX_LENGTH + 1) }))).toBe("action-too-long");
    // Spaces and blank lines do not use up the limit.
    await performance().flagDevelopmentNeed(id, period.id, { gap: `${"g ".repeat(50)}${"\n".repeat(20)}`, action: ACTION });
    expect(await stored()).toHaveLength(2);
  });
  it("cleans the text: line endings, repeated spaces and blank lines", async () => {
    const { period, id } = await inReview();
    const need = await performance().flagDevelopmentNeed(id, period.id, { gap: "Late   arrivals\r\n\r\n\r\n\r\nat opening", action: ACTION });
    expect(need.gap).toBe("Late arrivals\n\nat opening");
  });
});

describe("a recommended Training", () => {
  it("is optional, and a scheduled Training can be linked by its id while the words are kept", async () => {
    const { period, id } = await inReview();
    const training = await scheduledTraining();
    const need = await performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION, trainingId: training });
    expect(need).toMatchObject({ trainingId: training, action: ACTION });
  });
  it("refuses an id that names no Training, or is not a whole number, and writes nothing", async () => {
    const { period, id } = await inReview();
    for (const trainingId of [9999, 0, -1, 1.5, "3", NaN]) expect(await needProblem(performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION, trainingId }))).toBe("unknown-training");
    expect(await stored()).toEqual([]);
    expect(await audits()).toEqual([]);
  });
});

describe("listing needs", () => {
  it("lists an Employee's needs in a period newest first, with who flagged each and when", async () => {
    const { period, id } = await inReview();
    const first = await performance().flagDevelopmentNeed(id, period.id, { gap: "First gap", action: "First action" });
    const second = await performance().flagDevelopmentNeed(id, period.id, { gap: "Second gap", action: "Second action" });
    const list = await performance().listDevelopmentNeeds(id, period.id);
    expect(list.map((n) => n.id)).toEqual([second.id, first.id]);
    expect(list[0]).toMatchObject({ gap: "Second gap", action: "Second action", flaggedByName: "Ada Okafor", source: "manual" });
  });
  it("keeps each Employee's and each period's needs apart, and is empty when there are none", async () => {
    const { period, id } = await inReview("Ana Cruz");
    const other = await employee("Ben Dela Cruz");
    await performance().saveRating(other, period.id, { rating: 70 });
    await performance().flagDevelopmentNeed(id, period.id, { gap: "Ana gap", action: "Ana action" });
    await performance().flagDevelopmentNeed(other, period.id, { gap: "Ben gap", action: "Ben action" });
    expect((await performance().listDevelopmentNeeds(id, period.id)).map((n) => n.gap)).toEqual(["Ana gap"]);
    expect((await performance().listDevelopmentNeeds(other, period.id)).map((n) => n.gap)).toEqual(["Ben gap"]);
    const december = await performance().openPeriod({ type: "Month", year: 2026, month: 12 });
    expect(await performance().listDevelopmentNeeds(id, december.id)).toEqual([]);
  });
  it("lists the needs of a Draft Evaluation (none) and refuses an unknown Employee or period", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Cara Lim");
    expect(await performance().listDevelopmentNeeds(id, period.id)).toEqual([]);
    expect(await performance().listDevelopmentNeeds(999, period.id).then(() => "ok", (e) => (e as PeriodError).problem)).toBe("unknown-employee");
    expect(await performance().listDevelopmentNeeds(id, 999).then(() => "ok", (e) => (e as PeriodError).problem)).toBe("unknown-period");
  });
});

describe("Submit and Reopen", () => {
  it("leave the needs as they are: a need flagged In review stays, unchanged, through Submit and Reopen, and a Reopen neither copies nor removes it", async () => {
    const { period, id } = await inReview();
    await performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION });
    const before = await performance().listDevelopmentNeeds(id, period.id);

    await performance().submitEvaluation(id, period.id);
    expect(await performance().listDevelopmentNeeds(id, period.id)).toEqual(before);

    await performance().reopenEvaluation(id, period.id, "A bad import, corrected.");
    expect(await performance().listDevelopmentNeeds(id, period.id)).toEqual(before);

    await performance().submitEvaluation(id, period.id);
    expect(await performance().listDevelopmentNeeds(id, period.id)).toEqual(before);
    expect(await stored()).toHaveLength(1);
  });
  it("a need flagged on an Evaluated evaluation survives a Reopen, and further needs can be flagged after it", async () => {
    const { period, id } = await evaluated();
    const kept = await performance().flagDevelopmentNeed(id, period.id, { gap: "Gap while Evaluated", action: ACTION });
    await performance().reopenEvaluation(id, period.id, "Correcting the rating.");
    const added = await performance().flagDevelopmentNeed(id, period.id, { gap: "Gap while In review again", action: ACTION });
    expect((await performance().listDevelopmentNeeds(id, period.id)).map((n) => n.id)).toEqual([added.id, kept.id]);
  });
});

describe("the audit", () => {
  it("writes one Performance audit row per flag, with the Staff member, the Employee and the period", async () => {
    const { period, id } = await inReview();
    const training = await scheduledTraining();
    const need = await performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION, trainingId: training });
    expect(await audits()).toEqual([{ actor_id: "u-ada", actor_name: "Ada Okafor", action: "development-need-flagged", subject: "evaluation", subject_id: `${id}:${period.id}`, detail: { employeeId: id, periodId: period.id, needId: need.id, source: "manual", trainingId: training } }]);
  });
  it("is written with the change: a refused flag writes neither, and every stored need has its audit row", async () => {
    const { period, id } = await inReview();
    await needProblem(performance().flagDevelopmentNeed(id, period.id, { gap: "", action: ACTION }));
    await needProblem(performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION, trainingId: 9999 }));
    expect(await stored()).toEqual([]);
    expect(await audits()).toEqual([]);
    await performance().flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION });
    await performance().flagDevelopmentNeed(id, period.id, { gap: "Another gap", action: ACTION });
    expect((await stored()).length).toBe((await audits()).length);
  });
  it("records a different Staff member's name against their own flag", async () => {
    const { period, id } = await inReview();
    const bo = portal.signIn({ ...staff, id: "u-bo", username: "bo", name: "Bo Reyes" }, ["Performance"]);
    await performance(bo).flagDevelopmentNeed(id, period.id, { gap: GAP, action: ACTION });
    expect((await audits())[0]).toMatchObject({ actor_id: "u-bo", actor_name: "Bo Reyes" });
    expect((await performance().listDevelopmentNeeds(id, period.id))[0]).toMatchObject({ flaggedById: "u-bo", flaggedByName: "Bo Reyes" });
  });
});

describe("the table", () => {
  it("stores what the ticket lists and nothing about the AI yet beyond the source and the optional link", async () => {
    const { rows } = await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'hrms_development_needs' ORDER BY ordinal_position`);
    expect(rows.map((r) => r.column_name)).toEqual(["id", "employee_id", "period_id", "gap", "action", "training_id", "source", "suggestion_id", "flagged_by_id", "flagged_by_name", "flagged_at"]);
  });
  it("only lets a need linked to a suggestion be an AI need", async () => {
    const { period, id } = await evaluated();
    // The suggestions table exists since migration 0051, so the link must point at a real suggestion.
    const evaluation = (await db.query<{ id: number }>(`SELECT id FROM public.hrms_evaluations WHERE employee_id = $1 AND period_id = $2`, [id, period.id])).rows[0].id;
    const set = (await db.query<{ id: number }>(`INSERT INTO public.hrms_suggestion_sets (evaluation_id, version, model, generated_by_id, generated_by_name) VALUES ($1, 1, 'm', 'u', 'U') RETURNING id`, [evaluation])).rows[0].id;
    const suggestion = (await db.query<{ id: number }>(`INSERT INTO public.hrms_suggestions (set_id, position, kpi_id, gap, kpi_result, kpi_target, recommendation, reason) VALUES ($1, 1, 'punctuality', 'g', 88, '100%', 'r', 'why') RETURNING id`, [set])).rows[0].id;
    const insert = (source: string, link: number | null) => db.query(`INSERT INTO public.hrms_development_needs (employee_id, period_id, gap, action, source, suggestion_id, flagged_by_id, flagged_by_name) VALUES ($1, $2, 'g', 'a', $3, $4, 'u', 'U')`, [id, period.id, source, link]);
    await insert("ai", suggestion);
    await expect(insert("manual", suggestion)).rejects.toThrow();
    await expect(insert("other", null)).rejects.toThrow();
    await expect(insert("ai", suggestion + 100)).rejects.toThrow();
  });
});
