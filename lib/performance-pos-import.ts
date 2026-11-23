import type { Database } from "./database";
import type { linksModule, DescribedAccount } from "./performance-links";
import type { Actor } from "./performance-kpis";
import type { posSettingsModule } from "./performance-pos-settings";
import { ImportError, importRange } from "./performance-pos-import-terms";
import { PosReadError, type PosImportRead, type posReader } from "./pos-reader";

export { ImportError, importRange, type ImportProblem } from "./performance-pos-import-terms";

/**
 * Import POS sales. One of the small domain modules behind the Performance interface; it takes the Staff member and the database from the seam,
 * so access is decided there. It runs only when a Staff member asks (never on a timer).
 *
 * A run reads the current and the previous Manila month, because a void or a refund can reach back, and never a day before the go-live date.
 * `preview` reads and saves nothing. `confirm` reads again, so what is saved is what the POS says now, and saves in one statement: the import
 * record, the branches, the daily figures (upserted by cashier, branch and day) and the audit row. Days in the range the POS no longer returns
 * (every order on that day was voided, say) are removed in that statement, so a stored figure never outlives the POS data it came from. An error
 * from the POS (unreachable, data changed, not configured) saves nothing.
 */

export type UnlinkedAccount = DescribedAccount & { orders: number; netSales: number };
export type ImportPreview = {
  range: { from: string; to: string }; goLiveDate: string;
  /** Per month: orders, net sales, the cashiers with sales and how many of them are linked to an Employee. */
  months: { month: string; orders: number; netSales: number; cashiers: number; linkedCashiers: number }[];
  totals: { days: number; orders: number; grossSales: number; refundAmount: number; netSales: number };
  accounts: { linked: number; unlinked: UnlinkedAccount[] };
  /** The Employees whose linked accounts have sales in the range, by name. */
  matched: string[];
  /** Sales by the definition that could not be credited to a cashier (no staff number, or one below 1000). Not in the figures. */
  leftOut: { orders: number; grossSales: number };
  /** The schema check ran before the read and passed (a failure is an error, not a preview). */
  schemaCheck: "passed";
};
export type SavedImport = { id: number; range: { from: string; to: string }; days: number; orders: number; netSales: number; removedDays: number; importedByName: string; importedAt: string };
export type ImportRecord = { id: number; from: string; to: string; days: number; orders: number; netSales: number; unlinkedAccounts: number; importedByName: string; importedAt: string };

const cents = (n: number) => Math.round(n * 100) / 100;

export function posImportModule(db: Database, now: () => Date, deps: { links: ReturnType<typeof linksModule>; reader: ReturnType<typeof posReader>; settings: ReturnType<typeof posSettingsModule> }) {
  const today = () => now().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

  async function readPos() {
    const goLive = (await deps.settings.goLive())?.date ?? null;
    const range = importRange(goLive, today());
    try {
      return { goLive: goLive!, range, read: await deps.reader.readForImport(range) };
    } catch (error) {
      if (!(error instanceof PosReadError)) throw error;
      throw new ImportError(error.reason === "data-changed" ? "pos-data-changed" : error.reason === "not-configured" ? "pos-not-configured" : "pos-unreachable", error.problems);
    }
  }

  async function summarise(goLive: string, range: { from: string; to: string }, read: PosImportRead): Promise<ImportPreview> {
    const months = new Map<string, { orders: number; netSales: number; accounts: Set<string> }>();
    const accounts = new Map<string, { orders: number; netSales: number; staffId: number; locationId: number; best: number }>();
    const totals = { days: read.sales.length, orders: 0, grossSales: 0, refundAmount: 0, netSales: 0 };
    for (const day of read.sales) {
      totals.orders += day.orders; totals.grossSales += day.grossSales; totals.refundAmount += day.refundAmount; totals.netSales += day.netSales;
      const month = months.get(day.businessDate.slice(0, 7)) ?? { orders: 0, netSales: 0, accounts: new Set<string>() };
      month.orders += day.orders; month.netSales += day.netSales; month.accounts.add(day.portalUserId);
      months.set(day.businessDate.slice(0, 7), month);
      const account = accounts.get(day.portalUserId) ?? { orders: 0, netSales: 0, staffId: day.staffId, locationId: day.locationId, best: -Infinity };
      account.orders += day.orders; account.netSales += day.netSales;
      // The account's usual branch is where it sold the most.
      if (day.netSales > account.best) { account.best = day.netSales; account.locationId = day.locationId; }
      accounts.set(day.portalUserId, account);
    }
    const linked = await deps.links.activeLinks();
    const unlinkedIds = [...accounts.keys()].filter((id) => !linked.has(id));
    const matchedIds = [...new Set([...accounts.keys()].flatMap((id) => (linked.has(id) ? [linked.get(id)!] : [])))];
    const matched = matchedIds.length === 0 ? [] : (await db.query<{ name: string }>(`SELECT full_name AS name FROM public.hrms_employees WHERE id = ANY($1::int[]) ORDER BY full_name, id`, [matchedIds])).rows.map((row) => row.name);
    const branchName = new Map(read.locations.map((location) => [location.locationId, location.name]));
    const named = await deps.links.describeAccounts(unlinkedIds.map((id) => ({ portalUserId: id, staffNumber: String(accounts.get(id)!.staffId), branch: branchName.get(accounts.get(id)!.locationId) ?? null })));
    const unlinked = named.map((account): UnlinkedAccount => ({ ...account, orders: accounts.get(account.portalUserId)!.orders, netSales: cents(accounts.get(account.portalUserId)!.netSales) }))
      .sort((a, b) => b.netSales - a.netSales || a.portalUserId.localeCompare(b.portalUserId));
    return {
      range, goLiveDate: goLive,
      months: [...months].sort(([a], [b]) => a.localeCompare(b)).map(([month, m]) => ({ month, orders: m.orders, netSales: cents(m.netSales), cashiers: m.accounts.size, linkedCashiers: [...m.accounts].filter((id) => linked.has(id)).length })),
      totals: { days: totals.days, orders: totals.orders, grossSales: cents(totals.grossSales), refundAmount: cents(totals.refundAmount), netSales: cents(totals.netSales) },
      accounts: { linked: accounts.size - unlinkedIds.length, unlinked }, matched, leftOut: read.leftOut, schemaCheck: "passed",
    };
  }

  /** What an import would do, with nothing saved. */
  async function preview(): Promise<ImportPreview> {
    const { goLive, range, read } = await readPos();
    return summarise(goLive, range, read);
  }

  /** Reads the POS again and saves what it says now, in one statement. */
  async function confirm(actor: Actor): Promise<SavedImport> {
    const { goLive, range, read } = await readPos();
    const summary = await summarise(goLive, range, read);
    const sales = read.sales;
    // Each account's POS staff number, one row per account, for the Needs linking list.
    const staffOf = new Map(sales.map((d) => [d.portalUserId, d.staffId]));
    const { rows } = await db.query<{ id: number; importedAt: string; removedDays: string }>(`
      WITH imported AS (
        INSERT INTO public.hrms_pos_imports (range_from, range_to, days, orders, net_sales, unlinked_accounts, imported_by_id, imported_by_name)
        VALUES ($1::date, $2::date, $3::int, $4::int, $5::numeric, $6::int, $7, $8) RETURNING *
      ), branches AS (
        INSERT INTO public.hrms_pos_locations (pos_location_id, name, pos_type, is_active)
        SELECT * FROM unnest($9::int[], $10::text[], $11::text[], $12::boolean[])
        ON CONFLICT (pos_location_id) DO UPDATE SET name = EXCLUDED.name, pos_type = EXCLUDED.pos_type, is_active = EXCLUDED.is_active, updated_at = clock_timestamp()
      ), accounts AS (
        INSERT INTO public.hrms_pos_accounts (portal_user_id, staff_number)
        SELECT * FROM unnest($20::text[], $21::int[])
        ON CONFLICT (portal_user_id) DO UPDATE SET staff_number = EXCLUDED.staff_number, updated_at = clock_timestamp()
      ), incoming AS (
        SELECT * FROM unnest($13::text[], $14::int[], $15::date[], $16::int[], $17::numeric[], $18::numeric[], $19::numeric[]) AS t(portal_user_id, location_id, business_date, orders, gross_sales, refund_amount, net_sales)
      ), removed AS (
        DELETE FROM public.hrms_pos_sales_daily d WHERE d.business_date BETWEEN $1::date AND $2::date
          AND NOT EXISTS (SELECT 1 FROM incoming i WHERE i.portal_user_id = d.portal_user_id AND i.location_id = d.location_id AND i.business_date = d.business_date) RETURNING 1
      ), saved AS (
        INSERT INTO public.hrms_pos_sales_daily (portal_user_id, location_id, business_date, orders, gross_sales, refund_amount, net_sales, import_id)
        SELECT i.portal_user_id, i.location_id, i.business_date, i.orders, i.gross_sales, i.refund_amount, i.net_sales, imported.id FROM incoming i CROSS JOIN imported
        ON CONFLICT (portal_user_id, location_id, business_date) DO UPDATE SET orders = EXCLUDED.orders, gross_sales = EXCLUDED.gross_sales,
          refund_amount = EXCLUDED.refund_amount, net_sales = EXCLUDED.net_sales, import_id = EXCLUDED.import_id RETURNING 1
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $7, $8, 'pos-sales-imported', 'pos-import', id::text, jsonb_build_object('from', range_from, 'to', range_to, 'days', days, 'orders', orders, 'netSales', net_sales, 'unlinkedAccounts', unlinked_accounts) FROM imported
      ) SELECT id, imported_at::text AS "importedAt", (SELECT count(*) FROM removed)::text AS "removedDays" FROM imported`,
    [range.from, range.to, summary.totals.days, summary.totals.orders, summary.totals.netSales, summary.accounts.unlinked.length, actor.id, actor.name,
      read.locations.map((l) => l.locationId), read.locations.map((l) => l.name), read.locations.map((l) => l.type), read.locations.map((l) => l.isActive),
      sales.map((d) => d.portalUserId), sales.map((d) => d.locationId), sales.map((d) => d.businessDate), sales.map((d) => d.orders), sales.map((d) => d.grossSales), sales.map((d) => d.refundAmount), sales.map((d) => d.netSales),
      [...staffOf.keys()], [...staffOf.values()]]);
    return { id: rows[0].id, range, days: summary.totals.days, orders: summary.totals.orders, netSales: summary.totals.netSales, removedDays: Number(rows[0].removedDays), importedByName: actor.name, importedAt: rows[0].importedAt };
  }

  /** The most recent imports: who, when, the range and the totals. */
  async function listImports(): Promise<ImportRecord[]> {
    const { rows } = await db.query<ImportRecord>(`
      SELECT id, range_from::text AS "from", range_to::text AS "to", days, orders, net_sales::float8 AS "netSales", unlinked_accounts AS "unlinkedAccounts", imported_by_name AS "importedByName", imported_at::text AS "importedAt"
      FROM public.hrms_pos_imports ORDER BY id DESC LIMIT 20`);
    return rows;
  }

  return { preview, confirm, listImports };
}
