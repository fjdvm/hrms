import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NeedError, PerformanceError, SuggestionError, performanceFor, type RawAttendanceRow } from "@/lib/performance";
import type { AiClient, AiClientResult, AiConfig } from "@/lib/ai";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const clock = new Date("2026-12-01T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const config = (overrides: Partial<AiConfig> = {}): AiConfig => ({ apiKey: "sk-test", model: "gpt-4.1-mini", enabled: { "job-draft": true, suggestions: true }, limits: { "job-draft": 20, suggestions: 60 }, budget: null, ...overrides });
const reply = (output: unknown): AiClientResult => ({ ok: true, output, inputTokens: 100, outputTokens: 50 });
const answers = (...results: AiClientResult[]) => {
  const calls: Parameters<AiClient>[0][] = [];
  const client: AiClient = async (request) => { calls.push(request); return results[Math.min(calls.length - 1, results.length - 1)]; };
  return Object.assign(client, { calls });
};
let ai: { client?: AiClient; config?: AiConfig } = {};
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock, ai);
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
/** An Employee with a saved rating, so the Evaluation is In review. */
async function inReview(name = "Ana Cruz", rating = 80) {
  const period = (await performance().listPeriods())[0] ?? (await performance().openPeriod(NOV));
  const id = await employee(name);
  await performance().importAttendance({ fileName: `emp-${id}.csv`, rows: fullMonth(id) });
  await train(id);
  await performance().saveRating(id, period.id, { rating, comments: "Reliable and punctual." });
  return { period, id };
}
async function evaluated(name?: string, rating?: number) {
  const { period, id } = await inReview(name, rating);
  await performance().submitEvaluation(id, period.id);
  return { period, id };
}

/** A scheduled Training with objectives, for the AI to match. */
const trainingWith = async (title: string, objectives: string) =>
  (await db.query<{ id: number }>(`INSERT INTO public.hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, objectives, created_by_name)
    VALUES ($1, 'QA', '2027-01-15', '09:00', '11:00', 'In person', 'Kitchen', $2, 'Ada') RETURNING id`, [title, objectives])).rows[0].id;
const suggestion = (trainingId: number | null = null, overrides: Record<string, unknown> = {}) => ({
  kpiId: "evaluatorRating", gap: "Evaluator rating is below target", trainingId, recommendation: "Coaching on cash counting at closing", reason: "Rated 80 against a target of 100.", ...overrides,
});
const output = (...items: unknown[]) => ({ suggestions: items });
const sets = async () => (await db.query<{ id: number; version: number; status: string }>(`SELECT id, version, status FROM public.hrms_suggestion_sets ORDER BY id`)).rows;
const rowsOf = async () => (await db.query<{ id: number; status: string; need_id: number | null; training_id: number | null }>(`SELECT id, status, need_id, training_id FROM public.hrms_suggestions ORDER BY id`)).rows;
const usage = async () => (await db.query<Record<string, unknown>>(`SELECT * FROM public.hrms_ai_usage ORDER BY id`)).rows;
const audit = async (action: string) => (await db.query<{ actor_id: string; actor_name: string; subject_id: string; detail: Record<string, unknown> }>(
  `SELECT actor_id, actor_name, subject_id, detail FROM public.hrms_performance_audit WHERE action = $1 ORDER BY id`, [action])).rows;
const problem = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(SuggestionError);
  return (error as SuggestionError).problem;
};
const scoreOf = async (id: number, periodId: number) => { const d = await performance().evaluationFor(id, periodId); return { score: d.score, status: d.status, rating: d.rating?.value }; };
const generated = async (id: number, periodId: number) => {
  const result = await performance().generateSuggestions(id, periodId);
  if (!result.ok) throw new Error(`not generated: ${JSON.stringify(result)}`);
  return result.set;
};

beforeEach(() => { ai = { client: answers(reply(output(suggestion()))), config: config() }; });

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
  it("is the Performance Module grant alone, and every operation checks it before any AI call", async () => {
    const { period, id } = await evaluated();
    const client = answers(reply(output(suggestion())));
    ai = { client, config: config() };
    const other = portal.signIn({ ...staff, id: "u-bo", username: "bo", name: "Bo Reyes" }, ["Applications", "Training", "Job Postings"]);
    for (const attempt of [
      () => performance(other).generateSuggestions(id, period.id), () => performance(other).listSuggestions(id, period.id),
      () => performance(other).flagSuggestion(1), () => performance(other).dismissSuggestion(1), () => performance(other).suggestionStatus(),
    ]) {
      const error = await attempt().then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(PerformanceError);
      expect((error as PerformanceError).reason).toBe("denied");
    }
    expect(client.calls).toHaveLength(0);
    expect(await usage()).toEqual([]);
    expect(await performance().generateSuggestions(id, period.id)).toMatchObject({ ok: true });
  });
});

describe("eligibility", () => {
  it("refuses an Evaluation that is not Evaluated, with no AI call", async () => {
    const { period, id } = await inReview();
    const client = answers(reply(output(suggestion())));
    ai = { client, config: config() };
    expect(await problem(performance().generateSuggestions(id, period.id))).toBe("not-evaluated");
    expect(client.calls).toHaveLength(0);
    expect(await usage()).toEqual([]);
  });

  it("returns Not available (AI-0100, grey) for Insufficient data before any AI call, and uses no slot", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Dan Uy");
    await performance().confirmNoAttendance(id, period.id, "On unpaid leave all month");
    await performance().saveRating(id, period.id, { rating: 50 });
    await performance().submitEvaluation(id, period.id);
    const client = answers(reply(output(suggestion())));
    ai = { client, config: config() };

    const result = await performance().generateSuggestions(id, period.id);

    expect(result).toEqual({
      ok: false, kind: "ai", left: 60,
      failure: { banner: "grey", message: "Suggestions aren't available for this evaluation: it has Insufficient data, so there are too few KPI results to suggest from.", referenceId: null },
    });
    expect(JSON.stringify(result)).not.toContain("AI-0100");
    expect(client.calls).toHaveLength(0);
    expect(await usage()).toMatchObject([{ outcome: "refused", error_code: "AI-0100", counts_toward_limit: false }]);
    expect(await sets()).toEqual([]);
  });

  it("returns Nothing to suggest when every applicable KPI is at or above target, with no AI call and no slot used", async () => {
    const { period, id } = await evaluated("Ana Cruz", 100);
    const client = answers(reply(output(suggestion())));
    ai = { client, config: config() };
    expect(await performance().generateSuggestions(id, period.id)).toEqual({ ok: false, kind: "nothing", left: 60 });
    expect(client.calls).toHaveLength(0);
    expect(await usage()).toEqual([]);
    expect(await sets()).toEqual([]);
  });
});

describe("what the AI is sent", () => {
  it("holds the position, each KPI's name, result and target, the Not-applicable reasons and the Trainings' id, title and objectives, and none of the Employee's identifiers", async () => {
    await performance().openPeriod(NOV);
    const matching = await trainingWith("POS and cash handling", "Count cash accurately at closing.");
    const { period, id } = await evaluated("Mylene Santos");
    await db.query(`UPDATE public.hrms_employees SET branch = 'Main kitchen Antipolo' WHERE id = $1`, [id]);
    const client = answers(reply(output(suggestion(matching))));
    ai = { client, config: config() };

    await performance().generateSuggestions(id, period.id);

    const sent = client.calls[0];
    const text = `${sent.system} ${sent.user}`;
    const body = JSON.parse(sent.user) as { position: string; kpis: { id: string; name: string; result: number | null; target: string; belowTarget: boolean }[]; trainings: unknown[] };
    expect(body.position).toBe("Branch Cashier");
    expect(body.kpis.find((k) => k.id === "evaluatorRating")).toEqual({ id: "evaluatorRating", name: "Evaluator rating", result: 80, target: "100", belowTarget: true });
    expect(body.kpis.find((k) => k.id === "punctuality")).toMatchObject({ result: 100, target: "100%", belowTarget: false });
    expect(body.trainings).toEqual([{ id: matching, title: "POS and cash handling", objectives: "Count cash accurately at closing." }]);
    for (const forbidden of ["Mylene", "Santos", NUMBER(id), "Antipolo", "Main kitchen", "Reliable and punctual", "Ada Okafor", "u-ada"]) expect(text).not.toContain(forbidden);
  });

  it("says why a KPI is Not applicable", async () => {
    const period = await performance().openPeriod(NOV);
    const id = await employee("Ana Cruz");
    await performance().importAttendance({ fileName: "a.csv", rows: fullMonth(id) });
    await performance().saveRating(id, period.id, { rating: 80 });
    await performance().submitEvaluation(id, period.id);
    const client = answers(reply(output(suggestion())));
    ai = { client, config: config() };
    await performance().generateSuggestions(id, period.id);
    expect((JSON.parse(client.calls[0].user) as { kpis: { id: string; notApplicable?: string }[] }).kpis.find((k) => k.id === "trainingCompletion")).toMatchObject({ result: null, notApplicable: "no Training was due" });
  });
});

describe("the saved set", () => {
  it("is saved against the submitted version with who generated it, the KPI result and target as shown, the Training and the reason, all Pending", async () => {
    const matching = await trainingWith("POS and cash handling", "Count cash accurately at closing.");
    const { period, id } = await evaluated();
    ai = { client: answers(reply(output(suggestion(matching)))), config: config() };

    const result = await performance().generateSuggestions(id, period.id);

    expect(result).toMatchObject({ ok: true, left: 59 });
    const set = (result as { set: Awaited<ReturnType<typeof generated>> }).set;
    expect(set).toMatchObject({ version: 1, model: "gpt-4.1-mini", generatedByName: "Ada Okafor" });
    expect(set.suggestions).toMatchObject([{
      position: 1, kpiId: "evaluatorRating", gap: "Evaluator rating is below target", result: 80, target: "100", trainingId: matching, trainingTitle: "POS and cash handling",
      recommendation: "Coaching on cash counting at closing", reason: "Rated 80 against a target of 100.", status: "Pending", needId: null, reviewedByName: null,
    }]);
    expect(await performance().listSuggestions(id, period.id)).toMatchObject({ currentVersion: 1, actionable: true, set: { id: set.id, version: 1 } });
    expect(await usage()).toMatchObject([{ feature: "suggestions", outcome: "success", counts_toward_limit: true }]);
  });

  it("holds no prompt text and changes no score, rating or status", async () => {
    const { period, id } = await evaluated();
    const before = await scoreOf(id, period.id);
    await generated(id, period.id);
    expect(await scoreOf(id, period.id)).toEqual(before);
    const stored = JSON.stringify([await db.query(`SELECT * FROM public.hrms_suggestion_sets`), await db.query(`SELECT * FROM public.hrms_suggestions`), await usage()]);
    for (const prompt of ["You help HR", "belowTarget", "Branch Cashier"]) expect(stored).not.toContain(prompt);
  });

  it("is capped at five suggestions and a response with more is regenerated, then unusable", async () => {
    const { period, id } = await evaluated();
    const six = output(...Array.from({ length: 6 }, () => suggestion()));
    const client = answers(reply(six));
    ai = { client, config: config() };
    const result = await performance().generateSuggestions(id, period.id);
    expect(result).toMatchObject({ ok: false, kind: "ai", failure: { banner: "red", message: "The AI suggestions couldn't be used. Please try again or flag a development need yourself." } });
    expect(client.calls).toHaveLength(2);
    expect(await sets()).toEqual([]);
  });

  it("drops a Training id that does not exist and keeps the suggestion with no Training", async () => {
    const { period, id } = await evaluated();
    ai = { client: answers(reply(output(suggestion(9999)))), config: config() };
    const set = await generated(id, period.id);
    expect(set.suggestions[0]).toMatchObject({ trainingId: null, trainingTitle: null });
  });

  it("rejects a suggestion tied to a KPI that is not below target, and regenerates once", async () => {
    const { period, id } = await evaluated();
    const client = answers(reply(output(suggestion(null, { kpiId: "punctuality" }))), reply(output(suggestion())));
    ai = { client, config: config() };
    expect(await performance().generateSuggestions(id, period.id)).toMatchObject({ ok: true });
    expect(client.calls).toHaveLength(2);
    expect(await usage()).toHaveLength(1);
  });
});

describe("Regenerate", () => {
  it("saves a new set, marks the old one superseded and deletes nothing", async () => {
    const { period, id } = await evaluated();
    const first = await generated(id, period.id);
    ai = { client: answers(reply(output(suggestion(null, { gap: "Needs steadier ratings" })))), config: config() };
    const second = await generated(id, period.id);

    expect(second.id).not.toBe(first.id);
    expect(await sets()).toMatchObject([{ id: first.id, version: 1, status: "superseded" }, { id: second.id, version: 1, status: "current" }]);
    expect(await rowsOf()).toHaveLength(2);
    expect((await performance().listSuggestions(id, period.id)).set).toMatchObject({ id: second.id });
    expect(await usage()).toHaveLength(2);
  });

  it("refuses to flag or dismiss a suggestion of a superseded set", async () => {
    const { period, id } = await evaluated();
    const first = await generated(id, period.id);
    await generated(id, period.id);
    expect(await problem(performance().flagSuggestion(first.suggestions[0].id))).toBe("superseded");
    expect(await problem(performance().dismissSuggestion(first.suggestions[0].id))).toBe("superseded");
  });
});

describe("Reopen and versions", () => {
  it("keeps the earlier set, labelled with its version and read-only, and refuses generating until Evaluated again", async () => {
    const { period, id } = await evaluated();
    const first = await generated(id, period.id);
    await performance().reopenEvaluation(id, period.id, "A bad import, corrected.");

    expect(await performance().listSuggestions(id, period.id)).toMatchObject({ currentVersion: 1, actionable: false, set: { id: first.id, version: 1 } });
    expect(await problem(performance().generateSuggestions(id, period.id))).toBe("not-evaluated");
    expect(await problem(performance().flagSuggestion(first.suggestions[0].id))).toBe("not-evaluated");
    expect(await problem(performance().dismissSuggestion(first.suggestions[0].id))).toBe("not-evaluated");
    expect((await sets())).toHaveLength(1);
  });

  it("after submitting again, the old set stays visible as an earlier version and a new set is saved for the new version", async () => {
    const { period, id } = await evaluated();
    const first = await generated(id, period.id);
    await performance().reopenEvaluation(id, period.id, "Correcting the rating.");
    await performance().saveRating(id, period.id, { rating: 70 });
    await performance().submitEvaluation(id, period.id);

    expect(await performance().listSuggestions(id, period.id)).toMatchObject({ currentVersion: 2, actionable: false, set: { id: first.id, version: 1 } });
    expect(await problem(performance().flagSuggestion(first.suggestions[0].id))).toBe("earlier-version");

    const second = await generated(id, period.id);
    expect(second.version).toBe(2);
    expect(await sets()).toMatchObject([{ id: first.id, version: 1, status: "current" }, { id: second.id, version: 2, status: "current" }]);
    expect(await performance().listSuggestions(id, period.id)).toMatchObject({ currentVersion: 2, actionable: true, set: { id: second.id, version: 2 } });
  });
});

describe("Flag as need", () => {
  it("creates a development need with the AI source and the link, marks the suggestion Flagged, and records the audit row", async () => {
    const matching = await trainingWith("POS and cash handling", "Count cash accurately at closing.");
    const { period, id } = await evaluated();
    ai = { client: answers(reply(output(suggestion(matching)))), config: config() };
    const set = await generated(id, period.id);
    const before = await scoreOf(id, period.id);

    const need = await performance().flagSuggestion(set.suggestions[0].id);

    expect(need).toMatchObject({ employeeId: id, periodId: period.id, gap: "Evaluator rating is below target", action: "Training: POS and cash handling", trainingId: matching, source: "ai", suggestionId: set.suggestions[0].id, flaggedById: "u-ada", flaggedByName: "Ada Okafor" });
    expect(await rowsOf()).toMatchObject([{ status: "Flagged", need_id: need.id }]);
    expect(await performance().listDevelopmentNeeds(id, period.id)).toMatchObject([{ id: need.id, source: "ai" }]);
    expect((await performance().listSuggestions(id, period.id)).set?.suggestions[0]).toMatchObject({ status: "Flagged", needId: need.id, reviewedByName: "Ada Okafor" });
    expect(await audit("development-suggestion-flagged")).toMatchObject([{ actor_id: "u-ada", actor_name: "Ada Okafor", subject_id: `${id}:${period.id}`, detail: { employeeId: id, periodId: period.id, suggestionId: set.suggestions[0].id, needId: need.id } }]);
    expect(await scoreOf(id, period.id)).toEqual(before);
  });

  it("uses the recommendation as the action when no Training matches, and lets Staff edit both first with the same rules as a typed need", async () => {
    const { period, id } = await evaluated();
    const set = await generated(id, period.id);
    const edited = await performance().flagSuggestion(set.suggestions[0].id, { gap: "  Cash counting at closing  ", action: "Pair with Ana for a week" });
    expect(edited).toMatchObject({ gap: "Cash counting at closing", action: "Pair with Ana for a week", trainingId: null, source: "ai" });

    const second = await generated(id, period.id);
    expect(await performance().flagSuggestion(second.suggestions[0].id).then((n) => n.action)).toBe("Coaching on cash counting at closing");

    const third = await generated(id, period.id);
    const error = await performance().flagSuggestion(third.suggestions[0].id, { gap: "" }).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(NeedError);
    expect((error as NeedError).problem).toBe("gap-required");
    expect(await rowsOf().then((rows) => rows.filter((r) => r.status === "Pending"))).toHaveLength(1);
  });

  it("refuses an unknown Training id and adds nothing", async () => {
    const { period, id } = await evaluated();
    const set = await generated(id, period.id);
    const error = await performance().flagSuggestion(set.suggestions[0].id, { trainingId: 9999 }).then(() => undefined, (e: unknown) => e);
    expect((error as NeedError).problem).toBe("unknown-training");
    expect(await performance().listDevelopmentNeeds(id, period.id)).toEqual([]);
  });

  it("cannot be done twice, even at the same moment", async () => {
    const { period, id } = await evaluated();
    const set = await generated(id, period.id);
    const results = await Promise.allSettled([performance().flagSuggestion(set.suggestions[0].id), performance().flagSuggestion(set.suggestions[0].id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await performance().listDevelopmentNeeds(id, period.id)).toHaveLength(1);
    expect(await problem(performance().flagSuggestion(set.suggestions[0].id))).toBe("already-reviewed");
    expect(await audit("development-suggestion-flagged")).toHaveLength(1);
  });

  it("refuses a suggestion that does not exist", async () => {
    expect(await problem(performance().flagSuggestion(404))).toBe("unknown-suggestion");
    expect(await problem(performance().flagSuggestion(0))).toBe("unknown-suggestion");
  });
});

describe("Dismiss", () => {
  it("marks the suggestion Dismissed with who and when, writes the audit row and changes nothing else", async () => {
    const { period, id } = await evaluated();
    const set = await generated(id, period.id);
    const before = await scoreOf(id, period.id);

    expect(await performance().dismissSuggestion(set.suggestions[0].id)).toEqual({ id: set.suggestions[0].id, status: "Dismissed" });

    expect((await performance().listSuggestions(id, period.id)).set?.suggestions[0]).toMatchObject({ status: "Dismissed", needId: null, reviewedByName: "Ada Okafor" });
    expect(await performance().listDevelopmentNeeds(id, period.id)).toEqual([]);
    expect(await audit("development-suggestion-dismissed")).toMatchObject([{ actor_id: "u-ada", subject_id: `${id}:${period.id}`, detail: { suggestionId: set.suggestions[0].id } }]);
    expect(await scoreOf(id, period.id)).toEqual(before);
    expect(await problem(performance().dismissSuggestion(set.suggestions[0].id))).toBe("already-reviewed");
    expect(await problem(performance().flagSuggestion(set.suggestions[0].id))).toBe("already-reviewed");
  });
});

describe("audit", () => {
  it("records each generation with the Staff member, the Employee and the period", async () => {
    const { period, id } = await evaluated();
    const set = await generated(id, period.id);
    expect(await audit("development-suggestions-generated")).toMatchObject([{ actor_id: "u-ada", actor_name: "Ada Okafor", subject_id: `${id}:${period.id}`, detail: { employeeId: id, periodId: period.id, setId: set.id, version: 1, count: 1 } }]);
  });
});

describe("limits and failures", () => {
  it("allows the 60th run and refuses the 61st with AI-0089 as a yellow message and no code", async () => {
    const { period, id } = await evaluated();
    ai = { client: answers(reply(output(suggestion()))), config: config({ limits: { "job-draft": 20, suggestions: 2 } }) };
    await generated(id, period.id);
    expect(await performance().suggestionStatus()).toEqual({ enabled: true, left: 1, limit: 2 });
    await generated(id, period.id);
    const result = await performance().generateSuggestions(id, period.id);
    expect(result).toEqual({ ok: false, kind: "ai", left: 0, failure: { banner: "yellow", message: "You've used all 2 AI suggestions today. The limit resets at 12:00 AM Manila time. You can still flag development needs yourself.", referenceId: null } });
    expect(JSON.stringify(result)).not.toContain("AI-");
    expect((await usage()).at(-1)).toMatchObject({ outcome: "refused", error_code: "AI-0089", counts_toward_limit: false });
    expect(await sets()).toHaveLength(2);
  });

  it("refuses at the company cap with AI-0090, yellow", async () => {
    const { period, id } = await evaluated();
    ai = { client: answers(reply(output(suggestion()))), config: config({ budget: 1 }) };
    await generated(id, period.id);
    expect(await performance().generateSuggestions(id, period.id)).toMatchObject({ ok: false, kind: "ai", failure: { banner: "yellow", message: "AI suggestions are unavailable right now. Please try again tomorrow." } });
    expect((await usage()).at(-1)).toMatchObject({ error_code: "AI-0090" });
  });

  it("with the switch off, returns AI-0094 with no message and calls nothing", async () => {
    const { period, id } = await evaluated();
    const client = answers(reply(output(suggestion())));
    ai = { client, config: config({ enabled: { "job-draft": true, suggestions: false } }) };
    expect(await performance().generateSuggestions(id, period.id)).toMatchObject({ ok: false, kind: "ai", failure: { banner: "none", message: null, referenceId: null } });
    expect(client.calls).toHaveLength(0);
    expect(await performance().suggestionStatus()).toMatchObject({ enabled: false });
    expect((await usage())[0]).toMatchObject({ error_code: "AI-0094" });
  });

  it.each([
    ["provider-rate-limit", "AI-0091", "The AI service is busy. Please try again in a moment."],
    ["provider-quota", "AI-0091", "The AI service is busy. Please try again in a moment."],
    ["timeout", "AI-0092", "That took too long. Please try again."],
  ] as const)("a provider failure (%s) is red with a Reference ID that matches the usage row, and does not use a slot", async (reason, code, message) => {
    const { period, id } = await evaluated();
    ai = { client: answers({ ok: false, reason }), config: config() };
    const result = await performance().generateSuggestions(id, period.id);

    expect(result).toMatchObject({ ok: false, kind: "ai", left: 60, failure: { banner: "red", message, referenceId: expect.stringMatching(/^[A-Z0-9]{6}$/) } });
    const failure = (result as { failure: { referenceId: string } }).failure;
    expect(JSON.stringify(result)).not.toContain("AI-0");
    expect(await usage()).toMatchObject([{ outcome: "failed", error_code: code, error_reason: reason, reference_id: failure.referenceId, counts_toward_limit: false }]);
    expect(await sets()).toEqual([]);
  });

  it("two unusable answers are AI-0093, red with a Reference ID, and do use a slot", async () => {
    const { period, id } = await evaluated();
    const client = answers(reply({ nonsense: true }));
    ai = { client, config: config() };
    const result = await performance().generateSuggestions(id, period.id);
    expect(result).toMatchObject({ ok: false, kind: "ai", left: 59, failure: { banner: "red", message: "The AI suggestions couldn't be used. Please try again or flag a development need yourself.", referenceId: expect.any(String) } });
    expect(client.calls).toHaveLength(2);
    expect(await usage()).toMatchObject([{ outcome: "unusable", error_code: "AI-0093", counts_toward_limit: true }]);
    expect(await sets()).toEqual([]);
  });

  it("never lets two runs at the same moment both take the last slot", async () => {
    const { period, id } = await evaluated();
    ai = { client: answers(reply(output(suggestion()))), config: config({ limits: { "job-draft": 20, suggestions: 1 } }) };
    const results = await Promise.all([performance().generateSuggestions(id, period.id), performance().generateSuggestions(id, period.id)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(await sets()).toHaveLength(1);
  });
});
