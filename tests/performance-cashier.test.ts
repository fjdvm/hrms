import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cashierModule } from "@/lib/performance-cashier";

let db: PGlite;
let count = 0;
const cashier = () => cashierModule(db);

beforeEach(async () => {
  count = 0;
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
});
afterEach(async () => { if (!db.closed) await db.close(); });

async function employee(name: string, position: string) {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, $6, 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Active', 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, `emp${count}@example.test`, position])).rows[0].id;
}
/** A position change that took effect on `date`, recorded in the history the way an edit records it. */
async function changePosition(id: number, position: string, date: string) {
  await db.query(`SELECT set_config('hrms.effective_date', $1, false)`, [date]);
  await db.query(`UPDATE hrms_employees SET position = $2 WHERE id = $1`, [id, position]);
  await db.query(`SELECT set_config('hrms.effective_date', '', false)`);
}
/** The sales KPI, and a position set that weighs it. The items carry the real weights (total 100); the legacy columns, which cannot hold a sixth weight, keep a valid total of their own. */
async function salesSet(position: string, sales: number) {
  await db.query(`INSERT INTO hrms_kpis (id, name, description, source, target, sort_order) VALUES ('sales', 'Sales', 'Net sales per present day', 'POS', '100%', 6) ON CONFLICT DO NOTHING`);
  const id = (await db.query<{ id: number }>(`INSERT INTO hrms_weight_sets (name, position, position_key, attendance_rate, punctuality, full_shift, training_completion, evaluator_rating, created_by_id, created_by_name, updated_by_id, updated_by_name)
    VALUES ($1, $1, lower(btrim(regexp_replace($1, '\\s+', ' ', 'g'))), 20, 20, 20, 20, 20, 'u', 'U', 'u', 'U') RETURNING id`, [position])).rows[0].id;
  await db.query(`INSERT INTO hrms_weight_set_items (set_id, kpi_id, weight) VALUES ($1, 'attendanceRate', $2), ($1, 'punctuality', 20), ($1, 'fullShift', 10), ($1, 'trainingCompletion', 10), ($1, 'evaluatorRating', 20), ($1, 'sales', $3)`, [id, 40 - sales, sales]);
}
const BEFORE = "2026-11-30", AFTER = "2026-12-31", TODAY = "2026-12-20";

describe("the Cashier rule", () => {
  it("is a cashier on a date when the position then matches a set that weighs sales above 0", async () => {
    await salesSet("Branch Cashier", 10);
    const ana = await employee("Ana Cruz", "Branch Cashier");
    const ben = await employee("Ben Reyes", "Barista");

    expect(await cashier().isCashierOn(ana, TODAY)).toBe(true);
    expect(await cashier().isCashierOn(ben, TODAY)).toBe(false);
    expect([...(await cashier().cashiersOn(TODAY))]).toEqual([ana]);
  });

  it("uses the position held on that date: promoted on 5 December, a cashier on 30 November and not on 31 December", async () => {
    await salesSet("Branch Cashier", 10);
    const ana = await employee("Ana Cruz", "Branch Cashier");
    await changePosition(ana, "Branch Supervisor", "2026-12-05");

    expect(await cashier().isCashierOn(ana, BEFORE)).toBe(true);
    expect(await cashier().isCashierOn(ana, "2026-12-04")).toBe(true);
    expect(await cashier().isCashierOn(ana, "2026-12-05")).toBe(false);
    expect(await cashier().isCashierOn(ana, AFTER)).toBe(false);
    expect(await cashier().isCashierOn(ana, TODAY)).toBe(false);
  });

  it("follows a chain of changes: cashier, then supervisor, then back to cashier", async () => {
    await salesSet("Branch Cashier", 10);
    const ana = await employee("Ana Cruz", "Branch Cashier");
    await changePosition(ana, "Branch Supervisor", "2026-12-05");
    await changePosition(ana, "Branch Cashier", "2026-12-15");

    expect(await cashier().isCashierOn(ana, "2026-12-10")).toBe(false);
    expect(await cashier().isCashierOn(ana, BEFORE)).toBe(true);
    expect(await cashier().isCashierOn(ana, AFTER)).toBe(true);
  });

  it("matches a mistyped position only by case and extra spaces, never by guessing", async () => {
    await salesSet("Branch Cashier", 10);
    const spaced = await employee("Ana Cruz", "  branch   CASHIER ");
    const typo = await employee("Ben Reyes", "Branch Casheir");
    const partial = await employee("Cai Lim", "Branch Cashier Trainee");

    expect(await cashier().isCashierOn(spaced, TODAY)).toBe(true);
    expect(await cashier().isCashierOn(typo, TODAY)).toBe(false);
    expect(await cashier().isCashierOn(partial, TODAY)).toBe(false);
  });

  it("is nobody when the set gives sales weight 0, when no set weighs sales, or when there is no sales KPI", async () => {
    const ana = await employee("Ana Cruz", "Branch Cashier");
    expect(await cashier().isCashierOn(ana, TODAY)).toBe(false);
    expect((await cashier().cashiersOn(TODAY)).size).toBe(0);

    await salesSet("Branch Cashier", 0);
    expect(await cashier().isCashierOn(ana, TODAY)).toBe(false);

    await db.query(`UPDATE hrms_weight_set_items SET weight = weight + CASE kpi_id WHEN 'sales' THEN 10 WHEN 'attendanceRate' THEN -10 ELSE 0 END WHERE kpi_id IN ('sales', 'attendanceRate') AND set_id = (SELECT id FROM hrms_weight_sets WHERE position = 'Branch Cashier')`);
    expect(await cashier().isCashierOn(ana, TODAY)).toBe(true);
  });

  it("never makes everyone a cashier through the default set", async () => {
    await db.query(`INSERT INTO hrms_kpis (id, name, description, source, target, sort_order) VALUES ('sales', 'Sales', 'x', 'POS', '100%', 6)`);
    await db.query(`INSERT INTO hrms_weight_set_items (set_id, kpi_id, weight) SELECT id, 'sales', 0 FROM hrms_weight_sets`);
    await db.query(`UPDATE hrms_weight_set_items SET weight = CASE kpi_id WHEN 'sales' THEN 10 WHEN 'attendanceRate' THEN 20 ELSE weight END WHERE kpi_id IN ('sales', 'attendanceRate')`);
    const ben = await employee("Ben Reyes", "Barista");

    expect(await cashier().isCashierOn(ben, TODAY)).toBe(false);
  });

  it("refuses a date that is not a calendar date", async () => {
    await expect(cashier().cashiersOn("2026-13-45")).rejects.toThrow(RangeError);
    await expect(cashier().cashiersOn("30 November")).rejects.toThrow(RangeError);
  });
});
