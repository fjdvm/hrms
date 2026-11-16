import { randomUUID } from "node:crypto";
import type { Database } from "./database";
import { retryJobPostingAudit } from "./job-posting-audit";
import type { evaluationsModule } from "./performance-evaluations";
import type { Actor } from "./performance-kpis";
import { cleanMultiline, hasDisallowedText } from "./validators/text";

/**
 * Reopening an evaluated evaluation. One of the small domain modules behind the Performance interface; it takes the Staff
 * member and the database from the seam, so access is decided there.
 *
 * Only an Evaluated evaluation can be reopened, and a reason is required. Reopening returns it to In review and records who,
 * when and why. The submitted version it came from is kept exactly as it was; its results are recomputed from the current
 * attendance rows, Training results and rating, but with the weights and formulas saved at the first submission (the read
 * model does that, see `performance-evaluations.ts`). Submitting again follows the same four checks and saves a new version.
 *
 * Two reopens at the same moment cannot both succeed: the change is a conditional update that only applies while the
 * evaluation is Evaluated, and one reopen is recorded per submitted version. The audit event goes through the existing audit
 * outbox in the same statement, and is then delivered at once; if delivery fails it is retried later.
 */

export type ReopenProblem = "reason-required" | "reason-invalid" | "reason-too-long" | "not-evaluated";

export class ReopenError extends Error {
  constructor(public readonly problem: ReopenProblem) {
    super(`Reopen: ${problem}`);
  }
}

export type ReopenedEvaluation = { employeeId: number; periodId: number; status: "In review"; version: number; reason: string; reopenedByName: string; reopenedAt: string };

export const REASON_MAX_LENGTH = 500;

/** The reason is required: cleaned, but refused (not quietly changed) when it holds characters that do not belong in it. */
export function readReopenReason(value: unknown): string {
  if (value === undefined || value === null) throw new ReopenError("reason-required");
  if (typeof value !== "string" || hasDisallowedText(value)) throw new ReopenError("reason-invalid");
  const reason = cleanMultiline(value);
  if (!reason) throw new ReopenError("reason-required");
  if (reason.length > REASON_MAX_LENGTH) throw new ReopenError("reason-too-long");
  return reason;
}

export function reopenModule(db: Database, deps: { evaluations: ReturnType<typeof evaluationsModule> }) {
  async function reopenEvaluation(actor: Actor, employeeId: number, periodId: number, reasonInput: unknown): Promise<ReopenedEvaluation> {
    const reason = readReopenReason(reasonInput);
    const { detail, evaluation, employee } = await deps.evaluations.liveDetail(employeeId, periodId);
    if (!evaluation || evaluation.status !== "Evaluated") throw new ReopenError("not-evaluated");

    const auditId = randomUUID();
    const event = {
      // The audit service accepts the generic record actions for HRMS, so the operation is named in the metadata.
      source: "HRMS", module: "Performance", action: "record.updated", outcome: "success",
      actor: { type: "user", id: actor.id, display_name: actor.name },
      target: { type: "evaluation", id: `${employee.id}:${periodId}`, display_name: `${employee.name} · ${detail.period.name}` },
      description: `${actor.name} reopened the evaluation of ${employee.name} for ${detail.period.name}: ${reason}`,
      customer_description: null, occurred_at: new Date().toISOString(), idempotency_key: auditId,
      metadata: { operation: "evaluation.reopened", employee_id: employee.id, employee_number: employee.employeeNumber, period_id: periodId, reason },
    };

    // One statement. It applies only while the evaluation is Evaluated, so a second reopen finds nothing to change.
    const { rows } = await db.query<{ version: number; reopenedAt: string }>(`
      WITH reopened AS (
        UPDATE public.hrms_evaluations SET status = 'In review' WHERE id = $1 AND status = 'Evaluated' RETURNING id
      ), recorded AS (
        INSERT INTO public.hrms_evaluation_reopens (evaluation_id, version, reason, reopened_by_id, reopened_by_name)
        SELECT reopened.id, (SELECT max(version) FROM public.hrms_evaluation_submissions WHERE evaluation_id = reopened.id), $2, $3, $4 FROM reopened
        RETURNING version, reopened_at
      ), queued AS (
        INSERT INTO public.hrms_audit_outbox (id, payload)
        SELECT $5, jsonb_set($6::jsonb, '{metadata,version}', to_jsonb(recorded.version)) FROM recorded
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $3, $4, 'evaluation-reopened', 'evaluation', $7, jsonb_build_object('employeeId', $8::int, 'periodId', $9::int, 'version', recorded.version, 'reason', $2::text) FROM recorded
      ) SELECT version, reopened_at::text AS "reopenedAt" FROM recorded`,
    [evaluation.id, reason, actor.id, actor.name, auditId, JSON.stringify(event), `${employee.id}:${periodId}`, employee.id, periodId]);
    if (!rows[0]) throw new ReopenError("not-evaluated");

    // Delivery is isolated from the committed reopen: a failure leaves the event queued for the next retry.
    await retryJobPostingAudit(db, auditId);
    return { employeeId: employee.id, periodId, status: "In review", version: rows[0].version, reason, reopenedByName: actor.name, reopenedAt: rows[0].reopenedAt };
  }

  return { reopenEvaluation };
}
