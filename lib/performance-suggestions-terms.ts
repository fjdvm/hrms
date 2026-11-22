import { KPI_IDS, type KpiId, type NotApplicableReason } from "./performance-scoring";
import { cleanMultiline, hasDisallowedText } from "./validators/text";

/**
 * The rules for suggested development areas, with no server imports so they can be tested with hand-written examples and shared with the
 * screens. The server repeats every check in `performance-suggestions.ts`.
 *
 * A suggestion is made from the locked KPI results of a submitted Evaluation. The AI is told only what it needs to name a gap: the
 * position text, each KPI's name, result and target, why a KPI is Not applicable, and the scheduled Trainings' id, title and objectives.
 * It is never given a name, an employee number, a branch or the evaluator's comments.
 */
export const MAX_SUGGESTIONS = 5;
export const GAP_MAX_LENGTH = 120;
export const RECOMMENDATION_MAX_LENGTH = 300;
export const REASON_MAX_LENGTH = 200;

/** The part of a KPI line the rules read. */
export type KpiFact = { id: KpiId; name: string; target: string; status: "scored" | "not-applicable"; result: number | null; reason: NotApplicableReason | null };
export type TrainingFact = { id: number; title: string; objectives: string };

/** The number in a target such as "100%" or "100". A target that holds no number can never be missed. */
export function targetValue(target: string): number | null {
  const match = /^\s*(\d+(?:\.\d+)?)\s*%?\s*$/.exec(target);
  return match ? Number(match[1]) : null;
}

/** A KPI is below target when it has a result and that result is under the target. Exactly at target is not below; Not applicable is never below. */
export function isBelowTarget(kpi: KpiFact): boolean {
  if (kpi.status !== "scored" || kpi.result === null) return false;
  const target = targetValue(kpi.target);
  return target !== null && kpi.result < target;
}

const NOT_APPLICABLE_WORDS: Record<NotApplicableReason, string> = {
  "no-attendance": "no attendance records",
  "no-present-days": "no present days",
  "no-training-due": "no Training was due",
  "no-rating": "no rating entered",
  inactive: "the KPI is switched off",
  "no-linked-account": "no POS account is linked",
  "before-go-live": "the period starts before POS go-live",
  "no-import-after-period": "no POS import has run since the period ended",
  "no-target": "no sales target is set",
  "too-few-present-days": "too few present days",
};

/** The one-decimal figure the page shows, so a suggestion quotes a result exactly as HR reads it. */
export const shownResult = (result: number) => result.toFixed(1);

export type SuggestionRequestInput = { position: string; kpis: readonly KpiFact[]; trainings: readonly TrainingFact[] };

const SYSTEM = [
  "You help HR find job-related development areas for an Employee from the KPI results of a locked performance evaluation.",
  "Suggest at most five development areas, each tied to ONE KPI that is below its target (use that KPI's id exactly).",
  "For each, name the gap in a short title, recommend a scheduled Training by its id when one clearly matches its objectives (otherwise use trainingId null and name a topic in the recommendation), and give a one-line reason.",
  "Only suggest from the KPIs and Trainings provided. Do not invent Trainings, ids or figures. Never rate anyone, never change a score or status, never assign a Training.",
  "Keep it about the job. Do not mention a person's name, age, gender, health, family, religion or any personal matter. Plain text only.",
].join(" ");

/**
 * The request for the AI. It holds the position text, each KPI's name, result and target, the Not-applicable reasons and the scheduled
 * Trainings (id, title, objectives), and nothing that names or locates the Employee.
 */
export function buildSuggestionRequest({ position, kpis, trainings }: SuggestionRequestInput) {
  const body = {
    position: cleanMultiline(position),
    kpis: kpis.map((kpi) => ({
      id: kpi.id,
      name: kpi.name,
      target: kpi.target,
      result: kpi.status === "scored" && kpi.result !== null ? Number(shownResult(kpi.result)) : null,
      belowTarget: isBelowTarget(kpi),
      ...(kpi.status === "not-applicable" && kpi.reason ? { notApplicable: NOT_APPLICABLE_WORDS[kpi.reason] } : {}),
    })),
    trainings: trainings.map((training) => ({ id: training.id, title: training.title, objectives: training.objectives })),
  };
  return { system: SYSTEM, user: JSON.stringify(body) };
}

/** The structured output the AI must follow (OpenAI strict JSON schema). Our own validation below is the check that counts. */
export const SUGGESTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      maxItems: MAX_SUGGESTIONS,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kpiId", "gap", "trainingId", "recommendation", "reason"],
        properties: {
          kpiId: { type: "string", enum: [...KPI_IDS] },
          gap: { type: "string" },
          trainingId: { type: ["integer", "null"] },
          recommendation: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
} as const;

export type SuggestionDraft = { kpiId: KpiId; gap: string; trainingId: number | null; recommendation: string; reason: string };

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string" || hasDisallowedText(value)) return null;
  const cleaned = cleanMultiline(value).replace(/\n+/g, " ");
  return cleaned !== "" && cleaned.length <= max ? cleaned : null;
}

/**
 * Checks the AI's answer against our own rules. Returns the usable suggestions, or null when the answer cannot be used (so it is
 * regenerated once, then reported as unusable). Each suggestion must name a KPI that is below target and have a gap, a recommendation
 * and a one-line reason within their limits. A Training id that is not one of the scheduled Trainings offered is dropped: the
 * suggestion stays, with no Training. There must be one to five.
 */
export function parseSuggestions(output: unknown, allowed: { belowTarget: readonly string[]; trainingIds: readonly number[] }): SuggestionDraft[] | null {
  const list = (output as { suggestions?: unknown } | null)?.suggestions;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SUGGESTIONS) return null;
  const drafts: SuggestionDraft[] = [];
  for (const item of list) {
    if (item === null || typeof item !== "object") return null;
    const { kpiId, gap, trainingId, recommendation, reason } = item as Record<string, unknown>;
    if (typeof kpiId !== "string" || !allowed.belowTarget.includes(kpiId)) return null;
    const cleanedGap = text(gap, GAP_MAX_LENGTH);
    const cleanedRecommendation = text(recommendation, RECOMMENDATION_MAX_LENGTH);
    const cleanedReason = text(reason, REASON_MAX_LENGTH);
    if (cleanedGap === null || cleanedRecommendation === null || cleanedReason === null) return null;
    if (trainingId !== null && trainingId !== undefined && typeof trainingId !== "number") return null;
    drafts.push({
      kpiId: kpiId as KpiId, gap: cleanedGap, recommendation: cleanedRecommendation, reason: cleanedReason,
      trainingId: typeof trainingId === "number" && allowed.trainingIds.includes(trainingId) ? trainingId : null,
    });
  }
  return drafts;
}

export type SuggestionProblem = "not-evaluated" | "unknown-suggestion" | "already-reviewed" | "superseded" | "earlier-version";

export const SUGGESTION_MESSAGES: Record<SuggestionProblem, string> = {
  "not-evaluated": "Suggestions can be used once the evaluation is submitted.",
  "unknown-suggestion": "That suggestion could not be found.",
  "already-reviewed": "That suggestion has already been flagged or dismissed.",
  superseded: "That suggestion belongs to an earlier set. Use the latest suggestions.",
  "earlier-version": "That suggestion belongs to an earlier submitted version. It is kept for reference only.",
};

export const suggestionMessage = (problem: SuggestionProblem) => SUGGESTION_MESSAGES[problem];
