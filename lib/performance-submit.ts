import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import { deliverAuditEvents } from "./audit";
import type { evaluationsModule, EvaluationDetail, Figures } from "./performance-evaluations";
import type { SubmitCheck } from "./performance-evaluations-terms";
import type { Actor } from "./performance-kpis";

/**
 * Submitting an evaluation. One of the small domain modules behind the Performance interface; it takes the Staff member and
 * the database from the seam, so access is decided there.
 *
 * Submit is allowed only when all four checks pass (attendance imported, shift set, attendance issues resolved, rating entered);
 * a Not-applicable result never blocks it. It locks the evaluation (Evaluated) and, in the same statement, saves the version that
 * produced the score: the KPI results, the weighted score, the weights actually used, the formulas in force, the weight set's
 * name and the rating. After that the evaluation is read from that saved version, so nothing that changes later can alter it.
 *
 * Two submits at the same moment cannot both succeed: the lock is a conditional update, so the second finds it already Evaluated
 * and is refused. The audit event goes through the existing audit outbox in the same statement, and is then delivered at once;
 * if delivery fails it is retried later. No email or notification is sent.
 */

export type SubmitProblem = "checks-missing" | "already-submitted" | "changed";

export class SubmitError extends Error {
  /** For checks-missing: every check that is not met, with its reason. */
  constructor(public readonly problem: SubmitProblem, public readonly missing: SubmitCheck[] = []) {
    super(problem === "checks-missing" ? `Submit refused: ${missing.map((check) => check.label).join(", ")} not met.` : `Submit: ${problem}`);
  }
}

export type SubmittedEvaluation = {
  employeeId: number; periodId: number; status: "Evaluated"; version: number;
  /** The weighted score out of 100 to one decimal, or null when the result was Insufficient data. */
  score: number | null; outcome: "scored" | "insufficient-data"; weightSetName: string; submittedByName: string; submittedAt: string;
};

/** The figures behind the score, as saved with a submission. */
export const figuresOf = (detail: EvaluationDetail): Figures => ({
  shift: detail.shift, scheduledDays: detail.scheduledDays, excusedDays: detail.excusedDays, graceMinutes: detail.graceMinutes, counts: detail.counts,
  attendance: detail.attendance, resultsNotMarked: detail.resultsNotMarked,
});

export function submitModule(db: Database, deps: { evaluations: ReturnType<typeof evaluationsModule> }) {
  async function submitEvaluation(actor: Actor, employeeId: number, periodId: number): Promise<SubmittedEvaluation> {
    const { detail, evaluation, employee } = await deps.evaluations.liveDetail(employeeId, periodId);
    if (evaluation?.status === "Evaluated") throw new SubmitError("already-submitted");
    const missing = detail.submit.checks.filter((check) => !check.passed);
    if (missing.length > 0 || !evaluation || !detail.rating || !detail.weightSet || !detail.weights) throw new SubmitError("checks-missing", missing);

    const scored = detail.score.outcome === "scored";
    const results = detail.kpis.map((kpi) => ({
      kpi_id: kpi.id, name: kpi.name, description: kpi.description, source: kpi.source, target: kpi.target, status: kpi.status, result: kpi.result,
      weight: kpi.weight, weight_used: kpi.weightUsed, points: kpi.points, reason: kpi.reason, flag: kpi.flag,
    }));
    const auditId = randomUUID();
    const event = {
      // The audit service accepts the generic record actions for HRMS, so the operation is named in the metadata.
      source: "HRMS", module: "Performance", action: "record.updated", outcome: "success",
      actor: { type: "user", id: actor.id, display_name: actor.name },
      target: { type: "evaluation", id: `${employee.id}:${periodId}`, display_name: `${employee.name} · ${detail.period.name}` },
      description: `${actor.name} submitted the evaluation of ${employee.name} for ${detail.period.name}.`,
      customer_description: null, occurred_at: new Date().toISOString(), idempotency_key: auditId,
      metadata: { operation: "evaluation.submitted", employee_id: employee.id, employee_number: employee.employeeNumber, period_id: periodId },
    };

    // One statement. The lock applies only while the evaluation is still In review with the rating that was read, so a second
    // submit, or a rating saved meanwhile, finds nothing to lock and nothing is saved.
    const { rows } = await db.query<{ version: number; submittedAt: string }>(`
      WITH locked AS (
        UPDATE public.hrms_evaluations SET status = 'Evaluated'
        WHERE id = $1 AND status = 'In review' AND rating = $2 AND comments = $3 AND rated_at::text = $4
        RETURNING id, rating, comments
      ), saved AS (
        INSERT INTO public.hrms_evaluation_submissions (evaluation_id, version, outcome, score, rating, comments, weight_set_id, weight_set_name, weight_set_default,
          weights, weights_used, formulas, figures, submitted_by_id, submitted_by_name)
        SELECT locked.id, COALESCE((SELECT max(version) FROM public.hrms_evaluation_submissions WHERE evaluation_id = locked.id), 0) + 1, $5, $6::numeric, locked.rating, locked.comments,
          $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $15 FROM locked
        RETURNING id, version, submitted_at
      ), kpis AS (
        INSERT INTO public.hrms_evaluation_results (submission_id, kpi_id, name, description, source, target, status, result, weight, weight_used, points, reason, flag)
        SELECT saved.id, r.kpi_id, r.name, r.description, r.source, r.target, r.status, r.result, r.weight, r.weight_used, r.points, r.reason, r.flag
        FROM saved, jsonb_to_recordset($16::jsonb) AS r(kpi_id text, name text, description text, source text, target text, status text, result numeric, weight integer, weight_used numeric, points numeric, reason text, flag text)
      ), queued AS (
        INSERT INTO public.hrms_audit_outbox (id, payload)
        SELECT $17, jsonb_set($18::jsonb, '{metadata,version}', to_jsonb(saved.version)) FROM saved
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $14, $15, 'evaluation-submitted', 'evaluation', $19, jsonb_build_object('employeeId', $20::int, 'periodId', $21::int, 'version', saved.version, 'outcome', $5::text) FROM saved
      ) SELECT version, submitted_at::text AS "submittedAt" FROM saved`,
    [evaluation.id, detail.rating.value, detail.rating.comments, detail.rating.savedAt, scored ? "scored" : "insufficient-data", detail.score.outcome === "scored" ? detail.score.value : null,
      detail.weightSet.id, detail.weightSet.name, detail.weightSet.isDefault, JSON.stringify(detail.weights), JSON.stringify(detail.weightsUsed), JSON.stringify(detail.formulas), JSON.stringify(figuresOf(detail)),
      actor.id, actor.name, JSON.stringify(results), auditId, JSON.stringify(event), `${employee.id}:${periodId}`, employee.id, periodId]);

    if (!rows[0]) {
      const now = (await db.query<{ status: string }>(`SELECT status FROM public.hrms_evaluations WHERE id = $1`, [evaluation.id])).rows[0];
      throw new SubmitError(now?.status === "Evaluated" ? "already-submitted" : "changed");
    }
    // Delivery is isolated from the committed submit: a failure leaves the event queued for the next retry.
    await deliverAuditEvents(db, auditId);
    return {
      employeeId: employee.id, periodId, status: "Evaluated", version: rows[0].version, score: detail.score.outcome === "scored" ? detail.score.value : null,
      outcome: scored ? "scored" : "insufficient-data", weightSetName: detail.weightSet.name, submittedByName: actor.name, submittedAt: rows[0].submittedAt,
    };
  }

  return { submitEvaluation };
}
