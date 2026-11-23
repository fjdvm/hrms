import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { performanceFor } from "@/lib/performance";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
let count = 0;
const clock = new Date("2026-12-10T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock);

beforeEach(async () => {
  count = 0;
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  portal = new FakePortal();
  handle = portal.signIn(staff, ["Performance"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const id = (await db.query<{ id: number }>(`INSERT INTO hrms_weight_sets (name, position, position_key, attendance_rate, punctuality, full_shift, training_completion, evaluator_rating, created_by_id, created_by_name, updated_by_id, updated_by_name)
    VALUES ('Branch Cashier', 'Branch Cashier', 'branch cashier', 20, 20, 20, 20, 20, 'u', 'U', 'u', 'U') RETURNING id`)).rows[0].id;
  await db.query(`INSERT INTO hrms_weight_set_items (set_id, kpi_id, weight) VALUES ($1, 'attendanceRate', 30), ($1, 'punctuality', 20), ($1, 'fullShift', 10), ($1, 'trainingCompletion', 10), ($1, 'evaluatorRating', 20), ($1, 'sales', 10)`, [id]);
  await db.query(`INSERT INTO hrms_pos_locations (pos_location_id, name, pos_type, is_active, hrms_branch) VALUES (1, 'Cainta', 'Branch', true, 'Cainta branch'), (2, 'Taytay', 'Branch', true, NULL)`);
  await db.query(`INSERT INTO hrms_pos_imports (range_from, range_to, days, orders, net_sales, unlinked_accounts, imported_by_id, imported_by_name) VALUES ('2026-11-01', '2026-12-31', 0, 0, 0, 0, 'u', 'U')`);
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function employee(name: string, position = "Branch Cashier", status = "Active") {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, $6, 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', $7, 'Ada') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, `emp${count}@example.test`, position, status])).rows[0].id;
}
const sell = (account: string, location: number, date: string, net: number, orders = 1) =>
  db.query(`INSERT INTO hrms_pos_sales_daily VALUES ($1, $2, $3, $4, $5, 0, $5, 1) ON CONFLICT (portal_user_id, location_id, business_date) DO UPDATE SET orders = $4, gross_sales = $5, net_sales = $5`, [account, location, date, orders, net]);
const account = (id: string, staffNumber: number) => db.query(`INSERT INTO hrms_pos_accounts (portal_user_id, staff_number) VALUES ($1, $2)`, [id, staffNumber]);

describe("POS accounts that need linking", () => {
  it("lists each account with sales and no Employee, the biggest first, with its branch, staff number, orders and net sales", async () => {
    await account("u-rob", 1004); await account("u-liz", 1012);
    await sell("u-rob", 1, "2026-11-03", 5000, 10); await sell("u-rob", 1, "2026-12-02", 1500.5, 4);
    await sell("u-liz", 2, "2026-11-10", 12480, 38);

    expect(await performance().posAccountsNeedingLink()).toEqual([
      { portalUserId: "u-liz", name: null, staffNumber: "1012", branch: "Taytay", orders: 38, netSales: 12480, from: "2026-11-10", to: "2026-11-10" },
      { portalUserId: "u-rob", name: null, staffNumber: "1004", branch: "Cainta branch", orders: 14, netSales: 6500.5, from: "2026-11-03", to: "2026-12-02" }]);
  });

  it("names an account from the Portal directory, and carries only the staff number and branch when there is no match", async () => {
    portal.directory = [{ id: "u-rob", username: "rob", name: "Roberto Dela Cruz", modules: [] }];
    await account("u-rob", 1004); await account("u-liz", 1012);
    await sell("u-rob", 1, "2026-11-03", 5000); await sell("u-liz", 1, "2026-11-03", 100);

    const rows = await performance().posAccountsNeedingLink();
    expect(rows.map((r) => [r.portalUserId, r.name, r.staffNumber, r.branch])).toEqual([["u-rob", "Roberto Dela Cruz", "1004", "Cainta branch"], ["u-liz", null, "1012", "Cainta branch"]]);
  });

  it("uses the branch where the account sold the most", async () => {
    await account("u-rob", 1004);
    await sell("u-rob", 1, "2026-11-03", 100); await sell("u-rob", 2, "2026-11-04", 900);

    expect((await performance().posAccountsNeedingLink())[0].branch).toBe("Taytay");
  });

  it("leaves out an account that is linked, brings it back when it is unlinked, and shows an account with no staff number row", async () => {
    const ana = await employee("Ana Cruz");
    await account("u-ana", 1001);
    await sell("u-ana", 1, "2026-11-03", 800); await sell("u-nobody", 1, "2026-11-03", 50);
    const link = await performance().linkPosAccount({ employeeId: ana, portalUserId: "u-ana" });

    expect((await performance().posAccountsNeedingLink()).map((r) => r.portalUserId)).toEqual(["u-nobody"]);
    expect((await performance().posAccountsNeedingLink())[0].staffNumber).toBeNull();
    await performance().unlinkPosAccount(link.id, { reason: "Wrong person linked" });
    expect((await performance().posAccountsNeedingLink()).map((r) => r.portalUserId)).toEqual(["u-ana", "u-nobody"]);
  });

  it("is empty when every account is linked or nothing is imported", async () => {
    expect(await performance().posAccountsNeedingLink()).toEqual([]);
  });
});

describe("the Employees the picker offers", () => {
  it("shows every active Employee, marks cashiers, and counts each one's POS accounts", async () => {
    const carla = await employee("Carla Mendoza"); await employee("Carla Reyes"); await employee("Carlos Mendoza", "Production Staff"); await employee("Dee Gone", "Branch Cashier", "Onboarding");
    await sell("u-c", 1, "2026-11-03", 10);
    await performance().linkPosAccount({ employeeId: carla, portalUserId: "u-c" });

    expect((await performance().posLinkCandidates()).map((c) => [c.name, c.employeeNumber, c.position, c.cashier, c.accounts])).toEqual([
      ["Carla Mendoza", "2026-001", "Branch Cashier", true, 1], ["Carla Reyes", "2026-002", "Branch Cashier", true, 0], ["Carlos Mendoza", "2026-003", "Production Staff", false, 0]]);
  });

  it("judges a cashier by today's position, and offers no cashier when no set weighs sales", async () => {
    const ana = await employee("Ana Cruz");
    expect((await performance().posLinkCandidates())[0].cashier).toBe(true);
    await db.query(`UPDATE hrms_weight_set_items SET weight = CASE kpi_id WHEN 'sales' THEN 0 WHEN 'attendanceRate' THEN 40 ELSE weight END
      WHERE set_id = (SELECT id FROM hrms_weight_sets WHERE position = 'Branch Cashier') AND kpi_id IN ('sales', 'attendanceRate')`);

    expect((await performance().posLinkCandidates()).find((c) => c.id === ana)?.cashier).toBe(false);
  });
});

describe("access", () => {
  it("needs the Performance Module for both reads", async () => {
    const other = performance(portal.signIn({ ...staff, id: "u-bo", username: "bo", name: "Bo Lee" }, ["Applications"]));

    await expect(other.posAccountsNeedingLink()).rejects.toThrow();
    await expect(other.posLinkCandidates()).rejects.toThrow();
  });
});
