import type { Database } from "./database";
import { isOnRoster } from "./performance-evaluations-terms";
import { RosterError } from "./performance-evaluations";
import type { Actor } from "./performance-kpis";
import { PeriodError, type periodsModule } from "./performance-periods";
import { COMMENTS_MAX_LENGTH, RATING_MAX, RATING_MIN } from "./performance-rating-terms";
import { cleanMultiline, hasDisallowedText } from "./validators/text";

export { COMMENTS_MAX_LENGTH, RATING_MAX, RATING_MIN };

/**
 * Saving the rating and comments for an Employee in a period. One of the small domain modules behind the Performance
 * interface; it takes the Staff member and the database from the seam, so access is decided there.
 *
 * The first save stores the evaluation, which pins the Employee to the period and moves the derived status from Draft to
 * In review; there is no separate review step. It can be done in any order relative to the attendance import and the shift.
 * The rating and comments can be changed until the evaluation is submitted; a submitted one refuses the change. The Staff
 * member and the time of the latest save are kept on the evaluation, and every save is logged with the previous rating.
 */

export type RatingProblem = "rating-invalid" | "comments-invalid" | "comments-too-long" | "already-submitted";

export class RatingError extends Error {
  constructor(public readonly problem: RatingProblem) {
    super(`Rating: ${problem}`);
  }
}

export type SavedRating = { employeeId: number; periodId: number; rating: number; comments: string; status: "In review"; savedByName: string; savedAt: string };

/** A rating is a whole number from 0 to 100. */
export function readRating(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < RATING_MIN || value > RATING_MAX) throw new RatingError("rating-invalid");
  return value;
}

/** Comments are optional free text: cleaned, but refused (not quietly changed) when they hold characters that do not belong in them. */
export function readComments(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" || hasDisallowedText(value)) throw new RatingError("comments-invalid");
  const comments = cleanMultiline(value);
  if (comments.length > COMMENTS_MAX_LENGTH) throw new RatingError("comments-too-long");
  return comments;
}

export function ratingModule(db: Database, periods: ReturnType<typeof periodsModule>) {
  /**
   * Saves the rating (0 to 100) and the comments, replacing the earlier ones while the evaluation is In review. Refused for a
   * submitted evaluation, for an Employee not on the roster, and for a rating or comments that are not valid.
   */
  async function saveRating(actor: Actor, employeeId: number, periodId: number, input: { rating: unknown; comments?: unknown }): Promise<SavedRating> {
    const rating = readRating(input?.rating);
    const comments = readComments(input?.comments);
    const period = await periods.requirePeriod(periodId);
    if (!Number.isInteger(employeeId) || employeeId < 1 || employeeId > 2147483647) throw new PeriodError("unknown-employee");
    const employee = (await db.query<{ status: string; start: string }>(`SELECT status, start_date::text AS start FROM public.hrms_employees WHERE id = $1`, [employeeId])).rows[0];
    if (!employee) throw new PeriodError("unknown-employee");
    const existing = (await db.query<{ status: string }>(`SELECT status FROM public.hrms_evaluations WHERE employee_id = $1 AND period_id = $2`, [employeeId, periodId])).rows[0];
    if (!isOnRoster(employee, period, existing !== undefined)) throw new RosterError("not-in-roster");
    if (existing?.status === "Evaluated") throw new RatingError("already-submitted");

    // One statement: the change applies only while the evaluation is In review, so a submit that lands first still wins.
    const { rows } = await db.query<SavedRating>(`
      WITH prior AS (
        SELECT rating, comments FROM public.hrms_evaluations WHERE employee_id = $1 AND period_id = $2
      ), saved AS (
        INSERT INTO public.hrms_evaluations (employee_id, period_id, rating, comments, rated_by_id, rated_by_name)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (employee_id, period_id) DO UPDATE SET rating = EXCLUDED.rating, comments = EXCLUDED.comments,
          rated_by_id = EXCLUDED.rated_by_id, rated_by_name = EXCLUDED.rated_by_name, rated_at = clock_timestamp()
        WHERE public.hrms_evaluations.status = 'In review'
        RETURNING employee_id, period_id, rating, comments, rated_by_name, rated_at
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $5, $6, 'rating-saved', 'evaluation', $1::text || ':' || $2::text,
          jsonb_build_object('employeeId', $1::int, 'periodId', $2::int, 'rating', saved.rating, 'previousRating', (SELECT rating FROM prior),
            'commentsChanged', saved.comments IS DISTINCT FROM (SELECT comments FROM prior), 'first', NOT EXISTS (SELECT 1 FROM prior))
        FROM saved
      ) SELECT employee_id AS "employeeId", period_id AS "periodId", rating, comments, 'In review' AS status, rated_by_name AS "savedByName", rated_at::text AS "savedAt" FROM saved`,
    [employeeId, periodId, rating, comments, actor.id, actor.name]);
    if (!rows[0]) throw new RatingError("already-submitted");
    return rows[0];
  }

  return { saveRating };
}
