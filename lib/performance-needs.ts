import type { Database } from "./database";
import type { evaluationsModule } from "./performance-evaluations";
import type { Actor } from "./performance-kpis";
import { ACTION_MAX_LENGTH, GAP_MAX_LENGTH, checkNeedText, type NeedProblem } from "./performance-needs-terms";
import { PeriodError, type periodsModule } from "./performance-periods";
import { cleanMultiline } from "./validators/text";

export { ACTION_MAX_LENGTH, GAP_MAX_LENGTH, type NeedProblem };

/**
 * Development needs. One of the small domain modules behind the Performance interface; it takes the Staff member and the database from
 * the seam, so access is decided there.
 *
 * A Performance holder flags a gap on an Employee's Evaluation, with the action or Training they recommend, and reads the list back. A need
 * belongs to the Employee and the period, not to a submitted version, so Submit and Reopen never touch it. It can be flagged while the
 * Evaluation is In review or Evaluated (not while it is still a Draft with no rating saved). A flag never changes the score, the rating or the
 * status, and sends no email. The change and its Performance audit row are one statement.
 */

export class NeedError extends Error {
  constructor(public readonly problem: NeedProblem) {
    super(`Development need: ${problem}`);
  }
}

export type DevelopmentNeed = {
  id: number;
  employeeId: number;
  periodId: number;
  gap: string;
  action: string;
  /** The scheduled Training recommended, when one was picked. */
  trainingId: number | null;
  /** `manual` for a need Staff typed, `ai` for one flagged from a suggested development area. */
  source: "manual" | "ai";
  suggestionId: number | null;
  flaggedById: string;
  flaggedByName: string;
  flaggedAt: string;
};

export type NeedInput = { gap: unknown; action: unknown; trainingId?: unknown };

type NeedRow = DevelopmentNeed;
const COLUMNS = `id, employee_id AS "employeeId", period_id AS "periodId", gap, action, training_id AS "trainingId", source, suggestion_id AS "suggestionId",
  flagged_by_id AS "flaggedById", flagged_by_name AS "flaggedByName", flagged_at::text AS "flaggedAt"`;

/** A required text field: cleaned, but refused (not quietly changed) when it holds characters that do not belong in it. */
export function readNeedText(field: "gap" | "action", value: unknown): string {
  if (value === undefined || value === null) throw new NeedError(`${field}-required`);
  if (typeof value !== "string") throw new NeedError(`${field}-invalid`);
  const problem = checkNeedText(field, value);
  if (problem) throw new NeedError(problem);
  return cleanMultiline(value);
}

/** The optional Training id: nothing, or a whole number that can be a Training's id. Anything else names no Training. */
export function readTrainingId(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 2147483647) throw new NeedError("unknown-training");
  return value;
}

export function needsModule(db: Database, deps: { evaluations: ReturnType<typeof evaluationsModule>; periods: ReturnType<typeof periodsModule> }) {
  async function flagNeed(actor: Actor, employeeId: number, periodId: number, input: NeedInput): Promise<DevelopmentNeed> {
    const gap = readNeedText("gap", input.gap);
    const action = readNeedText("action", input.action);
    const trainingId = readTrainingId(input.trainingId);

    // Finds the Employee and the period (an unknown one is refused as everywhere else in Performance) and reads the Evaluation's state.
    const evaluation = await deps.evaluations.evaluationFor(employeeId, periodId);
    if (evaluation.status === "Draft") throw new NeedError("evaluation-not-started");

    // One statement: the need and its audit row. A Training id that names no Training adds nothing.
    const { rows } = await db.query<NeedRow>(`
      WITH added AS (
        INSERT INTO public.hrms_development_needs (employee_id, period_id, gap, action, training_id, source, flagged_by_id, flagged_by_name)
        SELECT $1::int, $2::int, $3::text, $4::text, $5::int, 'manual', $6::text, $7::text
        WHERE $5::int IS NULL OR EXISTS (SELECT 1 FROM public.hrms_trainings WHERE id = $5)
        RETURNING *
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $6::text, $7::text, 'development-need-flagged', 'evaluation', $8::text,
          jsonb_build_object('employeeId', added.employee_id, 'periodId', added.period_id, 'needId', added.id, 'source', added.source, 'trainingId', added.training_id)
        FROM added
      ) SELECT ${COLUMNS} FROM added`,
    [employeeId, periodId, gap, action, trainingId, actor.id, actor.name, `${employeeId}:${periodId}`]);
    if (!rows[0]) throw new NeedError("unknown-training");
    return rows[0];
  }

  /** The needs flagged for an Employee in a period, newest first. They are the same whatever the Evaluation's status. */
  async function listNeeds(employeeId: number, periodId: number): Promise<DevelopmentNeed[]> {
    await deps.periods.requirePeriod(periodId);
    if (!Number.isInteger(employeeId) || employeeId < 1 || employeeId > 2147483647) throw new PeriodError("unknown-employee");
    const known = await db.query(`SELECT 1 FROM public.hrms_employees WHERE id = $1`, [employeeId]);
    if (known.rows.length === 0) throw new PeriodError("unknown-employee");
    const { rows } = await db.query<NeedRow>(
      `SELECT ${COLUMNS} FROM public.hrms_development_needs WHERE employee_id = $1 AND period_id = $2 ORDER BY flagged_at DESC, id DESC`, [employeeId, periodId]);
    return rows;
  }

  return { flagNeed, listNeeds };
}
