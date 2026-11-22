import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GoLiveError, ImportError, performanceFor } from "@/lib/performance";
import type { PosConnect } from "@/lib/pos-connection";
import { posReader } from "@/lib/pos-reader";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let pos: PGlite;
let portal: FakePortal;
let handle: string;
let ids = 0;
let connects = 0;
let down = false;
const clock = new Date("2026-12-01T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const connect: PosConnect = async () => {
  connects += 1;
  if (down) throw new (await import("@/lib/pos-connection")).PosReadError("unreachable", [], "ECONNREFUSED");
  return { session: { query: async <T>(sql: string, values?: unknown[]) => ({ rows: (await pos.query(sql, values)).rows as T[] }) }, close: async () => {} };
};
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock, {}, undefined, posReader(connect, async () => {}));

beforeEach(async () => {
  ids = 0; connects = 0; down = false;
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  pos = new PGlite();
  await pos.exec(await readFile(new URL("./fixtures/pos-granted-tables.sql", import.meta.url), "utf8"));
  await pos.exec(`INSERT INTO "PosStaffUsers" VALUES (1000, 'u-ana'), (1001, 'u-ben'), (1, 'u-legacy');
    INSERT INTO "Locations" VALUES (1, 'Cainta', 'Branch', true), (2, 'Bazaar Kiosk', 'Bazaar', true)`);
  portal = new FakePortal();
  handle = portal.signIn(staff, ["Performance"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => { for (const database of [db, pos]) if (!database.closed) await database.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function sale(at: string, { staff = 1000, total = 300, status = "Completed", location = 1 } = {}) {
  const id = ++ids;
  await pos.query(`INSERT INTO "Orders" VALUES ($1, 'POS', 'Store', $2, $3, $4, $5, NULL, $6, $6)`, [id, status, total, staff, location, at]);
  await pos.query(`INSERT INTO "OrderItems" VALUES ($1, $2, 10, 1, $3, $3)`, [id + 1000, id, total]);
  return id;
}
const stored = async () => (await db.query<{ portal_user_id: string; location_id: number; business_date: string; orders: number; gross_sales: string; refund_amount: string; net_sales: string }>(
  `SELECT portal_user_id, location_id, business_date::text, orders, gross_sales::text, refund_amount::text, net_sales::text FROM hrms_pos_sales_daily ORDER BY business_date, location_id, portal_user_id`)).rows;
const count = async (table: string) => Number((await db.query<{ n: string }>(`SELECT count(*)::text AS n FROM ${table}`)).rows[0].n);
const audit = async () => (await db.query<{ actor_id: string; actor_name: string; action: string; subject: string; subject_id: string; detail: Record<string, unknown> }>(
  `SELECT actor_id, actor_name, action, subject, subject_id, detail FROM hrms_performance_audit WHERE action LIKE 'pos-%' ORDER BY id`)).rows;
const importError = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(ImportError);
  return error as ImportError;
};

describe("the go-live date", () => {
  it("is unset at first, and is set, validated and audited with the Staff member", async () => {
    expect(await performance().posGoLive()).toBeNull();
    const set = await performance().setPosGoLive("2026-11-10");

    expect(set).toMatchObject({ date: "2026-11-10", setByName: "Ada Okafor" });
    expect(await performance().posGoLive()).toMatchObject({ date: "2026-11-10" });
    expect(await audit()).toEqual([{ actor_id: "u-ada", actor_name: "Ada Okafor", action: "pos-go-live-date-set", subject: "setting", subject_id: "pos_go_live_date", detail: { from: null, to: "2026-11-10" } }]);

    await performance().setPosGoLive("2026-11-10");
    expect(await audit()).toHaveLength(1);
    await performance().setPosGoLive("2026-11-12");
    expect((await audit())[1].detail).toEqual({ from: "2026-11-10", to: "2026-11-12" });
    for (const bad of ["2026-02-30", "10 November", "", undefined, 20261110]) await expect(performance().setPosGoLive(bad)).rejects.toBeInstanceOf(GoLiveError);
    expect(await audit()).toHaveLength(2);
  });
});

describe("the import is blocked until the go-live date is set", () => {
  it("refuses a preview and an import without reading the POS or saving anything", async () => {
    await sale("2026-11-20T02:00:00Z");

    expect((await importError(performance().previewPosImport())).problem).toBe("go-live-not-set");
    expect((await importError(performance().importPosSales())).problem).toBe("go-live-not-set");
    expect(connects).toBe(0);
    expect(await count("hrms_pos_sales_daily")).toBe(0);
    expect(await count("hrms_pos_imports")).toBe(0);
  });

  it("refuses a go-live date still ahead of the months it would read", async () => {
    await performance().setPosGoLive("2027-02-01");

    expect((await importError(performance().previewPosImport())).problem).toBe("go-live-not-reached");
    expect(connects).toBe(0);
  });
});

describe("preview and confirm", () => {
  beforeEach(async () => {
    await performance().setPosGoLive("2026-11-10");
  });

  it("previews the months, orders, net sales, accounts, schema check and orders left out, and saves nothing", async () => {
    await sale("2026-11-12T02:00:00Z", { total: 300 });
    await sale("2026-11-12T03:00:00Z", { total: 100 });
    await sale("2026-12-01T02:00:00Z", { staff: 1001, total: 500, location: 2 });
    await sale("2026-11-12T02:00:00Z", { staff: 1, total: 50 });
    await sale("2026-11-12T02:00:00Z", { status: "Voided", total: 70 });
    portal.directory = [{ id: "u-ben", username: "ben", name: "Ben Reyes", modules: [] }];

    const preview = await performance().previewPosImport();

    expect(preview).toEqual({
      range: { from: "2026-11-10", to: "2026-12-31" }, goLiveDate: "2026-11-10",
      months: [{ month: "2026-11", orders: 2, netSales: 400 }, { month: "2026-12", orders: 1, netSales: 500 }],
      totals: { days: 2, orders: 3, grossSales: 900, refundAmount: 0, netSales: 900 },
      accounts: { linked: 0, unlinked: [
        { portalUserId: "u-ben", name: "Ben Reyes", staffNumber: "1001", branch: "Bazaar Kiosk", orders: 1, netSales: 500 },
        { portalUserId: "u-ana", name: null, staffNumber: "1000", branch: "Cainta", orders: 2, netSales: 400 }] },
      leftOut: { orders: 1, grossSales: 50 }, schemaCheck: "passed",
    });
    expect(await count("hrms_pos_sales_daily")).toBe(0);
    expect(await count("hrms_pos_imports")).toBe(0);
    expect(await count("hrms_pos_locations")).toBe(0);
    expect(await audit()).toHaveLength(1);
  });

  it("counts a linked account as linked", async () => {
    await sale("2026-11-12T02:00:00Z");
    await pos.query(`UPDATE "Locations" SET "LocationName" = 'Cainta branch' WHERE "LocationId" = 1`);
    const offer = (await db.query<{ id: number }>(`INSERT INTO hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
      VALUES (1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`)).rows[0].id;
    const employee = (await db.query<{ id: number }>(`INSERT INTO hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name)
      VALUES ('2026-001', $1, 1, 'Ana Cruz', 'ana@example.test', 'Branch Cashier', 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Active', 'Ada') RETURNING id`, [offer])).rows[0].id;
    await db.query(`INSERT INTO hrms_pos_account_links (portal_user_id, employee_id, linked_by_id, linked_by_name) VALUES ('u-ana', $1, 'u', 'U')`, [employee]);

    expect((await performance().previewPosImport()).accounts).toEqual({ linked: 1, unlinked: [] });
  });

  it("saves on confirm in one go: the figures, the branches, the import record and the audit, and nothing before the go-live date", async () => {
    await sale("2026-11-05T02:00:00Z", { total: 999 });
    await sale("2026-11-12T02:00:00Z", { total: 300 });
    await sale("2026-11-12T03:00:00Z", { total: 100 });
    await sale("2026-12-01T02:00:00Z", { staff: 1001, total: 500, location: 2 });

    const saved = await performance().importPosSales();

    expect(saved).toMatchObject({ range: { from: "2026-11-10", to: "2026-12-31" }, days: 2, orders: 3, netSales: 900, removedDays: 0, importedByName: "Ada Okafor" });
    expect(await stored()).toEqual([
      { portal_user_id: "u-ana", location_id: 1, business_date: "2026-11-12", orders: 2, gross_sales: "400.00", refund_amount: "0.00", net_sales: "400.00" },
      { portal_user_id: "u-ben", location_id: 2, business_date: "2026-12-01", orders: 1, gross_sales: "500.00", refund_amount: "0.00", net_sales: "500.00" }]);
    expect((await db.query(`SELECT pos_location_id, name, pos_type, hrms_branch FROM hrms_pos_locations ORDER BY 1`)).rows).toEqual([
      { pos_location_id: 1, name: "Cainta", pos_type: "Branch", hrms_branch: null }, { pos_location_id: 2, name: "Bazaar Kiosk", pos_type: "Bazaar", hrms_branch: null }]);
    expect(await performance().listPosImports()).toEqual([expect.objectContaining({ id: saved.id, from: "2026-11-10", to: "2026-12-31", days: 2, orders: 3, netSales: 900, unlinkedAccounts: 2, importedByName: "Ada Okafor" })]);
    expect((await audit())[1]).toEqual({ actor_id: "u-ada", actor_name: "Ada Okafor", action: "pos-sales-imported", subject: "pos-import", subject_id: String(saved.id),
      detail: { from: "2026-11-10", to: "2026-12-31", days: 2, orders: 3, netSales: 900, unlinkedAccounts: 2 } });
  });

  it("holds no customer data, order number or order line: only the aggregates", async () => {
    const columns = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'hrms_pos_sales_daily' ORDER BY ordinal_position`)).rows.map((r) => r.column_name);

    expect(columns).toEqual(["portal_user_id", "location_id", "business_date", "orders", "gross_sales", "refund_amount", "net_sales", "import_id"]);
  });

  it("upserts on a re-import, removes a day the POS no longer returns, and leaves days outside the range alone", async () => {
    const a = await sale("2026-11-12T02:00:00Z", { total: 300 });
    const b = await sale("2026-11-13T02:00:00Z", { total: 200 });
    await db.query(`INSERT INTO hrms_pos_imports (range_from, range_to, days, orders, net_sales, unlinked_accounts, imported_by_id, imported_by_name) VALUES ('2026-09-01', '2026-10-31', 1, 1, 80, 0, 'u', 'U')`);
    await db.query(`INSERT INTO hrms_pos_sales_daily VALUES ('u-ana', 1, '2026-09-15', 1, 80, 0, 80, 1)`);
    await performance().importPosSales();

    await pos.query(`UPDATE "Orders" SET "OrderStatus" = 'Voided' WHERE "OrderId" = $1`, [b]);
    await pos.query(`UPDATE "Orders" SET "TotalAmount" = 350 WHERE "OrderId" = $1`, [a]);
    await sale("2026-11-12T05:00:00Z", { total: 40 });
    const again = await performance().importPosSales();

    expect(again.removedDays).toBe(1);
    expect((await stored()).map((r) => [r.business_date, r.orders, r.net_sales])).toEqual([["2026-09-15", 1, "80.00"], ["2026-11-12", 2, "390.00"]]);
    expect(await count("hrms_pos_imports")).toBe(3);
    expect(await count("hrms_pos_locations")).toBe(2);
  });
});

describe("errors save nothing", () => {
  beforeEach(async () => {
    await performance().setPosGoLive("2026-11-10");
    await sale("2026-11-12T02:00:00Z");
  });
  const nothingSaved = async () => {
    expect(await count("hrms_pos_sales_daily")).toBe(0);
    expect(await count("hrms_pos_imports")).toBe(0);
    expect(await count("hrms_pos_locations")).toBe(0);
    expect((await audit()).map((row) => row.action)).toEqual(["pos-go-live-date-set"]);
  };

  it("when the POS is unreachable, after the one retry", async () => {
    down = true;

    expect((await importError(performance().importPosSales())).problem).toBe("pos-unreachable");
    expect((await importError(performance().previewPosImport())).problem).toBe("pos-unreachable");
    expect(connects).toBe(4);
    await nothingSaved();
  });

  it("when the POS data changed, naming the column", async () => {
    await pos.exec(`ALTER TABLE "Orders" DROP COLUMN "ApprovedAt"`);

    const error = await importError(performance().importPosSales());
    expect(error).toMatchObject({ problem: "pos-data-changed", problems: ["Orders.ApprovedAt: missing or not readable"] });
    await nothingSaved();
  });

  it("when no connection string is set", async () => {
    const unset = performanceFor(handle, db, () => clock, {}, undefined, posReader(async () => { throw new (await import("@/lib/pos-connection")).PosReadError("not-configured"); }, async () => {}));

    expect((await importError(unset.importPosSales())).problem).toBe("pos-not-configured");
    await nothingSaved();
  });
});

describe("access", () => {
  it("needs the Performance Module for every POS import operation", async () => {
    const other = performance(portal.signIn({ ...staff, id: "u-bo", username: "bo", name: "Bo Lee" }, ["Applications"]));

    await expect(other.setPosGoLive("2026-11-10")).rejects.toThrow();
    await expect(other.previewPosImport()).rejects.toThrow();
    await expect(other.importPosSales()).rejects.toThrow();
    await expect(other.posGoLive()).rejects.toThrow();
    expect(await count("hrms_performance_settings")).toBe(0);
  });
});
