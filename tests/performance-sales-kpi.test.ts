import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NEW_ACCOUNT_REASON, SalesTargetError, performanceFor, type RawAttendanceRow } from "@/lib/performance";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let handle: string;
let count = 0;
const clock = new Date("2026-12-01T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = () => performanceFor(handle, db, () => clock);
const GATEWAY = "https://gateway.test";
const NOV = { type: "Month", year: 2026, month: 11 } as const;
// Rating 80, both Trainings done, a full on-time month: attendance, punctuality, full shift and training all score 100.
const SALES_SET = { attendanceRate: 30, punctuality: 20, fullShift: 10, trainingCompletion: 10, evaluatorRating: 20, sales: 10 };
const WEEKDAYS = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`).filter((d) => {
  const day = new Date(`${d}T00:00:00Z`).getUTCDay();
  return day >= 1 && day <= 5;
}); // 21 days

beforeEach(async () => {
  count = 0;
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

async function employee(name = "Ana Cruz") {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name, shift_start, shift_end, working_days)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Active', 'Ada', '08:00', '17:00', '{1,2,3,4,5}') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, `emp${count}@example.test`])).rows[0].id;
}
/** A submitted-ready Evaluation in November: present on `days` weekdays (all 21 by default). */
async function ready(id: number, days = WEEKDAYS) {
  const rows: RawAttendanceRow[] = days.map((date) => ({ employeeNumber: `2026-${String(id).padStart(3, "0")}`, date, timeIn: "08:00", timeOut: "17:00" }));
  await performance().importAttendance({ fileName: `emp-${id}.csv`, rows });
  const period = (await performance().listPeriods())[0] ?? (await performance().openPeriod(NOV));
  const t = (await db.query<{ id: number }>(`INSERT INTO hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name)
    VALUES ('Session', 'QA', $1, '09:00', '11:00', 'In person', 'Kitchen', 'Ada') RETURNING id`, [`2026-11-${String(2 + (count % 20)).padStart(2, "0")}`])).rows[0].id;
  await db.query(`INSERT INTO hrms_training_assignments (training_id, employee_id, status) VALUES ($1, $2, 'Completed')`, [t, id]);
  await performance().saveRating(id, period.id, { rating: 80, comments: "Reliable." });
  return period;
}
/** Imported POS figures: a POS import ran on `importedAt`, and one day's net sales per account. */
async function pos(sales: [account: string, location: number, date: string, net: number][], importedAt = "2026-12-01T01:00:00Z") {
  const id = (await db.query<{ id: number }>(`INSERT INTO hrms_pos_imports (range_from, range_to, days, orders, net_sales, unlinked_accounts, imported_by_id, imported_by_name, imported_at)
    VALUES ('2026-10-01', '2026-12-31', $1, 1, 0, 0, 'u', 'U', $2) RETURNING id`, [sales.length, importedAt])).rows[0].id;
  for (const [account, location, date, net] of sales) {
    await db.query(`INSERT INTO hrms_pos_sales_daily VALUES ($1, $2, $3, 1, $4, 0, $4, $5) ON CONFLICT (portal_user_id, location_id, business_date) DO UPDATE SET gross_sales = $4, net_sales = $4`, [account, location, date, net, id]);
  }
}
/** Everything switched on: the cashier set weighs sales, a target of P1,000, go-live before the period, and one linked account. */
async function switchedOn(options: { target?: number | null; goLive?: string; link?: boolean } = {}) {
  await performance().saveWeightSet({ position: "Branch Cashier", weights: SALES_SET });
  if (options.target !== null) await performance().setSalesTarget(options.target ?? 1000);
  await performance().setPosGoLive(options.goLive ?? "2026-10-01");
  const id = await employee();
  if (options.link !== false) await performance().linkPosAccount({ employeeId: id, portalUserId: "u-ana" });
  return id;
}
const cashierSet = async () => (await performance().listWeightSets()).find((set) => set.position === "Branch Cashier")!.id;
const line = async (id: number, periodId: number, kpi = "sales") => (await performance().evaluationFor(id, periodId)).kpis.find((k) => k.id === kpi);
const stored = async () => JSON.stringify([(await db.query(`SELECT * FROM hrms_evaluation_submissions ORDER BY id`)).rows, (await db.query(`SELECT * FROM hrms_evaluation_results ORDER BY submission_id, kpi_id`)).rows]);

describe("the sales weight and target", () => {
  it("starts at 0 in every set, and the KPI Setup list does not show the sales KPI yet", async () => {
    const [defaultSet] = await performance().listWeightSets();

    expect(defaultSet.weights).not.toHaveProperty("sales");
    expect((await performance().listKpis()).map((k) => k.id)).toEqual(["attendanceRate", "punctuality", "fullShift", "trainingCompletion", "evaluatorRating"]);
    expect(await performance().salesTarget()).toBeNull();
  });

  it("lists the sales KPI for KPI Setup only, with its target in pesos once it is set", async () => {
    expect((await performance().listKpis({ includeSales: true })).find((k) => k.id === "sales")).toMatchObject({ name: "Sales", status: "Active", defaultWeight: 0, targetAmount: null, target: "Not set" });
    expect((await performance().listKpis()).map((k) => k.id)).not.toContain("sales");

    await performance().setSalesTarget(1500.5);
    expect((await performance().listKpis({ includeSales: true })).find((k) => k.id === "sales")).toMatchObject({ targetAmount: 1500.5, target: "₱1,500.50 net sales per present day" });
  });

  it("writes the sales weight to the items and scales the five legacy columns to total 100, so a revert is safe", async () => {
    const saved = await performance().saveWeightSet({ position: "Branch Cashier", weights: { attendanceRate: 40, punctuality: 15, fullShift: 10, trainingCompletion: 10, evaluatorRating: 15, sales: 10 } });

    expect(saved).toMatchObject({ total: 100, weights: { attendanceRate: 40, punctuality: 15, fullShift: 10, trainingCompletion: 10, evaluatorRating: 15, sales: 10 } });
    expect((await db.query<{ kpi_id: string; weight: number }>(`SELECT kpi_id, weight FROM hrms_weight_set_items WHERE set_id = $1 AND kpi_id = 'sales'`, [saved.id])).rows).toEqual([{ kpi_id: "sales", weight: 10 }]);
    // 40, 15, 10, 10, 15 of 90 scaled to 100 by largest remainder: 44, 17, 11, 11, 17.
    expect((await db.query(`SELECT attendance_rate, punctuality, full_shift, training_completion, evaluator_rating FROM hrms_weight_sets WHERE id = $1`, [saved.id])).rows)
      .toEqual([{ attendance_rate: 44, punctuality: 17, full_shift: 11, training_completion: 11, evaluator_rating: 17 }]);

    const back = await performance().saveWeightSet({ id: saved.id, position: "Branch Cashier", weights: { attendanceRate: 40, punctuality: 20, fullShift: 10, trainingCompletion: 10, evaluatorRating: 20 } });
    expect(back.weights).not.toHaveProperty("sales");
    expect((await db.query(`SELECT weight FROM hrms_weight_set_items WHERE set_id = $1 AND kpi_id = 'sales'`, [saved.id])).rows).toEqual([{ weight: 0 }]);
  });

  it("sets the target in pesos, shows it on the KPI, and audits each real change with the Staff member", async () => {
    expect(await performance().setSalesTarget(1000)).toBe(1000);
    await performance().setSalesTarget("1000.00");
    await performance().setSalesTarget(1500.5);

    expect(await performance().salesTarget()).toBe(1500.5);
    expect((await db.query<{ target: string }>(`SELECT target FROM hrms_kpis WHERE id = 'sales'`)).rows[0].target).toBe("₱1,500.50 net sales per present day");
    expect((await db.query(`SELECT actor_id, actor_name, action, subject, subject_id, detail FROM hrms_performance_audit WHERE action = 'sales-target-set' ORDER BY id`)).rows).toEqual([
      { actor_id: "u-ada", actor_name: "Ada Okafor", action: "sales-target-set", subject: "kpi", subject_id: "sales", detail: { from: null, to: 1000 } },
      { actor_id: "u-ada", actor_name: "Ada Okafor", action: "sales-target-set", subject: "kpi", subject_id: "sales", detail: { from: 1000, to: 1500.5 } }]);
    for (const bad of [0, -5, "abc", "", 1.234, 20_000_000, null, undefined]) await expect(performance().setSalesTarget(bad)).rejects.toBeInstanceOf(SalesTargetError);
  });
});

describe("scoring a cashier", () => {
  it("scores net sales per present day against the target, and adds it to the score", async () => {
    const id = await switchedOn();
    const period = await ready(id);
    await pos([["u-ana", 1, "2026-11-03", 15000], ["u-ana", 1, "2026-11-04", 750]]);   // 15,750 over 21 present days = 750 a day = 75%

    expect(await line(id, period.id)).toMatchObject({ id: "sales", status: "scored", result: 75, weight: 10, weightUsed: 10, points: 7.5, name: "Sales", source: "POS sales import" });
    // 30 + 20 + 10 + 10 + 16 (rating 80 x 20%) + 7.5
    expect((await performance().evaluationFor(id, period.id)).score).toEqual({ outcome: "scored", value: 93.5 });
  });

  it("sums a cashier's two accounts across branches, and counts only the days of the period", async () => {
    const id = await switchedOn();
    const period = await ready(id);
    await performance().linkPosAccount({ employeeId: id, portalUserId: "u-ana-2", reason: NEW_ACCOUNT_REASON });
    await pos([["u-ana", 1, "2026-11-03", 10000], ["u-ana-2", 2, "2026-11-10", 5750], ["u-ana", 1, "2026-10-31", 99999], ["u-ana", 1, "2026-12-01", 99999], ["u-other", 1, "2026-11-03", 99999]]);

    expect((await line(id, period.id))?.result).toBe(75);
  });

  it("counts present days with no orders as zero sales", async () => {
    const id = await switchedOn();
    const period = await ready(id);
    await pos([["u-ana", 1, "2026-11-03", 21000]]);          // 1,000 a day over 21 present days: exactly the target
    expect((await line(id, period.id))?.result).toBe(100);

    await db.query(`UPDATE hrms_pos_sales_daily SET gross_sales = 0, net_sales = 0`);
    expect(await line(id, period.id)).toMatchObject({ status: "scored", result: 0 });
  });

  it("caps at 100 and scores negative net sales as 0", async () => {
    const id = await switchedOn();
    const period = await ready(id);
    await pos([["u-ana", 1, "2026-11-03", 400000]]);
    expect((await line(id, period.id))?.result).toBe(100);

    await db.query(`UPDATE hrms_pos_sales_daily SET refund_amount = 500, gross_sales = 0, net_sales = -500`);
    expect((await line(id, period.id))?.result).toBe(0);
  });

  it.each([
    ["has no linked account", { link: false }, "no-linked-account"],
    ["starts before the go-live date", { goLive: "2026-11-15" }, "before-go-live"],
    ["has no target set", { target: null }, "no-target"],
  ] as const)("is Not applicable when the Employee %s, and the other weights are rescaled", async (_name, options, reason) => {
    const id = await switchedOn(options);
    const period = await ready(id);
    await pos([["u-ana", 1, "2026-11-03", 15750]]);

    expect(await line(id, period.id)).toMatchObject({ id: "sales", status: "not-applicable", reason, result: null, weight: 10 });
    // 90 of 100 remains: 30 + 20 + 10 + 10 + 16 = 86 points, rescaled by 100/90 = 95.6
    expect((await performance().evaluationFor(id, period.id)).score).toEqual({ outcome: "scored", value: 95.6 });
  });

  it("is Not applicable until an import ran after the period ended, by Manila date", async () => {
    const id = await switchedOn();
    const period = await ready(id);
    await pos([["u-ana", 1, "2026-11-03", 15750]], "2026-11-30T15:00:00Z");   // 30 Nov 23:00 in Manila: the period's last day
    expect(await line(id, period.id)).toMatchObject({ status: "not-applicable", reason: "no-import-after-period" });

    await pos([], "2026-11-30T16:00:00Z");                                    // 1 Dec 00:00 in Manila
    expect(await line(id, period.id)).toMatchObject({ status: "scored", result: 75 });
  });

  it("is Not applicable with fewer than 5 present days, and scored with 5", async () => {
    const id = await switchedOn();
    const period = await ready(id, WEEKDAYS.slice(0, 4));
    await pos([["u-ana", 1, "2026-11-03", 4000]]);
    expect(await line(id, period.id)).toMatchObject({ status: "not-applicable", reason: "too-few-present-days" });

    await performance().importAttendance({ fileName: "more.csv", rows: [{ employeeNumber: "2026-001", date: WEEKDAYS[4], timeIn: "08:00", timeOut: "17:00" }] });
    expect(await line(id, period.id)).toMatchObject({ status: "scored", result: 80 });      // 4,000 ÷ 5 = 800 a day
  });

  it("leaves the Evaluation as it was while the set's sales weight is 0", async () => {
    const id = await employee();
    const period = await ready(id);
    await performance().setSalesTarget(1000);
    await performance().setPosGoLive("2026-10-01");
    await performance().saveWeightSet({ position: "Branch Cashier", weights: { ...SALES_SET, sales: 0, attendanceRate: 40 } });
    const detail = await performance().evaluationFor(id, period.id);

    expect(detail.kpis.map((k) => k.id)).toEqual(["attendanceRate", "punctuality", "fullShift", "trainingCompletion", "evaluatorRating"]);
    expect(detail.weights).not.toHaveProperty("sales");
    expect(detail.formulas.salesTarget).toBeUndefined();
  });
});

describe("a submitted Evaluation", () => {
  async function submitted() {
    const id = await switchedOn();
    const period = await ready(id);
    await pos([["u-ana", 1, "2026-11-03", 15750]]);
    const result = await performance().submitEvaluation(id, period.id);
    return { id, period, result };
  }

  it("saves the sales result, the sales formula text and the target with it, under the new rules version", async () => {
    const { id, period } = await submitted();
    const detail = await performance().evaluationFor(id, period.id);

    expect(detail.score).toEqual({ outcome: "scored", value: 93.5 });
    expect(detail.kpis.find((k) => k.id === "sales")).toMatchObject({ status: "scored", result: 75, points: 7.5 });
    expect(detail.submitted?.formulas).toMatchObject({ version: "2026-12", salesTarget: 1000, salesMinPresentDays: 5, kpis: { sales: expect.stringContaining("capped at 100") } });
  });

  it("does not change after a re-import, a new target or a link change", async () => {
    const { id, period } = await submitted();
    const before = await stored();
    const evaluated = await performance().evaluationFor(id, period.id);

    await pos([["u-ana", 1, "2026-11-03", 1]]);
    await performance().setSalesTarget(5000);
    await performance().saveWeightSet({ id: await cashierSet(), position: "Branch Cashier", weights: { ...SALES_SET, sales: 0, attendanceRate: 40 } });
    const link = (await performance().listPosAccounts(id))[0];
    await performance().unlinkPosAccount(link.id, { reason: "Wrong person linked" });

    expect(await performance().evaluationFor(id, period.id)).toEqual(evaluated);
    expect(await stored()).toBe(before);
  });

  it("scores a reopened one with the frozen weights, formula and target, and the links as they are then", async () => {
    const { id, period } = await submitted();
    await performance().setSalesTarget(5000);                                   // would be 15% if it applied
    await performance().saveWeightSet({ id: await cashierSet(), position: "Branch Cashier", weights: { ...SALES_SET, sales: 0, attendanceRate: 40 } });
    await performance().reopenEvaluation(id, period.id, "A bad import was corrected.");

    const reopened = await performance().evaluationFor(id, period.id);
    expect(reopened).toMatchObject({ status: "In review", rulesFrozen: true, score: { outcome: "scored", value: 93.5 } });
    expect(reopened.kpis.find((k) => k.id === "sales")).toMatchObject({ status: "scored", result: 75 });

    await pos([["u-ana", 1, "2026-11-04", 5250]]);                              // re-import: 21,000 in all, 1,000 a day
    expect((await line(id, period.id))?.result).toBe(100);

    const link = (await performance().listPosAccounts(id))[0];
    await performance().unlinkPosAccount(link.id, { reason: "Wrong person linked" });
    expect(await line(id, period.id)).toMatchObject({ status: "not-applicable", reason: "no-linked-account" });
  });
});
