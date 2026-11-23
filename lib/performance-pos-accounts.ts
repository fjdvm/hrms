import type { Database } from "./database";
import { cashierModule } from "./performance-cashier";
import type { linksModule } from "./performance-links";

/**
 * What the Needs linking tab and the Link POS cashier dialog read. One of the small read-only modules behind the Performance interface.
 *
 * Needing a link: a POS account (a Portal user) with stored sales and no active link to an Employee. Each comes with what HR needs to recognise it:
 * the Portal's name when the directory has one (otherwise the staff number and branch alone), its usual branch (where it sold the most, as the HRMS
 * branch once the branch is mapped), its totals, and the months they cover.
 *
 * Candidates: the Employees the picker offers. Everyone active is shown; only those who are cashiers today can be chosen, and an Employee who already has
 * an account is marked so the dialog asks for the reason a second account needs.
 */

export type PosAccountNeedingLink = {
  portalUserId: string; name: string | null; staffNumber: string | null; branch: string | null;
  orders: number; netSales: number; from: string; to: string;
};
export type LinkCandidate = { id: number; employeeNumber: string; name: string; position: string; branch: string; cashier: boolean; accounts: number };

export function posAccountsModule(db: Database, now: () => Date, deps: { links: ReturnType<typeof linksModule> }) {
  const cashiers = cashierModule(db);
  const today = () => now().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

  /** The accounts with sales and no Employee, the biggest first. */
  async function needingLink(): Promise<PosAccountNeedingLink[]> {
    const { rows } = await db.query<{ portalUserId: string; staffNumber: number | null; branch: string | null; orders: number; netSales: number; from: string; to: string }>(`
      SELECT d.portal_user_id AS "portalUserId", a.staff_number AS "staffNumber",
        (SELECT coalesce(l.hrms_branch, l.name) FROM public.hrms_pos_sales_daily d2 JOIN public.hrms_pos_locations l ON l.pos_location_id = d2.location_id
          WHERE d2.portal_user_id = d.portal_user_id GROUP BY 1 ORDER BY sum(d2.net_sales) DESC, 1 LIMIT 1) AS branch,
        sum(d.orders)::int AS orders, sum(d.net_sales)::float8 AS "netSales", min(d.business_date)::text AS "from", max(d.business_date)::text AS "to"
      FROM public.hrms_pos_sales_daily d LEFT JOIN public.hrms_pos_accounts a ON a.portal_user_id = d.portal_user_id
      WHERE NOT EXISTS (SELECT 1 FROM public.hrms_pos_account_links k WHERE k.portal_user_id = d.portal_user_id AND k.unlinked_at IS NULL)
      GROUP BY d.portal_user_id, a.staff_number ORDER BY sum(d.net_sales) DESC, d.portal_user_id`);
    const named = await deps.links.describeAccounts(rows.map((row) => ({ portalUserId: row.portalUserId, staffNumber: row.staffNumber === null ? null : String(row.staffNumber), branch: row.branch })));
    return rows.map((row, index) => ({ portalUserId: row.portalUserId, name: named[index].name, staffNumber: named[index].staffNumber, branch: row.branch, orders: row.orders, netSales: row.netSales, from: row.from, to: row.to }));
  }

  /** The Employees the picker offers: who they are, whether they are a cashier today, and how many POS accounts they have now. */
  async function candidates(): Promise<LinkCandidate[]> {
    const { rows } = await db.query<Omit<LinkCandidate, "cashier">>(`
      SELECT e.id, e.employee_number AS "employeeNumber", e.full_name AS name, e.position, e.branch,
        (SELECT count(*) FROM public.hrms_pos_account_links k WHERE k.employee_id = e.id AND k.unlinked_at IS NULL)::int AS accounts
      FROM public.hrms_employees e WHERE e.status = 'Active' ORDER BY e.full_name, e.id LIMIT 1000`);
    const cashierIds = await cashiers.cashiersOn(today(), rows.map((row) => row.id));
    return rows.map((row) => ({ ...row, cashier: cashierIds.has(row.id) }));
  }

  return { needingLink, candidates };
}
