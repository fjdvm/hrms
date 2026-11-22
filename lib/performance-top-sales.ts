import type { Database } from "./database";
import { cashierModule } from "./performance-cashier";

/**
 * Top sales: the query behind the Top sales card. One calendar month, per branch, cashiers ranked by total net sales. It is computed when it
 * is read, stores nothing, and touches no Evaluation: it is recognition only. One of the small read-only modules behind the Performance
 * interface; it takes the database and the clock from the seam, so access is decided there.
 *
 *   Who is ranked   Employees with a linked POS account (a link that is active now) who were cashiers on the last day of the month (#495),
 *                   or today for the month in progress. A promotion after the month ended does not change a past ranking.
 *   Sales           The stored POS figures for the days of the month, summed over the Employee's linked accounts. An Employee who sold at two
 *                   branches appears under each with that branch's sales. A POS branch maps to an HRMS branch through `hrms_pos_locations`; until a
 *                   branch is mapped it is listed under its POS name with `mapped: false`, and POS branches mapped to one HRMS branch are one group.
 *   Ranking         By net sales, highest first; ties share a rank and the next rank skips (1, 1, 3). There is no minimum number of present days.
 *   Overall         The Employee(s) with the most net sales across every branch (more than one only on an exact tie).
 *   Not shown       How many staff with sales are left out: accounts with no linked Employee, and linked Employees who were not cashiers then.
 *   Provisional     Until an import that ran after the month ended has re-read all of it (an import whose range covers the month, by Manila date).
 *                   The month in progress is always provisional.
 */

export type TopSalesProblem = "month-invalid" | "month-in-future";
export class TopSalesError extends Error {
  constructor(public readonly problem: TopSalesProblem) {
    super(`Top sales: ${problem}`);
  }
}

export type TopSalesRow = { rank: number; employeeId: number; employeeNumber: string; name: string; netSales: number; orders: number; presentDays: number };
export type TopSalesBranch = { branch: string; mapped: boolean; ranking: TopSalesRow[] };
export type TopSales = {
  month: string; range: { from: string; to: string };
  /** The date positions were read on: the last day of the month, or today for the month in progress. */
  positionDate: string;
  provisional: boolean;
  branches: TopSalesBranch[];
  overall: TopSalesRow[];
  notShown: { unlinkedAccounts: number; notCashiers: number };
};

const cents = (n: number) => Math.round(n * 100) / 100;
const pad = (n: number) => String(n).padStart(2, "0");

/** Ranks rows by net sales, highest first, with ties sharing a rank (1, 1, 3). Equal rows are ordered by name, then number, so the order is stable. */
function ranked(rows: Omit<TopSalesRow, "rank">[]): TopSalesRow[] {
  const sorted = [...rows].sort((a, b) => b.netSales - a.netSales || a.name.localeCompare(b.name) || a.employeeNumber.localeCompare(b.employeeNumber));
  let rank = 0;
  return sorted.map((row, index) => {
    if (index === 0 || sorted[index - 1].netSales !== row.netSales) rank = index + 1;
    return { rank, ...row };
  });
}

export function topSalesModule(db: Database, now: () => Date) {
  const cashiers = cashierModule(db);
  const today = () => now().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

  async function topSales(input: { year: number; month: number }): Promise<TopSales> {
    const { year, month } = input ?? ({} as typeof input);
    if (!Number.isInteger(year) || !Number.isInteger(month) || year < 2000 || year > 2100 || month < 1 || month > 12) throw new TopSalesError("month-invalid");
    const todayDate = today();
    const first = `${year}-${pad(month)}-01`;
    if (first > todayDate) throw new TopSalesError("month-in-future");
    const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
    const inProgress = todayDate <= last;
    const positionDate = inProgress ? todayDate : last;

    const [sales, locations, links] = await Promise.all([
      db.query<{ account: string; location: number; net: string; orders: string }>(`
        SELECT portal_user_id AS account, location_id AS location, sum(net_sales)::text AS net, sum(orders)::text AS orders
        FROM public.hrms_pos_sales_daily WHERE business_date BETWEEN $1::date AND $2::date GROUP BY 1, 2`, [first, last]),
      db.query<{ id: number; name: string; branch: string | null }>(`SELECT pos_location_id AS id, name, hrms_branch AS branch FROM public.hrms_pos_locations`),
      db.query<{ account: string; employee: number }>(`SELECT portal_user_id AS account, employee_id AS employee FROM public.hrms_pos_account_links WHERE unlinked_at IS NULL`),
    ]);
    const owner = new Map(links.rows.map((row) => [row.account, row.employee]));
    const place = new Map(locations.rows.map((row) => [row.id, row.branch ? { label: row.branch, mapped: true } : { label: row.name, mapped: false }]));
    const cashierIds = await cashiers.cashiersOn(positionDate, [...new Set(links.rows.map((row) => row.employee))]);

    // Per Employee and branch: the sum over their accounts.
    const cells = new Map<string, { employee: number; branch: string; mapped: boolean; net: number; orders: number }>();
    const unlinked = new Set<string>();
    const notCashiers = new Set<number>();
    for (const row of sales.rows) {
      const employee = owner.get(row.account);
      if (employee === undefined) { unlinked.add(row.account); continue; }
      if (!cashierIds.has(employee)) { notCashiers.add(employee); continue; }
      const where = place.get(row.location) ?? { label: `POS branch ${row.location}`, mapped: false };
      const key = `${employee}|${where.label}`;
      const cell = cells.get(key) ?? { employee, branch: where.label, mapped: where.mapped, net: 0, orders: 0 };
      cell.net += Number(row.net); cell.orders += Number(row.orders);
      cells.set(key, cell);
    }

    const employeeIds = [...new Set([...cells.values()].map((cell) => cell.employee))];
    const [people, present] = employeeIds.length === 0 ? [{ rows: [] }, { rows: [] }] : await Promise.all([
      db.query<{ id: number; number: string; name: string }>(`SELECT id, employee_number AS number, full_name AS name FROM public.hrms_employees WHERE id = ANY($1::int[])`, [employeeIds]),
      db.query<{ id: number; days: string }>(`SELECT employee_id AS id, count(*)::text AS days FROM public.hrms_performance_attendance WHERE employee_id = ANY($1::int[]) AND date BETWEEN $2::date AND $3::date AND time_out IS NOT NULL GROUP BY 1`, [employeeIds, first, last]),
    ]);
    const person = new Map(people.rows.map((row) => [row.id, row]));
    const days = new Map(present.rows.map((row) => [row.id, Number(row.days)]));
    const rowOf = (employee: number, net: number, orders: number) => ({
      employeeId: employee, employeeNumber: person.get(employee)!.number, name: person.get(employee)!.name, netSales: cents(net), orders, presentDays: days.get(employee) ?? 0,
    });

    const byBranch = new Map<string, { mapped: boolean; rows: Omit<TopSalesRow, "rank">[] }>();
    const totals = new Map<number, { net: number; orders: number }>();
    for (const cell of cells.values()) {
      const group = byBranch.get(cell.branch) ?? { mapped: cell.mapped, rows: [] };
      group.rows.push(rowOf(cell.employee, cell.net, cell.orders));
      byBranch.set(cell.branch, group);
      const total = totals.get(cell.employee) ?? { net: 0, orders: 0 };
      total.net += cell.net; total.orders += cell.orders;
      totals.set(cell.employee, total);
    }
    const overall = ranked([...totals].map(([employee, total]) => rowOf(employee, total.net, total.orders))).filter((row) => row.rank === 1);

    // Provisional until an import that ran after the month ended covers all of it. An import never reads before the go-live date.
    const covered = inProgress ? false : (await db.query<{ ok: boolean }>(`
      SELECT EXISTS (SELECT 1 FROM public.hrms_pos_imports WHERE range_from <= greatest($1::date, coalesce((SELECT value::date FROM public.hrms_performance_settings WHERE key = 'pos_go_live_date'), $1::date))
        AND range_to >= $2::date AND (imported_at AT TIME ZONE 'Asia/Manila')::date > $2::date) AS ok`, [first, last])).rows[0].ok;

    return {
      month: `${year}-${pad(month)}`, range: { from: first, to: last }, positionDate, provisional: !covered,
      branches: [...byBranch].sort(([a], [b]) => a.localeCompare(b)).map(([branch, group]) => ({ branch, mapped: group.mapped, ranking: ranked(group.rows) })),
      overall, notShown: { unlinkedAccounts: unlinked.size, notCashiers: notCashiers.size },
    };
  }

  return { topSales };
}
