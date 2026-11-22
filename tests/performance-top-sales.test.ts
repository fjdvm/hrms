import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TopSalesError, performanceFor } from "@/lib/performance";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
let count = 0;
let clock = new Date("2026-12-10T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock);
const NOV = { year: 2026, month: 11 };

beforeEach(async () => {
  count = 0;
  clock = new Date("2026-12-10T02:00:00Z");
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  portal = new FakePortal();
  handle = portal.signIn(staff, ["Performance"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  // A Branch Cashier set that weighs the sales KPI (the items carry the real weights; the legacy columns keep a valid total of their own).
  const id = (await db.query<{ id: number }>(`INSERT INTO hrms_weight_sets (name, position, position_key, attendance_rate, punctuality, full_shift, training_completion, evaluator_rating, created_by_id, created_by_name, updated_by_id, updated_by_name)
    VALUES ('Branch Cashier', 'Branch Cashier', 'branch cashier', 20, 20, 20, 20, 20, 'u', 'U', 'u', 'U') RETURNING id`)).rows[0].id;
  await db.query(`INSERT INTO hrms_weight_set_items (set_id, kpi_id, weight) VALUES ($1, 'attendanceRate', 30), ($1, 'punctuality', 20), ($1, 'fullShift', 10), ($1, 'trainingCompletion', 10), ($1, 'evaluatorRating', 20), ($1, 'sales', 10)`, [id]);
  await db.query(`INSERT INTO hrms_pos_locations (pos_location_id, name, pos_type, is_active, hrms_branch) VALUES (1, 'Cainta', 'Branch', true, 'Cainta branch'), (2, 'Antipolo', 'Branch', true, 'Antipolo branch'), (3, 'Bazaar Kiosk', 'Bazaar', true, NULL)`);
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

/** A cashier Employee, linked to the given POS accounts. */
async function cashier(name: string, accounts: string[], position = "Branch Cashier") {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count])).rows[0].id;
  const id = (await db.query<{ id: number }>(`INSERT INTO hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, $6, 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Active', 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, `emp${count}@example.test`, position])).rows[0].id;
  for (const account of accounts) await db.query(`INSERT INTO hrms_pos_account_links (portal_user_id, employee_id, linked_by_id, linked_by_name) VALUES ($1, $2, 'u', 'U')`, [account, id]);
  return id;
}
async function promote(id: number, position: string, date: string) {
  await db.query(`SELECT set_config('hrms.effective_date', $1, false)`, [date]);
  await db.query(`UPDATE hrms_employees SET position = $2 WHERE id = $1`, [id, position]);
  await db.query(`SELECT set_config('hrms.effective_date', '', false)`);
}
let importId = 0;
async function sell(account: string, location: number, date: string, net: number, orders = 1) {
  if (!importId) importId = (await db.query<{ id: number }>(`INSERT INTO hrms_pos_imports (range_from, range_to, days, orders, net_sales, unlinked_accounts, imported_by_id, imported_by_name, imported_at)
    VALUES ('2026-11-01', '2026-11-05', 0, 0, 0, 0, 'u', 'U', '2026-11-05T01:00:00Z') RETURNING id`)).rows[0].id;
  await db.query(`INSERT INTO hrms_pos_sales_daily VALUES ($1, $2, $3, $4, $5, 0, $5, $6) ON CONFLICT (portal_user_id, location_id, business_date) DO UPDATE SET orders = $4, gross_sales = $5, net_sales = $5`, [account, location, date, orders, net, importId]);
}
beforeEach(() => { importId = 0; });
const names = (rows: { name: string; rank: number }[]) => rows.map((r) => `${r.rank} ${r.name}`);

describe("Top sales", () => {
  it("ranks the cashiers of each branch by net sales, with orders and present days, and names the overall top seller", async () => {
    const ana = await cashier("Ana Cruz", ["u-ana"]);
    await cashier("Ben Reyes", ["u-ben"]);
    await cashier("Cai Lim", ["u-cai"]);
    await sell("u-ana", 1, "2026-11-03", 6000, 3); await sell("u-ana", 1, "2026-11-04", 4000, 2);
    await sell("u-ben", 1, "2026-11-03", 7000, 4);
    await sell("u-cai", 2, "2026-11-03", 12000, 5);
    const attendanceImport = (await db.query<{ id: number }>(`INSERT INTO hrms_performance_imports (file_name, total_rows, usable_rows, rejected_rows, imported_by_id, imported_by_name) VALUES ('ana.csv', 4, 4, 0, 'u', 'U') RETURNING id`)).rows[0].id;
    // Two present days in November, a day with a time-in only, and a day in December.
    await db.query(`INSERT INTO hrms_performance_attendance (employee_id, date, time_in, time_out, import_id) VALUES ($1, '2026-11-03', '08:00', '17:00', $2), ($1, '2026-11-04', '08:00', '17:00', $2), ($1, '2026-11-05', '08:00', NULL, $2), ($1, '2026-12-01', '08:00', '17:00', $2)`, [ana, attendanceImport]);

    const top = await performance().topSales(NOV);

    expect(top.month).toBe("2026-11");
    expect(top.range).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(top.branches.map((b) => [b.branch, b.mapped])).toEqual([["Antipolo branch", true], ["Cainta branch", true]]);
    expect(top.branches[1].ranking).toEqual([
      { rank: 1, employeeId: ana, employeeNumber: "2026-001", name: "Ana Cruz", netSales: 10000, orders: 5, presentDays: 2 },
      { rank: 2, employeeId: expect.any(Number), employeeNumber: "2026-002", name: "Ben Reyes", netSales: 7000, orders: 4, presentDays: 0 }]);
    expect(names(top.branches[0].ranking)).toEqual(["1 Cai Lim"]);
    expect(top.overall).toEqual([expect.objectContaining({ rank: 1, name: "Cai Lim", netSales: 12000 })]);
    expect(top.notShown).toEqual({ unlinkedAccounts: 0, notCashiers: 0 });
  });

  it("lets ties share a rank and skips the next one", async () => {
    await cashier("Ana Cruz", ["u-ana"]); await cashier("Ben Reyes", ["u-ben"]); await cashier("Cai Lim", ["u-cai"]); await cashier("Dee Ong", ["u-dee"]);
    await sell("u-ana", 1, "2026-11-03", 5000); await sell("u-ben", 1, "2026-11-03", 5000); await sell("u-cai", 1, "2026-11-03", 3000); await sell("u-dee", 1, "2026-11-03", 3000);

    const top = await performance().topSales(NOV);

    expect(names(top.branches[0].ranking)).toEqual(["1 Ana Cruz", "1 Ben Reyes", "3 Cai Lim", "3 Dee Ong"]);
    expect(names(top.overall)).toEqual(["1 Ana Cruz", "1 Ben Reyes"]);
  });

  it("ranks a cashier who sold at two branches under each with that branch's sales, and by their total overall", async () => {
    await cashier("Ana Cruz", ["u-ana"]); await cashier("Ben Reyes", ["u-ben"]);
    await sell("u-ana", 1, "2026-11-03", 4000, 2); await sell("u-ana", 2, "2026-11-04", 3000, 1);
    await sell("u-ben", 1, "2026-11-03", 5000, 3);

    const top = await performance().topSales(NOV);

    expect(top.branches.map((b) => [b.branch, ...b.ranking.map((r) => `${r.rank} ${r.name} ${r.netSales}/${r.orders}`)])).toEqual([
      ["Antipolo branch", "1 Ana Cruz 3000/1"], ["Cainta branch", "1 Ben Reyes 5000/3", "2 Ana Cruz 4000/2"]]);
    expect(top.overall).toEqual([expect.objectContaining({ name: "Ana Cruz", netSales: 7000, orders: 3 })]);
  });

  it("adds an Employee's accounts together, and POS branches mapped to one HRMS branch are one group", async () => {
    await db.query(`UPDATE hrms_pos_locations SET hrms_branch = 'Cainta branch' WHERE pos_location_id = 2`);
    await cashier("Ana Cruz", ["u-ana", "u-ana-2"]); await cashier("Ben Reyes", ["u-ben"]);
    await sell("u-ana", 1, "2026-11-03", 2000); await sell("u-ana-2", 2, "2026-11-04", 2500); await sell("u-ben", 1, "2026-11-03", 4000);

    const top = await performance().topSales(NOV);

    expect(top.branches.map((b) => b.branch)).toEqual(["Cainta branch"]);
    expect(top.branches[0].ranking.map((r) => `${r.rank} ${r.name} ${r.netSales}`)).toEqual(["1 Ana Cruz 4500", "2 Ben Reyes 4000"]);
  });

  it("lists a branch that is not mapped yet under its POS name, marked as not mapped", async () => {
    await cashier("Ana Cruz", ["u-ana"]);
    await sell("u-ana", 3, "2026-11-03", 900);

    expect((await performance().topSales(NOV)).branches).toEqual([{ branch: "Bazaar Kiosk", mapped: false, ranking: [expect.objectContaining({ name: "Ana Cruz", netSales: 900 })] }]);
  });

  it("counts an account with no linked Employee, and an Employee who was not a cashier, as not shown", async () => {
    await cashier("Ana Cruz", ["u-ana"]); await cashier("Ben Reyes", ["u-ben"], "Barista");
    await sell("u-ana", 1, "2026-11-03", 1000); await sell("u-ben", 1, "2026-11-03", 9000); await sell("u-nobody", 1, "2026-11-03", 8000); await sell("u-nobody-2", 2, "2026-11-03", 100);

    const top = await performance().topSales(NOV);

    expect(names(top.branches[0].ranking)).toEqual(["1 Ana Cruz"]);
    expect(top.notShown).toEqual({ unlinkedAccounts: 2, notCashiers: 1 });
  });

  it("uses the position held on the last day of the month: promoted mid-month is not ranked, promoted after it still is", async () => {
    const ben = await cashier("Ben Reyes", ["u-ben"]); const cai = await cashier("Cai Lim", ["u-cai"]); await cashier("Ana Cruz", ["u-ana"]);
    for (const account of ["u-ana", "u-ben", "u-cai"]) await sell(account, 1, "2026-11-03", 1000);
    await promote(ben, "Branch Supervisor", "2026-11-20");   // before the month ended: not a cashier on 30 November
    await promote(cai, "Branch Supervisor", "2026-12-05");   // after it: still a cashier on 30 November

    const top = await performance().topSales(NOV);

    expect(names(top.branches[0].ranking)).toEqual(["1 Ana Cruz", "1 Cai Lim"]);
    expect(top.notShown.notCashiers).toBe(1);
    expect(top.positionDate).toBe("2026-11-30");
  });

  it("reads positions today for the month in progress, which is always Provisional", async () => {
    const ben = await cashier("Ben Reyes", ["u-ben"]); await cashier("Ana Cruz", ["u-ana"]);
    await sell("u-ana", 1, "2026-12-03", 1000); await sell("u-ben", 1, "2026-12-03", 2000);
    await promote(ben, "Branch Supervisor", "2026-12-05");

    const top = await performance().topSales({ year: 2026, month: 12 });

    expect(top).toMatchObject({ positionDate: "2026-12-10", provisional: true, range: { from: "2026-12-01", to: "2026-12-31" } });
    expect(names(top.branches[0].ranking)).toEqual(["1 Ana Cruz"]);
    expect(top.notShown.notCashiers).toBe(1);
  });

  it("has an empty result for a month with no sales", async () => {
    expect(await performance().topSales({ year: 2026, month: 10 })).toMatchObject({ branches: [], overall: [], notShown: { unlinkedAccounts: 0, notCashiers: 0 } });
  });
});

describe("the Provisional rule", () => {
  const importRan = (from: string, to: string, at: string) => db.query(`INSERT INTO hrms_pos_imports (range_from, range_to, days, orders, net_sales, unlinked_accounts, imported_by_id, imported_by_name, imported_at) VALUES ($1, $2, 0, 0, 0, 0, 'u', 'U', $3)`, [from, to, at]);
  const provisional = async () => (await performance().topSales(NOV)).provisional;

  it("is Provisional until an import run after the month ended has re-read all of it", async () => {
    expect(await provisional()).toBe(true);
    await importRan("2026-10-01", "2026-11-30", "2026-11-30T15:00:00Z");   // 30 Nov 23:00 in Manila: ran before the month ended
    expect(await provisional()).toBe(true);
    await importRan("2026-12-01", "2026-12-31", "2026-12-02T01:00:00Z");   // ran after, but its range does not cover November
    expect(await provisional()).toBe(true);

    await importRan("2026-11-01", "2026-12-31", "2026-11-30T16:00:00Z");   // 1 Dec 00:00 in Manila, covering November
    expect(await provisional()).toBe(false);
  });

  it("counts an import that started at the go-live date as covering the month", async () => {
    await db.query(`INSERT INTO hrms_performance_settings (key, value, updated_by_id, updated_by_name) VALUES ('pos_go_live_date', '2026-11-12', 'u', 'U')`);
    await importRan("2026-11-12", "2026-12-31", "2026-12-02T01:00:00Z");

    expect(await provisional()).toBe(false);
  });
});

describe("a read only model", () => {
  it("stores nothing and touches no Evaluation or audit row", async () => {
    await cashier("Ana Cruz", ["u-ana"]); await sell("u-ana", 1, "2026-11-03", 1000);
    const tables = ["hrms_pos_sales_daily", "hrms_pos_imports", "hrms_pos_locations", "hrms_pos_account_links", "hrms_evaluations", "hrms_evaluation_submissions", "hrms_performance_audit", "hrms_performance_settings", "hrms_employees"];
    const snapshot = async () => JSON.stringify(await Promise.all(tables.map(async (table) => (await db.query(`SELECT * FROM ${table}`)).rows)));
    const before = await snapshot();

    await performance().topSales(NOV);

    expect(await snapshot()).toBe(before);
  });

  it("refuses a month that is not a calendar month or is still to come, and a session without the Performance Module", async () => {
    for (const bad of [{ year: 2026, month: 13 }, { year: 2026, month: 0 }, { year: 1999, month: 5 }, { year: 2026.5, month: 5 }, undefined as never]) {
      await expect(performance().topSales(bad)).rejects.toBeInstanceOf(TopSalesError);
    }
    await expect(performance().topSales({ year: 2027, month: 1 })).rejects.toMatchObject({ problem: "month-in-future" });
    const other = performance(portal.signIn({ ...staff, id: "u-bo", username: "bo", name: "Bo Lee" }, ["Applications"]));
    await expect(other.topSales(NOV)).rejects.toThrow();
  });
});
