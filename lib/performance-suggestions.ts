import type { Database } from "./database";
import { draftsLeft, readAiConfig, runAi, describeFailure, type AiBanner, type AiClient, type AiConfig, type AiFailure } from "./ai";
import { logRefusal } from "./ai/usage";
import type { evaluationsModule } from "./performance-evaluations";
import type { Actor } from "./performance-kpis";
import { NEED_COLUMNS, NeedError, readNeedText, readTrainingId, type DevelopmentNeed, type NeedInput } from "./performance-needs";
import {
  MAX_SUGGESTIONS, SUGGESTION_SCHEMA, buildSuggestionRequest, isBelowTarget, parseSuggestions, shownResult, type SuggestionDraft, type SuggestionProblem,
} from "./performance-suggestions-terms";
import type { trainingCompletionModule } from "./performance-training";

export { MAX_SUGGESTIONS, type SuggestionProblem };

/**
 * Suggested development areas. One of the small domain modules behind the Performance interface; it takes the Staff member and the
 * database from the seam, so access is decided there.
 *
 * On an Evaluated Evaluation whose result is scored and has a KPI below target, the AI is asked for up to five suggested development
 * areas from the locked KPI results. They are validated, saved as a set against the submitted version they came from, and can be flagged
 * as a development need or dismissed. Nothing here changes a score, a rating or a status, and nothing assigns a Training or sends an email.
 *
 * Refusals that need no AI call are decided in code first: an Evaluation that is not Evaluated is refused; one with Insufficient data is
 * Not available (AI-0100); one where every applicable KPI is at or above target has Nothing to suggest, and neither uses a daily slot.
 * Regenerate saves a new set and marks the old one superseded; nothing is deleted. After a Reopen the previous version's set is still
 * returned, labelled with its version, and generating is refused until the Evaluation is Evaluated again.
 *
 * Each change and its Performance audit row are one statement.
 */

export class SuggestionError extends Error {
  constructor(public readonly problem: SuggestionProblem) {
    super(`Suggestion: ${problem}`);
  }
}

/** What a screen may know about a refusal or failure: the banner, the message and, on a red error, the Reference ID. Never the internal code. */
export type SuggestionFailure = { banner: AiBanner; message: string | null; referenceId: string | null };
const toFailure = ({ banner, message, referenceId }: AiFailure): SuggestionFailure => ({ banner, message, referenceId });

export type Suggestion = {
  id: number;
  position: number;
  kpiId: string;
  gap: string;
  /** The KPI result as shown on the page (one decimal) and its target, for example 88 and "100%". */
  result: number;
  target: string;
  trainingId: number | null;
  /** The matching scheduled Training's title, when there is one. */
  trainingTitle: string | null;
  recommendation: string;
  reason: string;
  status: "Pending" | "Flagged" | "Dismissed";
  needId: number | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
};

export type SuggestionSet = {
  id: number;
  /** The submitted version these suggestions were made from. */
  version: number;
  model: string;
  generatedByName: string;
  generatedAt: string;
  suggestions: Suggestion[];
};

/** The set a page shows. `actionable` is false for a set from an earlier version or while the Evaluation is back In review: it is read-only. */
export type SuggestionView = { set: SuggestionSet | null; currentVersion: number | null; actionable: boolean };

export type GenerateResult =
  | { ok: true; set: SuggestionSet; left: number }
  /** Every applicable KPI is at or above target: nothing to suggest, no AI call, no slot used. */
  | { ok: false; kind: "nothing"; left: number }
  /** A refusal or failure: Insufficient data (grey), a limit (yellow), a service problem (red) and so on. */
  | { ok: false; kind: "ai"; failure: SuggestionFailure; left: number };

export type SuggestionStatus = { enabled: boolean; left: number; limit: number };

type Options = { client?: AiClient; config?: AiConfig; now?: () => Date };

type SetRow = { id: number; version: number; model: string; generatedByName: string; generatedAt: string };
type SuggestionRow = Suggestion;
const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === "23505";

export function suggestionsModule(db: Database, deps: { evaluations: ReturnType<typeof evaluationsModule>; training: ReturnType<typeof trainingCompletionModule> }, options: Options = {}) {
  const config = () => options.config ?? readAiConfig();
  const now = () => (options.now ?? (() => new Date()))();

  async function evaluationRow(employeeId: number, periodId: number) {
    const { rows } = await db.query<{ id: number; status: "In review" | "Evaluated"; version: number | null }>(
      `SELECT e.id, e.status, (SELECT max(version) FROM public.hrms_evaluation_submissions WHERE evaluation_id = e.id) AS version
       FROM public.hrms_evaluations e WHERE e.employee_id = $1 AND e.period_id = $2`, [employeeId, periodId]);
    return rows[0] ?? null;
  }

  async function loadSet(setId: number): Promise<SuggestionSet> {
    const set = (await db.query<SetRow>(
      `SELECT id, version, model, generated_by_name AS "generatedByName", generated_at::text AS "generatedAt" FROM public.hrms_suggestion_sets WHERE id = $1`, [setId])).rows[0];
    const { rows } = await db.query<SuggestionRow>(
      `SELECT s.id, s.position, s.kpi_id AS "kpiId", s.gap, s.kpi_result::float8 AS result, s.kpi_target AS target, s.training_id AS "trainingId", t.title AS "trainingTitle",
         s.recommendation, s.reason, s.status, s.need_id AS "needId", s.reviewed_by_name AS "reviewedByName", s.reviewed_at::text AS "reviewedAt"
       FROM public.hrms_suggestions s LEFT JOIN public.hrms_trainings t ON t.id = s.training_id WHERE s.set_id = $1 ORDER BY s.position`, [setId]);
    return { ...set, suggestions: rows };
  }

  /** The current set of the latest version that has one, and whether it can still be acted on. Reads only. */
  async function suggestionsFor(employeeId: number, periodId: number): Promise<SuggestionView> {
    await deps.evaluations.evaluationFor(employeeId, periodId);
    const evaluation = await evaluationRow(employeeId, periodId);
    if (!evaluation) return { set: null, currentVersion: null, actionable: false };
    const found = await db.query<{ id: number; version: number }>(
      `SELECT id, version FROM public.hrms_suggestion_sets WHERE evaluation_id = $1 AND status = 'current' ORDER BY version DESC, id DESC LIMIT 1`, [evaluation.id]);
    if (!found.rows[0]) return { set: null, currentVersion: evaluation.version, actionable: false };
    return {
      set: await loadSet(found.rows[0].id), currentVersion: evaluation.version,
      actionable: evaluation.status === "Evaluated" && found.rows[0].version === evaluation.version,
    };
  }

  async function status(actor: Actor): Promise<SuggestionStatus> {
    const settings = config();
    return { enabled: settings.enabled.suggestions, left: await draftsLeft(db, actor.id, "suggestions", settings, now()), limit: settings.limits.suggestions };
  }

  async function generate(actor: Actor, employeeId: number, periodId: number): Promise<GenerateResult> {
    const settings = config();
    const left = () => draftsLeft(db, actor.id, "suggestions", settings, now());
    const detail = await deps.evaluations.evaluationFor(employeeId, periodId);
    if (detail.status !== "Evaluated" || !detail.submitted) throw new SuggestionError("not-evaluated");
    const version = detail.submitted.version;

    // Decided in code, before any AI call: neither uses a daily slot.
    if (detail.score.outcome !== "scored") {
      await logRefusal(db, { staffId: actor.id, feature: "suggestions", model: settings.model, reason: "not-available", now: now() });
      return { ok: false, kind: "ai", failure: toFailure({ ...describeFailure("not-available", "suggestions", settings.limits.suggestions) }), left: await left() };
    }
    const below = detail.kpis.filter(isBelowTarget);
    if (below.length === 0) return { ok: false, kind: "nothing", left: await left() };

    const trainings = await deps.training.scheduledForSuggestions();
    const prompt = buildSuggestionRequest({ position: detail.position, kpis: detail.kpis, trainings });
    const result = await runAi<SuggestionDraft[]>({
      db, staffId: actor.id, feature: "suggestions", client: options.client, config: settings, now: options.now,
      request: { ...prompt, schemaName: "development_suggestions", schema: SUGGESTION_SCHEMA },
      parse: (output) => parseSuggestions(output, { belowTarget: below.map((kpi) => kpi.id), trainingIds: trainings.map((training) => training.id) }),
    });
    if (!result.ok) return { ok: false, kind: "ai", failure: toFailure(result), left: await left() };

    const lines = new Map(detail.kpis.map((kpi) => [kpi.id, kpi]));
    const items = result.value.slice(0, MAX_SUGGESTIONS).map((draft) => {
      const kpi = lines.get(draft.kpiId)!;
      return { kpiId: draft.kpiId, gap: draft.gap, result: Number(shownResult(kpi.result as number)), target: kpi.target, trainingId: draft.trainingId, recommendation: draft.recommendation, reason: draft.reason };
    });
    const evaluation = await evaluationRow(employeeId, periodId);
    if (!evaluation) throw new SuggestionError("not-evaluated");

    // One statement: the old set is superseded, the new set and its suggestions are saved, and the audit row is written.
    const save = () => db.query<{ setId: number }>(`
      WITH old AS (
        UPDATE public.hrms_suggestion_sets SET status = 'superseded' WHERE evaluation_id = $1 AND version = $2 AND status = 'current' RETURNING id
      ), made AS (
        INSERT INTO public.hrms_suggestion_sets (evaluation_id, version, model, generated_by_id, generated_by_name)
        SELECT $1::int, $2::int, $3::text, $4::text, $5::text FROM (SELECT count(*) FROM old) AS ordered RETURNING id
      ), items AS (
        INSERT INTO public.hrms_suggestions (set_id, position, kpi_id, gap, kpi_result, kpi_target, training_id, recommendation, reason)
        SELECT made.id, entry.ordinality, entry.value->>'kpiId', entry.value->>'gap', (entry.value->>'result')::numeric, entry.value->>'target',
          (entry.value->>'trainingId')::int, entry.value->>'recommendation', entry.value->>'reason'
        FROM made, jsonb_array_elements($6::jsonb) WITH ORDINALITY AS entry(value, ordinality)
        RETURNING id
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $4::text, $5::text, 'development-suggestions-generated', 'evaluation', $7::text,
          jsonb_build_object('employeeId', $8::int, 'periodId', $9::int, 'setId', made.id, 'version', $2::int, 'count', (SELECT count(*) FROM items))
        FROM made
      ) SELECT id AS "setId" FROM made`,
    [evaluation.id, version, settings.model, actor.id, actor.name, JSON.stringify(items), `${employeeId}:${periodId}`, employeeId, periodId]);
    let saved;
    try {
      saved = await save();
    } catch (error) {
      // Two generations at the same moment: the other one won the "current" place. Try once more so this set supersedes it.
      if (!isUniqueViolation(error)) throw error;
      saved = await save();
    }
    return { ok: true, set: await loadSet(saved.rows[0].setId), left: await left() };
  }

  type Target = {
    id: number; status: Suggestion["status"]; gap: string; recommendation: string; trainingId: number | null; trainingTitle: string | null;
    setStatus: "current" | "superseded"; version: number; evaluationStatus: "In review" | "Evaluated"; currentVersion: number;
  };

  /** Finds the suggestion and says why it cannot be acted on, if it cannot. */
  async function readTarget(suggestionId: unknown): Promise<Target> {
    if (typeof suggestionId !== "number" || !Number.isInteger(suggestionId) || suggestionId < 1 || suggestionId > 2147483647) throw new SuggestionError("unknown-suggestion");
    const { rows } = await db.query<Target>(
      `SELECT s.id, s.status, s.gap, s.recommendation, s.training_id AS "trainingId", t.title AS "trainingTitle", st.status AS "setStatus", st.version,
         e.status AS "evaluationStatus", (SELECT max(version) FROM public.hrms_evaluation_submissions WHERE evaluation_id = st.evaluation_id) AS "currentVersion"
       FROM public.hrms_suggestions s
       JOIN public.hrms_suggestion_sets st ON st.id = s.set_id
       JOIN public.hrms_evaluations e ON e.id = st.evaluation_id
       LEFT JOIN public.hrms_trainings t ON t.id = s.training_id
       WHERE s.id = $1`, [suggestionId]);
    const target = rows[0];
    if (!target) throw new SuggestionError("unknown-suggestion");
    if (target.status !== "Pending") throw new SuggestionError("already-reviewed");
    if (target.setStatus !== "current") throw new SuggestionError("superseded");
    if (target.evaluationStatus !== "Evaluated") throw new SuggestionError("not-evaluated");
    if (target.version !== target.currentVersion) throw new SuggestionError("earlier-version");
    return target;
  }

  /**
   * Flags a suggestion as a development need with the AI source and the link back to it, and marks the suggestion Flagged. The Gap and the
   * Recommended action start as the suggestion's own words and can be edited first (the same rules as a need typed by hand). It cannot be
   * done twice, and never changes the score, rating or status.
   */
  async function flagSuggestion(actor: Actor, suggestionId: number, input: Partial<NeedInput> = {}): Promise<DevelopmentNeed> {
    const target = await readTarget(suggestionId);
    const gap = readNeedText("gap", input.gap ?? target.gap);
    const action = readNeedText("action", input.action ?? (target.trainingTitle ? `Training: ${target.trainingTitle}` : target.recommendation));
    const trainingId = readTrainingId(input.trainingId === undefined ? target.trainingId : input.trainingId);
    // A Training id that names no Training is refused like on a need typed by hand.
    if (trainingId !== null && !(await db.query(`SELECT 1 FROM public.hrms_trainings WHERE id = $1`, [trainingId])).rows.length) throw new NeedError("unknown-training");

    const { rows } = await db.query<DevelopmentNeed>(`
      WITH picked AS (
        SELECT s.id, e.employee_id, e.period_id
        FROM public.hrms_suggestions s
        JOIN public.hrms_suggestion_sets st ON st.id = s.set_id
        JOIN public.hrms_evaluations e ON e.id = st.evaluation_id
        WHERE s.id = $1 AND s.status = 'Pending' AND st.status = 'current' AND e.status = 'Evaluated'
          AND ($4::int IS NULL OR EXISTS (SELECT 1 FROM public.hrms_trainings WHERE id = $4))
        FOR UPDATE OF s
      ), added AS (
        INSERT INTO public.hrms_development_needs (employee_id, period_id, gap, action, training_id, source, suggestion_id, flagged_by_id, flagged_by_name)
        SELECT employee_id, period_id, $2::text, $3::text, $4::int, 'ai', id, $5::text, $6::text FROM picked RETURNING *
      ), marked AS (
        UPDATE public.hrms_suggestions s SET status = 'Flagged', need_id = added.id, reviewed_by_id = $5::text, reviewed_by_name = $6::text, reviewed_at = clock_timestamp()
        FROM added WHERE s.id = added.suggestion_id RETURNING s.id
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $5::text, $6::text, 'development-suggestion-flagged', 'evaluation', added.employee_id::text || ':' || added.period_id::text,
          jsonb_build_object('employeeId', added.employee_id, 'periodId', added.period_id, 'suggestionId', added.suggestion_id, 'needId', added.id, 'trainingId', added.training_id)
        FROM added
      ) SELECT ${NEED_COLUMNS} FROM added`,
    [suggestionId, gap, action, trainingId, actor.id, actor.name]);
    // A second click at the same moment finds the suggestion no longer Pending and adds nothing.
    if (!rows[0]) throw new SuggestionError("already-reviewed");
    return rows[0];
  }

  /** Marks a Pending suggestion Dismissed, with who dismissed it and when. It changes nothing else. */
  async function dismissSuggestion(actor: Actor, suggestionId: number): Promise<{ id: number; status: "Dismissed" }> {
    await readTarget(suggestionId);
    const { rows } = await db.query<{ id: number }>(`
      WITH picked AS (
        SELECT s.id, e.employee_id, e.period_id
        FROM public.hrms_suggestions s
        JOIN public.hrms_suggestion_sets st ON st.id = s.set_id
        JOIN public.hrms_evaluations e ON e.id = st.evaluation_id
        WHERE s.id = $1 AND s.status = 'Pending' AND st.status = 'current' AND e.status = 'Evaluated'
        FOR UPDATE OF s
      ), marked AS (
        UPDATE public.hrms_suggestions s SET status = 'Dismissed', reviewed_by_id = $2::text, reviewed_by_name = $3::text, reviewed_at = clock_timestamp()
        FROM picked WHERE s.id = picked.id RETURNING s.id
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $2::text, $3::text, 'development-suggestion-dismissed', 'evaluation', picked.employee_id::text || ':' || picked.period_id::text,
          jsonb_build_object('employeeId', picked.employee_id, 'periodId', picked.period_id, 'suggestionId', picked.id)
        FROM picked
      ) SELECT id FROM marked`, [suggestionId, actor.id, actor.name]);
    if (!rows[0]) throw new SuggestionError("already-reviewed");
    return { id: rows[0].id, status: "Dismissed" };
  }

  return { status, suggestionsFor, generate, flagSuggestion, dismissSuggestion };
}
