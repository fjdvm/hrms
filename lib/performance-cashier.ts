import type { Database } from "./database";
import { matchKey } from "./validators/text";

/**
 * The Cashier rule: who is a cashier on a date. One of the small read-only domain modules behind the Performance interface;
 * the link block, the Top sales ranking and the sales KPI all ask it, so they follow one rule.
 *
 * An Employee is a cashier on a date when their position on that date matches a position weight set that gives the sales KPI
 * a weight above 0. Positions match as weight sets do: exact text, ignoring case and extra spaces. There is no cashier flag, and
 * the default set (which has no position and applies to everyone) never makes anyone a cashier. With no sales KPI, or no set
 * weighing it, nobody is a cashier.
 *
 * The position on a date comes from the Employee history: the old value of the first position change taking effect after that
 * date, or the current position when no change comes after it. So an Employee promoted on 5 December was a cashier on
 * 30 November and is not on 31 December, and "today" is the current position.
 */

/** The id of the sales KPI in `hrms_kpis`; it is added by the sales KPI ticket, and until then no set weighs it. */
export const SALES_KPI_ID = "sales";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const checkDate = (date: string) => {
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new RangeError(`Not a date: ${date}`);
};

export function cashierModule(db: Database) {
  /** Each Employee's position on `date` ("YYYY-MM-DD"), for the given Employees or for everyone. */
  async function positionsOn(date: string, employeeIds?: readonly number[]): Promise<Map<number, string>> {
    checkDate(date);
    const { rows } = await db.query<{ id: number; position: string }>(`
      SELECT e.id, COALESCE(
        (SELECT h.old_value #>> '{}' FROM public.hrms_employee_history h
         WHERE h.employee_id = e.id AND h.kind = 'Changed' AND h.field = 'position' AND h.effective_date > $1::date
         ORDER BY h.effective_date, h.occurred_at, h.id LIMIT 1), e.position) AS position
      FROM public.hrms_employees e WHERE $2::int[] IS NULL OR e.id = ANY($2::int[])`, [date, employeeIds ? [...employeeIds] : null]);
    return new Map(rows.map((row) => [row.id, row.position]));
  }

  /** The ids of the Employees (of those given, or of everyone) who are cashiers on `date`. */
  async function cashiersOn(date: string, employeeIds?: readonly number[]): Promise<Set<number>> {
    checkDate(date);
    const [positions, sets] = await Promise.all([
      positionsOn(date, employeeIds),
      db.query<{ position: string }>(`
        SELECT s.position FROM public.hrms_weight_sets s
        JOIN public.hrms_weight_set_items i ON i.set_id = s.id AND i.kpi_id = $1 AND i.weight > 0
        WHERE NOT s.is_default AND s.position IS NOT NULL`, [SALES_KPI_ID]),
    ]);
    const salesPositions = new Set(sets.rows.map((row) => matchKey(row.position)));
    const cashiers = new Set<number>();
    for (const [id, position] of positions) if (salesPositions.has(matchKey(position))) cashiers.add(id);
    return cashiers;
  }

  /** Whether one Employee is a cashier on `date` ("YYYY-MM-DD"; today's date asks about their current position). */
  const isCashierOn = async (employeeId: number, date: string) => (await cashiersOn(date, [employeeId])).has(employeeId);

  return { positionsOn, cashiersOn, isCashierOn };
}
