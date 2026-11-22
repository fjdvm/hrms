import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectFromEnv, PosReadError, withPos, type PosConnect } from "@/lib/pos-connection";
import { posReader } from "@/lib/pos-reader";

let db: PGlite;
let ids = 0;
const connect: PosConnect = async () => ({ session: { query: async <T>(sql: string, values?: unknown[]) => ({ rows: (await db.query(sql, values)).rows as T[] }) }, close: async () => {} });
const reader = () => posReader(connect, async () => {});
const NOV = { from: "2026-11-01", to: "2026-11-30" };

beforeEach(async () => {
  ids = 0;
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/pos-granted-tables.sql", import.meta.url), "utf8"));
  await db.exec(`INSERT INTO "PosStaffUsers" VALUES (1000, 'u-ana'), (1001, 'u-ben'), (1, 'u-legacy');
    INSERT INTO "Locations" VALUES (1, 'Cainta', 'Branch', true), (2, 'Bazaar Kiosk', 'Bazaar', true), (999, 'E-commerce', 'Online', true)`);
});
afterEach(async () => { if (!db.closed) await db.close(); });

type OrderInput = { staff?: number; at: string; total?: number; status?: string; type?: string; source?: string; location?: number | null; approvedAt?: string | null; items?: [number, number, number][] };
/** An order with its lines: [variation, quantity, unit price]. A default order is a P300 Completed Store sale of one line. */
async function order({ staff = 1000, at, total = 300, status = "Completed", type = "Store", source = "POS", location = 1, approvedAt = null, items = [[10, 1, total]] }: OrderInput) {
  const id = ++ids;
  await db.query(`INSERT INTO "Orders" VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9)`, [id, source, type, status, total, staff, location, approvedAt, at]);
  for (const [variation, quantity, price] of items) await db.query(`INSERT INTO "OrderItems" VALUES ($1, $2, $3, $4, $5, $6)`, [++ids + 1000, id, variation, quantity, price, quantity * price]);
  return id;
}
const refund = (orderId: number, variation: number, quantity: number, approvedAt: string | null, status = "Approved") =>
  db.query(`INSERT INTO "RefundRequests" VALUES ($1, $2, $3, 1, $4, $5, 1, 2, $6)`, [++ids + 5000, orderId, variation, quantity, status, approvedAt]);
const figures = async (range = NOV) => (await reader().readSales(range)).map((d) => [d.portalUserId, d.locationId, d.businessDate, d.orders, d.grossSales, d.refundAmount, d.netSales]);

describe("net-sales-v1", () => {
  it("sums Completed Store sales per cashier, branch and Manila day, after discount", async () => {
    await order({ at: "2026-11-10T02:00:00Z", total: 300 });
    await order({ at: "2026-11-10T09:00:00Z", total: 150 });
    await order({ staff: 1001, at: "2026-11-10T02:00:00Z", total: 500 });
    await order({ at: "2026-11-11T02:00:00Z", total: 100, location: 2 });

    expect(await figures()).toEqual([["u-ana", 1, "2026-11-10", 2, 450, 0, 450], ["u-ben", 1, "2026-11-10", 1, 500, 0, 500], ["u-ana", 2, "2026-11-11", 1, 100, 0, 100]]);
  });

  it("puts an order on its Manila day, not its UTC day", async () => {
    await order({ at: "2026-11-30T17:00:00Z", total: 200 });
    await order({ at: "2026-11-30T15:59:00Z", total: 100 });

    expect(await figures({ from: "2026-11-01", to: "2026-12-31" })).toEqual([["u-ana", 1, "2026-11-30", 1, 100, 0, 100], ["u-ana", 1, "2026-12-01", 1, 200, 0, 200]]);
  });

  it("leaves a refunded order in gross sales and subtracts its refund on the approval day, to the original cashier and branch", async () => {
    const sold = await order({ at: "2026-11-10T02:00:00Z", total: 300, status: "Refund Requested", items: [[10, 2, 100], [11, 1, 100]] });
    await refund(sold, 10, 1, "2026-11-12T03:00:00Z");

    expect(await figures()).toEqual([["u-ana", 1, "2026-11-10", 1, 300, 0, 300], ["u-ana", 1, "2026-11-12", 0, 0, 100, -100]]);
  });

  it("uses one price per order line and variation, so repeated lines do not repeat a refund", async () => {
    const sold = await order({ at: "2026-11-10T02:00:00Z", total: 300, status: "Refunded", items: [[10, 1, 100], [10, 1, 100], [11, 1, 100]] });
    await refund(sold, 10, 1, "2026-11-12T03:00:00Z");
    await refund(sold, 11, 1, "2026-11-12T04:00:00Z");

    expect(await figures()).toEqual([["u-ana", 1, "2026-11-10", 1, 300, 0, 300], ["u-ana", 1, "2026-11-12", 0, 0, 200, -200]]);
  });

  it("ignores refund requests that are not approved", async () => {
    const sold = await order({ at: "2026-11-10T02:00:00Z", total: 300, status: "Refund Requested" });
    await refund(sold, 10, 1, null, "Pending");
    await refund(sold, 10, 1, "2026-11-12T03:00:00Z", "Rejected");

    expect(await figures()).toEqual([["u-ana", 1, "2026-11-10", 1, 300, 0, 300]]);
  });

  it("uses the order lines' subtotal for an older whole-order refund, on the order's approval day", async () => {
    await order({ at: "2026-11-10T02:00:00Z", total: 270, status: "Refunded", approvedAt: "2026-11-15T02:00:00Z", items: [[10, 2, 100], [11, 1, 100]] });

    expect(await figures()).toEqual([["u-ana", 1, "2026-11-10", 1, 270, 0, 270], ["u-ana", 1, "2026-11-15", 0, 0, 300, -300]]);
  });

  it("re-reads the previous month: a refund approved in the current month against an October order lands on its approval day", async () => {
    const sold = await order({ at: "2026-10-28T02:00:00Z", total: 300, status: "Refunded", items: [[10, 3, 100]] });
    await refund(sold, 10, 1, "2026-11-03T03:00:00Z");

    expect(await figures({ from: "2026-10-01", to: "2026-11-30" })).toEqual([["u-ana", 1, "2026-10-28", 1, 300, 0, 300], ["u-ana", 1, "2026-11-03", 0, 0, 100, -100]]);
    expect(await figures(NOV)).toEqual([["u-ana", 1, "2026-11-03", 0, 0, 100, -100]]);
  });

  it.each(["Voided", "Void Requested", "Cancelled", "Pending", "Paid", "Awaiting Stock"])("excludes a %s order", async (status) => {
    await order({ at: "2026-11-10T02:00:00Z", status });

    expect(await figures()).toEqual([]);
  });

  it("counts Refund Requested and Refunded as sales, and a bazaar sale (a Store order at a Bazaar branch) found through the branch type", async () => {
    await order({ at: "2026-11-10T02:00:00Z", total: 100, status: "Refund Requested" });
    await order({ at: "2026-11-10T03:00:00Z", total: 200, status: "Refunded", approvedAt: "2026-11-20T02:00:00Z" });
    await order({ at: "2026-11-10T04:00:00Z", total: 50, location: 2 });

    expect((await figures()).filter((row) => row[3] !== 0)).toEqual([["u-ana", 1, "2026-11-10", 2, 300, 0, 300], ["u-ana", 2, "2026-11-10", 1, 50, 0, 50]]);
    expect((await reader().readLocations()).find((l) => l.locationId === 2)).toEqual({ locationId: 2, name: "Bazaar Kiosk", type: "Bazaar", isActive: true });
  });

  it("excludes other sources and types, orders without a branch, unattributed staff, and orders with no lines", async () => {
    await order({ at: "2026-11-10T02:00:00Z", source: "Ecommerce", location: 999 });
    await order({ at: "2026-11-10T02:00:00Z", type: "Institutional" });
    await order({ at: "2026-11-10T02:00:00Z", type: "Online" });
    await order({ at: "2026-11-10T02:00:00Z", location: null });
    await order({ at: "2026-11-10T02:00:00Z", staff: 1 });
    await order({ at: "2026-11-10T02:00:00Z", staff: 1500 });
    await order({ at: "2026-11-10T02:00:00Z", items: [] });

    expect(await figures()).toEqual([]);
  });

  it("returns only the days asked for", async () => {
    await order({ at: "2026-10-31T02:00:00Z" });
    await order({ at: "2026-12-01T02:00:00Z" });
    await order({ at: "2026-11-15T02:00:00Z" });

    expect(await figures()).toEqual([["u-ana", 1, "2026-11-15", 1, 300, 0, 300]]);
    await expect(reader().readSales({ from: "2026-11-30", to: "2026-11-01" })).rejects.toThrow(RangeError);
    await expect(reader().readSales({ from: "November", to: "2026-11-01" })).rejects.toThrow(RangeError);
  });
});

describe("the schema check", () => {
  it("passes on the granted tables", async () => {
    expect(await reader().schemaCheck()).toEqual([]);
  });

  it("stops with POS data changed, naming the column, when a granted column is missing, and reads nothing", async () => {
    await order({ at: "2026-11-10T02:00:00Z" });
    await db.exec(`ALTER TABLE "Orders" DROP COLUMN "ApprovedAt"`);

    const error = await reader().readSales(NOV).then(() => undefined, (e: unknown) => e);
    expect(error).toBeInstanceOf(PosReadError);
    expect(error).toMatchObject({ reason: "data-changed", problems: ["Orders.ApprovedAt: missing or not readable"] });
    expect(await reader().schemaCheck()).toEqual(["Orders.ApprovedAt: missing or not readable"]);
  });

  it("stops when a table lost its grants and a column has the wrong type", async () => {
    await db.exec(`DROP TABLE "Locations"; ALTER TABLE "Orders" ALTER COLUMN "CreatedAt" TYPE timestamp; ALTER TABLE "OrderItems" ALTER COLUMN "UnitPrice" TYPE double precision`);

    const problems = await reader().schemaCheck();
    expect(problems).toContain("Locations.LocationType: missing or not readable");
    expect(problems).toContain("Orders.CreatedAt: expected timestamp with time zone, found timestamp without time zone");
    expect(problems).toContain("OrderItems.UnitPrice: expected numeric or integer or bigint or smallint, found double precision");
    await expect(reader().readLocations()).rejects.toMatchObject({ reason: "data-changed" });
  });
});

describe("the connection", () => {
  const unreachable = (code = "ECONNREFUSED") => Object.assign(new Error("secret postgres://user:pass@host/db"), { code });

  it("retries once after 5 seconds when the POS cannot be reached", async () => {
    let attempts = 0;
    const waits: number[] = [];
    const flaky: PosConnect = async () => { attempts += 1; if (attempts === 1) throw new PosReadError("unreachable", [], "ECONNREFUSED"); return connect(); };

    expect(await posReader(flaky, async (ms) => { waits.push(ms); }).schemaCheck()).toEqual([]);
    expect(attempts).toBe(2);
    expect(waits).toEqual([5000]);
  });

  it("retries once after a query timeout, then fails as unreachable without leaking the connection string", async () => {
    let attempts = 0;
    const timesOut: PosConnect = async () => ({ session: { query: async () => { attempts += 1; throw unreachable("57014"); } }, close: async () => {} });
    const waits: number[] = [];

    const error = await posReader(timesOut, async (ms) => { waits.push(ms); }).schemaCheck().then(() => undefined, (e: unknown) => e);
    expect(error).toMatchObject({ reason: "unreachable", code: "57014", message: "POS: unreachable" });
    expect(JSON.stringify(error)).not.toContain("postgres://");
    expect(attempts).toBe(2);
    expect(waits).toEqual([5000]);
  });

  it("does not retry a data change, and closes the connection every time", async () => {
    let closed = 0;
    let attempts = 0;
    const refused: PosConnect = async () => ({ session: { query: async () => { attempts += 1; throw unreachable("42501"); } }, close: async () => { closed += 1; } });

    await expect(withPos(refused, (session) => session.query("SELECT 1"), async () => {})).rejects.toMatchObject({ reason: "data-changed" });
    expect(attempts).toBe(1);
    expect(closed).toBe(1);
  });

  it("is not configured without the environment variable, and says nothing about its value", async () => {
    await expect(connectFromEnv({})()).rejects.toMatchObject({ reason: "not-configured" });
  });
});

describe("strict rows", () => {
  const rawRow = { portalUserId: "u-ana", staffId: "1000", locationId: 1, businessDate: "2026-11-10", orders: "1", grossSales: "300.00", refundAmount: "0", netSales: "300.00" };
  const withRows = (rows: Record<string, unknown>[]) => posReader(async () => ({ session: { query: async <T>(sql: string) => ({ rows: (/information_schema/.test(sql) ? await schemaRowsOf() : rows) as T[] }) }, close: async () => {} }), async () => {});
  const schemaRowsOf = async () => (await db.query(`SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = 'public'`)).rows;

  it("accepts a well-formed row", async () => {
    expect(await withRows([rawRow]).readSales(NOV)).toEqual([{ portalUserId: "u-ana", staffId: 1000, locationId: 1, businessDate: "2026-11-10", orders: 1, grossSales: 300, refundAmount: 0, netSales: 300 }]);
  });

  it.each([
    ["an extra field", { ...rawRow, customer: "x" }],
    ["a missing field", Object.fromEntries(Object.entries(rawRow).filter(([key]) => key !== "orders"))],
    ["a day outside the range", { ...rawRow, businessDate: "2026-12-01" }],
    ["a staff number below 1000", { ...rawRow, staffId: 5 }],
    ["a negative order count", { ...rawRow, orders: "-1" }],
    ["a figure that is not a number", { ...rawRow, grossSales: "abc" }],
    ["net sales that do not add up", { ...rawRow, netSales: "10" }],
    ["an empty account id", { ...rawRow, portalUserId: " " }],
  ])("rejects %s as POS data changed", async (_name, row) => {
    await expect(withRows([row as Record<string, unknown>]).readSales(NOV)).rejects.toMatchObject({ reason: "data-changed" });
  });
});
