import type { Database } from "./database";
import { isDate, resultsDue, type TrainingCompletion, type TrainingTotals } from "./training-terms";

/**
 * Training completion for one Employee and one date range, for the Performance score. One of the small domain modules
 * behind the Performance interface. It reads the Training Module's data with the same definition of "results due" the
 * Trainings card uses (`resultsDue` in training-terms), and returns only figures: no titles, trainers or dates, so a
 * Performance holder who does not hold Training sees the result inside the score and no Trainings.
 */

/** The label for Trainings whose results nobody has marked yet. */
export const RESULTS_NOT_MARKED = "Results not marked";

export type EmployeeTrainingCompletion = {
  /** Completed, due and the whole percent, or null (Not applicable) when nothing was due. Never 0% for nothing due. */
  completion: TrainingCompletion | null;
  /** How many held Trainings have this Employee Assigned with no result marked yet; each counts as not completed. */
  resultsNotMarked: number;
};

export class TrainingReadError extends Error {
  constructor(public readonly reason: "validation" | "not-found") {
    super(`Training completion: ${reason}`);
  }
}

export function trainingCompletionModule(db: Database, now: () => Date) {
  /**
   * `range` is "YYYY-MM-DD" in Manila time, both ends included. Only Trainings whose date has passed count, so a range that
   * reaches into the future covers only what has already been held.
   */
  async function trainingCompletion(employeeId: number, range: { from: string; to: string }): Promise<EmployeeTrainingCompletion> {
    if (!Number.isInteger(employeeId) || employeeId < 1 || employeeId > 2147483647) throw new TrainingReadError("validation");
    if (!range || !isDate(range.from) || !isDate(range.to) || range.to < range.from) throw new TrainingReadError("validation");
    if (!(await db.query(`SELECT 1 FROM public.hrms_employees WHERE id = $1`, [employeeId])).rows.length) throw new TrainingReadError("not-found");

    const { rows } = await db.query<TrainingTotals>(`
      SELECT t.training_date::text AS date, t.cancelled_at IS NOT NULL AS cancelled,
        (a.status <> 'Cancelled')::int AS due, (a.status = 'Completed')::int AS completed, (a.status NOT IN ('Assigned', 'Cancelled'))::int AS recorded
      FROM public.hrms_training_assignments a JOIN public.hrms_trainings t ON t.id = a.training_id
      WHERE a.employee_id = $1 AND t.training_date BETWEEN $2::date AND $3::date`, [employeeId, range.from, range.to]);
    const { completion, notMarked } = resultsDue(rows, now());
    return { completion, resultsNotMarked: notMarked };
  }

  return { trainingCompletion };
}
