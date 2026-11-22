import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { performanceFor, type RawAttendanceRow } from "@/lib/performance";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let handle: string;
const clock = new Date("2026-12-01T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = () => performanceFor(handle, db, () => clock);
const GATEWAY = "https://gateway.test";
const NOV = { type: "Month", year: 2026, month: 11 } as const;
const DEFAULTS = { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 };
const WEIGHTS = { attendanceRate: 40, punctuality: 20, fullShift: 10, trainingCompletion: 10, evaluatorRating: 20 };

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  const portal = new FakePortal();
  handle = portal.signIn(staff, ["Performance"]);
  const portalOnly = portalFetch(portal);
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith(GATEWAY) ? new Response(JSON.stringify({ id: "x" }), { status: 201 }) : portalOnly(input as never, init));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("API_GATEWAY_URL", GATEWAY);
  vi.stubEnv("API_GATEWAY_KEY", "gateway-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

const items = async (setId: number) => Object.fromEntries((await db.query<{ kpi_id: string; weight: number }>(
  `SELECT kpi_id, weight FROM hrms_weight_set_items WHERE set_id = $1 ORDER BY kpi_id`, [setId])).rows.map((r) => [r.kpi_id, r.weight]));
const legacy = async (setId: number) => (await db.query<Record<string, number>>(
  `SELECT attendance_rate AS "attendanceRate", punctuality, full_shift AS "fullShift", training_completion AS "trainingCompletion", evaluator_rating AS "evaluatorRating"
   FROM hrms_weight_sets WHERE id = $1`, [setId])).rows[0];

describe("weight sets as one row per KPI", () => {
  it("backfills the items from the legacy columns for the default set", async () => {
    const [defaultSet] = await performance().listWeightSets();

    expect(await items(defaultSet.id)).toEqual(DEFAULTS);
    expect(defaultSet.weights).toEqual(DEFAULTS);
    expect(defaultSet.total).toBe(100);
  });

  it("writes the items and the legacy columns together when a set is created and edited", async () => {
    const created = await performance().saveWeightSet({ position: "Branch Cashier", weights: WEIGHTS });
    expect(created.weights).toEqual(WEIGHTS);
    expect(await items(created.id)).toEqual(WEIGHTS);
    expect(await legacy(created.id)).toEqual(WEIGHTS);

    const edited = await performance().saveWeightSet({ id: created.id, position: "Branch Cashier", weights: DEFAULTS });
    expect(edited.weights).toEqual(DEFAULTS);
    expect(await items(created.id)).toEqual(DEFAULTS);
    expect(await legacy(created.id)).toEqual(DEFAULTS);
    expect((await performance().weightSetFor("branch  cashier")).weights).toEqual(DEFAULTS);
  });

  it("reads each default weight from the items", async () => {
    const [defaultSet] = await performance().listWeightSets();
    await db.query(`UPDATE hrms_weight_set_items SET weight = weight + CASE kpi_id WHEN 'attendanceRate' THEN 5 WHEN 'punctuality' THEN -5 ELSE 0 END WHERE set_id = $1`, [defaultSet.id]);

    expect((await performance().listKpis()).map((kpi) => [kpi.id, kpi.defaultWeight])).toEqual([
      ["attendanceRate", 35], ["punctuality", 20], ["fullShift", 15], ["trainingCompletion", 15], ["evaluatorRating", 15]]);
  });

  it("keeps total 100 in the database: an unbalanced write fails at commit, a balanced transaction passes", async () => {
    const [{ id }] = await performance().listWeightSets();

    await expect(db.query(`UPDATE hrms_weight_set_items SET weight = 31 WHERE set_id = $1 AND kpi_id = 'attendanceRate'`, [id])).rejects.toThrow(/total 101/);
    await expect(db.query(`DELETE FROM hrms_weight_set_items WHERE set_id = $1 AND kpi_id = 'punctuality'`, [id])).rejects.toThrow(/total 75/);
    expect(await items(id)).toEqual(DEFAULTS);

    await db.exec(`BEGIN; UPDATE hrms_weight_set_items SET weight = 35 WHERE set_id = ${id} AND kpi_id = 'attendanceRate';
      UPDATE hrms_weight_set_items SET weight = 20 WHERE set_id = ${id} AND kpi_id = 'punctuality'; COMMIT;`);
    expect((await items(id)).attendanceRate).toBe(35);
  });

  it("counts a KPI with no row as weight 0, so a newer KPI can exist before any set weighs it", async () => {
    await db.query(`INSERT INTO hrms_kpis (id, name, description, source, target, sort_order) VALUES ('sales', 'Sales', 'Net sales per present day', 'POS', '100%', 6)`);
    const [defaultSet] = await performance().listWeightSets();

    expect(defaultSet.weights).toEqual(DEFAULTS);
    expect(defaultSet.total).toBe(100);
    expect((await performance().listKpis()).find((kpi) => (kpi.id as string) === "sales")?.defaultWeight).toBe(0);
    const saved = await performance().saveWeightSet({ position: "Branch Cashier", weights: WEIGHTS });
    expect(saved.total).toBe(100);
  });
});

describe("an Evaluation submitted before a sixth KPI exists", () => {
  const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`).filter((d) => {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  });

  async function submittedEmployee() {
    const offer = (await db.query<{ id: number }>(`INSERT INTO hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
      VALUES (1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`)).rows[0].id;
    const id = (await db.query<{ id: number }>(`INSERT INTO hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name, shift_start, shift_end, working_days)
      VALUES ('2026-001', $1, 1, 'Ana Cruz', 'ana1@example.test', 'Branch Cashier', 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Active', 'Ada', '08:00', '17:00', '{1,2,3,4,5}') RETURNING id`, [offer])).rows[0].id;
    const rows: RawAttendanceRow[] = days.map((date) => ({ employeeNumber: "2026-001", date, timeIn: "08:00", timeOut: "17:00" }));
    await performance().importAttendance({ fileName: "ana.csv", rows });
    const period = await performance().openPeriod(NOV);
    const t = (await db.query<{ id: number }>(`INSERT INTO hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name)
      VALUES ('Session', 'QA', '2026-11-02', '09:00', '11:00', 'In person', 'Kitchen', 'Ada') RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO hrms_training_assignments (training_id, employee_id, status) VALUES ($1, $2, 'Completed')`, [t, id]);
    await performance().saveRating(id, period.id, { rating: 80, comments: "Reliable." });
    await performance().submitEvaluation(id, period.id);
    return { id, period };
  }
  const addSixthKpi = async () => {
    await db.query(`INSERT INTO hrms_kpis (id, name, description, source, target, sort_order) VALUES ('sales', 'Sales', 'Net sales per present day', 'POS', '100%', 6)`);
    await db.query(`INSERT INTO hrms_weight_set_items (set_id, kpi_id, weight) SELECT id, 'sales', 0 FROM hrms_weight_sets`);
  };

  it("opens, still shows only the KPIs it was scored on, and keeps its stored result", async () => {
    const { id, period } = await submittedEmployee();
    const stored = async () => JSON.stringify([
      (await db.query(`SELECT * FROM hrms_evaluation_submissions ORDER BY id`)).rows, (await db.query(`SELECT * FROM hrms_evaluation_results ORDER BY submission_id, kpi_id`)).rows]);
    const before = await stored();
    const evaluated = await performance().evaluationFor(id, period.id);
    expect(evaluated).toMatchObject({ status: "Evaluated", score: { outcome: "scored", value: 97 } });

    await addSixthKpi();

    const after = await performance().evaluationFor(id, period.id);
    expect(after.kpis.map((kpi) => kpi.id)).toEqual(["attendanceRate", "punctuality", "fullShift", "trainingCompletion", "evaluatorRating"]);
    expect(after).toEqual(evaluated);
    expect(await stored()).toBe(before);
  });

  it("shows only the KPIs it was scored on once reopened, with its frozen weights", async () => {
    const { id, period } = await submittedEmployee();
    await addSixthKpi();
    await performance().reopenEvaluation(id, period.id, "A bad import was corrected.");

    const detail = await performance().evaluationFor(id, period.id);
    expect(detail).toMatchObject({ status: "In review", rulesFrozen: true, score: { outcome: "scored", value: 97 } });
    expect(detail.kpis.map((kpi) => kpi.id)).toEqual(["attendanceRate", "punctuality", "fullShift", "trainingCompletion", "evaluatorRating"]);
    expect(detail.weights).toEqual(DEFAULTS);
  });
});
