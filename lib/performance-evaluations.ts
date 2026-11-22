import type { Database } from "./database";
import { isEvaluationTab, isOnRoster, statusOf, progressOf, submitReadiness, tabCounts, type EvaluationStatus, type EvaluationTab, type SubmitReadiness } from "./performance-evaluations-terms";
import type { attendanceModule, AttendanceIssue } from "./performance-attendance";
import type { Kpi, kpiModule, WeightSet } from "./performance-kpis";
import { PeriodError, type Period, type periodsModule } from "./performance-periods";
import { SALES_MIN_PRESENT_DAYS } from "./performance-sales-scoring";
import type { salesInputsModule } from "./performance-sales-inputs";
import { INSUFFICIENT_DATA_FLOOR_PERCENT, KPI_IDS, SCORING_FORMULAS, SCORING_RULES_VERSION, scoreEvaluation, type KpiId, type NotApplicableReason } from "./performance-scoring";
import { RESULTS_NOT_MARKED, type trainingCompletionModule } from "./performance-training";

/**
 * The Performance roster and the Evaluation page's read model. One of the small domain modules behind the Performance
 * interface: it composes the periods, attendance, Training completion, KPIs and weight sets and the scoring engine, and
 * writes nothing. Saving a rating and submitting are their own modules.
 *
 * An Evaluated evaluation is read from the version saved when it was submitted (the KPI results, the weights, the weight set's
 * name, the figures), never recomputed, so nothing that changes afterwards can alter it. A reopened one is recomputed from
 * current attendance, Training results and rating, but with the weights, the weight set, the deactivated KPIs, the grace period
 * and the floor saved at its first submission, so a weight or formula change made since has no effect.
 *
 * The roster of a period is every Active Employee whose start date is on or before the period's end date, so an Employee who
 * becomes Active or gets a shift mid-period appears with no enrolment and an Onboarding Employee does not. An Employee with a
 * saved evaluation in the period stays in it, whatever later happens to their record.
 */

export type Shift = { start: string; end: string; workingDays: number[] };
export type Score = { outcome: "scored"; value: number } | { outcome: "insufficient-data" } | { outcome: "not-scored"; reason: "shift-missing" };
export type KpiLine = {
  id: KpiId; name: string; description: string; source: string; target: string;
  status: "scored" | "not-applicable";
  /** The result from 0 to 100, or null when it is Not applicable. */
  result: number | null;
  /** The KPI's weight in the applied weight set, and the weight actually used once Not-applicable results were left out. */
  weight: number; weightUsed: number | null; points: number | null;
  reason: NotApplicableReason | null;
  /** Set on Training completion when some Trainings have no result marked yet. */
  flag: string | null;
};

type Common = {
  employeeId: number; employeeNumber: string; name: string; position: string; branch: string;
  status: EvaluationStatus;
  shift: Shift | null;
  attendance: { imported: boolean; confirmedNone: boolean; openIssues: number };
  weightSet: { id: number; name: string; isDefault: boolean } | null;
  score: Score;
  kpis: KpiLine[];
};
export type RosterRow = Common & { scheduledDays: number | null; excusedDays: number | null; rating: number | null };
/** What was saved when an evaluation was submitted, for the page. */
export type SubmittedVersion = { version: number; submittedByName: string; submittedAt: string; formulas: SnapshotFormulas };
/** The formulas and figures in force at a submission. `salesTarget` and `salesMinPresentDays` are saved only when the weight set weighs sales, so a reopened evaluation scores sales as it was first scored. */
export type SnapshotFormulas = { version: string; kpis: Record<string, string>; graceMinutes: number; floorPercent: number; salesTarget?: number | null; salesMinPresentDays?: number };
export type DayCounts = { counted: number; present: number; late: number; earlyOut: number };
/** One submitted version of an evaluation, kept for good, with the reopen that followed it if there was one. */
export type VersionSummary = {
  version: number; outcome: "scored" | "insufficient-data"; score: number | null; rating: number; weightSetName: string;
  submittedByName: string; submittedAt: string;
  reopened: { reason: string; reopenedByName: string; reopenedAt: string } | null;
};
export type EvaluationDetail = Common & {
  period: Period;
  /** The formulas, grace period and floor this evaluation is scored with. */
  formulas: SnapshotFormulas;
  /** True when a reopened evaluation is scored with the weights and formulas saved at its first submission. */
  rulesFrozen: boolean;
  /** Every submitted version so far, oldest first. Empty until the first submit. */
  history: VersionSummary[];
  /** The day figures behind the score, null when the Employee has no shift. */
  counts: DayCounts | null;
  /** The saved version when the evaluation has been submitted; null while it is still being worked on. */
  submitted: SubmittedVersion | null;
  scheduledDays: string[];
  excusedDays: string[];
  graceMinutes: number;
  /** The weights actually used after leaving out Not-applicable results. */
  weightsUsed: Partial<Record<KpiId, number>>;
  weights: WeightSet["weights"] | null;
  rating: { value: number; comments: string; savedByName: string; savedAt: string } | null;
  issues: AttendanceIssue[];
  resultsNotMarked: number;
  submit: SubmitReadiness;
};
export type Roster = {
  period: Period;
  tab: EvaluationTab;
  rows: RosterRow[];
  counts: Record<EvaluationTab, number>;
  progress: { evaluated: number; total: number; percent: number };
  /** The Employees who cannot be scored because their shift is missing, for the warning and its "Set shift" link. */
  notScored: { employeeId: number; employeeNumber: string; name: string }[];
};

export class RosterError extends Error {
  constructor(public readonly problem: "not-in-roster" | "unknown-tab") {
    super(`Roster: ${problem}`);
  }
}

type EmployeeRow = {
  id: number; employeeNumber: string; name: string; position: string; branch: string; status: string; start: string;
  shiftStart: string | null; shiftEnd: string | null; workingDays: number[] | null;
};
type EvaluationRow = { id: number; employeeId: number; rating: number; comments: string; status: "In review" | "Evaluated"; savedByName: string; savedAt: string };
type SubmissionRow = {
  id: number; version: number; outcome: "scored" | "insufficient-data"; score: string | null; rating: number; comments: string;
  weightSetId: number | null; weightSetName: string; weightSetDefault: boolean; weights: WeightSet["weights"]; weightsUsed: Partial<Record<KpiId, number>>;
  formulas: SnapshotFormulas; figures: Figures; submittedByName: string; submittedAt: string;
};
type ResultRow = { kpiId: KpiId; name: string; description: string; source: string; target: string; status: "scored" | "not-applicable"; result: string | null; weight: number; weightUsed: string | null; points: string | null; reason: NotApplicableReason | null; flag: string | null };
/** The figures saved with a submission. */
export type Figures = {
  shift: Shift | null; scheduledDays: string[]; excusedDays: string[]; graceMinutes: number; counts: DayCounts | null;
  attendance: { imported: boolean; confirmedNone: boolean; openIssues: number }; resultsNotMarked: number;
};
const CHUNK = 8;

export type EvaluationDeps = {
  periods: ReturnType<typeof periodsModule>;
  attendance: ReturnType<typeof attendanceModule>;
  training: ReturnType<typeof trainingCompletionModule>;
  kpis: ReturnType<typeof kpiModule>;
  sales: ReturnType<typeof salesInputsModule>;
};

/** The formulas, grace period and floor in force today, as saved with a submission. */
export const formulasInForce = (graceMinutes: number, sales?: { target: number | null }): SnapshotFormulas => ({
  version: SCORING_RULES_VERSION, kpis: { ...SCORING_FORMULAS }, graceMinutes, floorPercent: INSUFFICIENT_DATA_FLOOR_PERCENT,
  ...(sales ? { salesTarget: sales.target, salesMinPresentDays: SALES_MIN_PRESENT_DAYS } : {}),
});

export function evaluationsModule(db: Database, deps: EvaluationDeps) {
  const EMPLOYEE_COLUMNS = `id, employee_number AS "employeeNumber", full_name AS name, position, branch, status, start_date::text AS start,
    to_char(shift_start, 'HH24:MI') AS "shiftStart", to_char(shift_end, 'HH24:MI') AS "shiftEnd", working_days::int[] AS "workingDays"`;

  async function evaluationsOf(periodId: number): Promise<Map<number, EvaluationRow>> {
    const { rows } = await db.query<EvaluationRow>(`SELECT id, employee_id AS "employeeId", rating, comments, status, rated_by_name AS "savedByName", rated_at::text AS "savedAt" FROM public.hrms_evaluations WHERE period_id = $1`, [periodId]);
    return new Map(rows.map((row) => [row.employeeId, row]));
  }

  /** Everyone being evaluated in the period: the live roster, plus anyone with a saved evaluation. */
  async function rosterEmployees(period: Period, evaluations: Map<number, EvaluationRow>): Promise<EmployeeRow[]> {
    const { rows } = await db.query<EmployeeRow>(`
      SELECT ${EMPLOYEE_COLUMNS} FROM public.hrms_employees
      WHERE (status = 'Active' AND start_date <= $1::date) OR id = ANY($2::int[]) ORDER BY full_name, id`, [period.end, [...evaluations.keys()]]);
    return rows;
  }

  const shiftOf = (employee: EmployeeRow): Shift | null =>
    employee.shiftStart && employee.shiftEnd && employee.workingDays?.length ? { start: employee.shiftStart, end: employee.shiftEnd, workingDays: employee.workingDays } : null;

  /** The latest submitted version of an evaluation, with its KPI results, or null when it has none. */
  async function submissionOf(evaluationId: number): Promise<{ submission: SubmissionRow; results: ResultRow[] } | null> {
    const submission = (await db.query<SubmissionRow>(`
      SELECT id, version, outcome, score::text AS score, rating, comments, weight_set_id AS "weightSetId", weight_set_name AS "weightSetName", weight_set_default AS "weightSetDefault",
        weights, weights_used AS "weightsUsed", formulas, figures, submitted_by_name AS "submittedByName", submitted_at::text AS "submittedAt"
      FROM public.hrms_evaluation_submissions WHERE evaluation_id = $1 ORDER BY version DESC LIMIT 1`, [evaluationId])).rows[0];
    if (!submission) return null;
    const results = (await db.query<ResultRow>(`
      SELECT kpi_id AS "kpiId", name, description, source, target, status, result::text AS result, weight, weight_used::text AS "weightUsed", points::text AS points, reason, flag
      FROM public.hrms_evaluation_results WHERE submission_id = $1`, [submission.id])).rows;
    return { submission, results };
  }

  const num = (value: string | null) => (value === null ? null : Number(value));

  type FrozenRules = { weightSet: { id: number; name: string; isDefault: boolean }; weights: WeightSet["weights"]; inactive: KpiId[]; formulas: SnapshotFormulas };

  /** The weights and formulas saved at the first submission, for a reopened evaluation; null when it was never submitted. */
  async function firstSubmission(evaluationId: number): Promise<FrozenRules | null> {
    const row = (await db.query<{ weightSetId: number | null; weightSetName: string; weightSetDefault: boolean; weights: WeightSet["weights"]; formulas: SnapshotFormulas; inactive: KpiId[] | null }>(`
      SELECT s.weight_set_id AS "weightSetId", s.weight_set_name AS "weightSetName", s.weight_set_default AS "weightSetDefault", s.weights, s.formulas,
        (SELECT array_agg(r.kpi_id) FROM public.hrms_evaluation_results r WHERE r.submission_id = s.id AND r.reason = 'inactive') AS inactive
      FROM public.hrms_evaluation_submissions s WHERE s.evaluation_id = $1 AND s.version = 1`, [evaluationId])).rows[0];
    return row ? { weightSet: { id: row.weightSetId ?? 0, name: row.weightSetName, isDefault: row.weightSetDefault }, weights: row.weights, inactive: row.inactive ?? [], formulas: row.formulas } : null;
  }

  /** Every submitted version of an evaluation, oldest first, with the reopen that followed it. */
  async function historyOf(evaluationId: number): Promise<VersionSummary[]> {
    const { rows } = await db.query<{ version: number; outcome: "scored" | "insufficient-data"; score: string | null; rating: number; weightSetName: string; submittedByName: string; submittedAt: string; reason: string | null; reopenedByName: string | null; reopenedAt: string | null }>(`
      SELECT s.version, s.outcome, s.score::text AS score, s.rating, s.weight_set_name AS "weightSetName", s.submitted_by_name AS "submittedByName", s.submitted_at::text AS "submittedAt",
        o.reason, o.reopened_by_name AS "reopenedByName", o.reopened_at::text AS "reopenedAt"
      FROM public.hrms_evaluation_submissions s LEFT JOIN public.hrms_evaluation_reopens o ON o.evaluation_id = s.evaluation_id AND o.version = s.version
      WHERE s.evaluation_id = $1 ORDER BY s.version`, [evaluationId]);
    return rows.map((row) => ({
      version: row.version, outcome: row.outcome, score: num(row.score), rating: row.rating, weightSetName: row.weightSetName, submittedByName: row.submittedByName, submittedAt: row.submittedAt,
      reopened: row.reason === null ? null : { reason: row.reason, reopenedByName: row.reopenedByName!, reopenedAt: row.reopenedAt! },
    }));
  }

  type Assessed = {
    common: Common; scheduled: string[]; excused: string[]; weightsUsed: Partial<Record<KpiId, number>>; weights: WeightSet["weights"] | null;
    issues: AttendanceIssue[]; resultsNotMarked: number; shift: Shift | null; counts: DayCounts | null; graceMinutes: number;
    rating: number | null; comments: string | null; submitted: SubmittedVersion | null; formulas: SnapshotFormulas; rulesFrozen: boolean;
  };

  /** What was saved when the evaluation was submitted, shaped like a live assessment. */
  function fromSubmission(employee: EmployeeRow, evaluation: EvaluationRow, saved: { submission: SubmissionRow; results: ResultRow[] }): Assessed {
    const { submission, results } = saved;
    const figures = submission.figures;
    // Only the KPIs it was scored on: a KPI added since (the sales KPI, say) has no saved result and is not shown.
    const kpis = KPI_IDS.flatMap((id): KpiLine[] => {
      const row = results.find((entry) => entry.kpiId === id);
      return row ? [{ id, name: row.name, description: row.description, source: row.source, target: row.target, status: row.status, result: num(row.result), weight: row.weight, weightUsed: num(row.weightUsed), points: num(row.points), reason: row.reason, flag: row.flag }] : [];
    });
    return {
      common: {
        employeeId: employee.id, employeeNumber: employee.employeeNumber, name: employee.name, position: employee.position, branch: employee.branch,
        status: statusOf(evaluation), shift: figures.shift, attendance: figures.attendance,
        weightSet: { id: submission.weightSetId ?? 0, name: submission.weightSetName, isDefault: submission.weightSetDefault },
        score: submission.outcome === "scored" ? { outcome: "scored", value: Number(submission.score) } : { outcome: "insufficient-data" }, kpis,
      },
      scheduled: figures.scheduledDays, excused: figures.excusedDays, weightsUsed: submission.weightsUsed, weights: submission.weights, issues: [],
      resultsNotMarked: figures.resultsNotMarked, shift: figures.shift, counts: figures.counts, graceMinutes: figures.graceMinutes,
      rating: submission.rating, comments: submission.comments,
      submitted: { version: submission.version, submittedByName: submission.submittedByName, submittedAt: submission.submittedAt, formulas: submission.formulas },
      formulas: submission.formulas, rulesFrozen: false,
    };
  }

  /**
   * Everything worked out for one Employee in one period, from the same pieces the roster and the page both use. A submitted
   * evaluation is read from its saved version unless `live` asks for a fresh assessment (the submit itself does).
   */
  async function assess(employee: EmployeeRow, period: Period, evaluation: EvaluationRow | undefined, kpiList: Kpi[], { live = false } = {}): Promise<Assessed> {
    if (evaluation?.status === "Evaluated" && !live) {
      const saved = await submissionOf(evaluation.id);
      if (saved) return fromSubmission(employee, evaluation, saved);
    }
    const shift = shiftOf(employee);
    // A reopened evaluation keeps the weights and formulas it was first submitted with.
    const frozen = evaluation ? await firstSubmission(evaluation.id) : null;
    const graceMinutes = frozen ? frozen.formulas.graceMinutes : period.graceMinutes;
    const [attendance, training, current] = await Promise.all([
      deps.attendance.attendanceFor(employee.id, period.id),
      deps.training.trainingCompletion(employee.id, { from: period.start, to: period.end }),
      frozen ? Promise.resolve(null) : deps.kpis.weightSetFor(employee.position),
    ]);
    const weightSet = frozen ? { ...frozen.weightSet, weights: frozen.weights } : current!;
    const inactiveKpis = frozen ? frozen.inactive : kpiList.filter((kpi) => kpi.status === "Inactive").map((kpi) => kpi.id);
    const schedule = shift ? await deps.periods.scheduleFor(employee.id, period.id) : null;
    const scheduled = schedule?.scorable ? schedule.scheduledDays : [];
    const excused = schedule?.scorable ? schedule.excusedDays : [];

    // The sales KPI is scored only when the applied set weighs it; a reopened evaluation keeps the target and minimum it was first scored with.
    const salesWeight = weightSet.weights.sales ?? 0;
    const salesTarget = salesWeight > 0 ? (frozen && frozen.formulas.salesTarget !== undefined ? frozen.formulas.salesTarget : await deps.sales.target()) : null;
    const sales = shift && salesWeight > 0 ? await deps.sales.inputsFor(employee.id, period, salesTarget) : undefined;
    let score: Score = { outcome: "not-scored", reason: "shift-missing" };
    let kpis: KpiLine[] = [];
    let weightsUsed: Partial<Record<KpiId, number>> = {};
    let counts: DayCounts | null = null;
    if (shift) {
      const scoring = scoreEvaluation({
        rows: attendance.rows, shift: { start: shift.start, end: shift.end }, graceMinutes, scheduledDays: scheduled, excusedDays: excused,
        training: { completed: training.completion?.completed ?? 0, due: training.completion?.due ?? 0 }, rating: evaluation?.rating ?? null,
        weights: weightSet.weights, noAttendanceConfirmed: attendance.noAttendanceConfirmed, inactiveKpis, floorPercent: frozen?.formulas.floorPercent,
        sales, salesMinPresentDays: frozen?.formulas.salesMinPresentDays,
      });
      score = scoring.outcome === "scored" ? { outcome: "scored", value: scoring.score } : { outcome: "insufficient-data" };
      weightsUsed = scoring.weightsUsed;
      counts = scoring.counts;
      kpis = scoring.results.map((result): KpiLine => {
        const id = result.kpi;
        const kpi = kpiList.find((entry) => entry.id === id)!;
        const base = { id, name: kpi.name, description: kpi.description, source: kpi.source, target: kpi.target, weight: result.weight, flag: id === "trainingCompletion" && training.resultsNotMarked > 0 ? RESULTS_NOT_MARKED : null };
        return result.status === "scored"
          ? { ...base, status: "scored", result: result.result, weightUsed: result.weightUsed, points: result.points, reason: null }
          : { ...base, status: "not-applicable", result: null, weightUsed: null, points: null, reason: result.reason };
      });
    }

    const common: Common = {
      employeeId: employee.id, employeeNumber: employee.employeeNumber, name: employee.name, position: employee.position, branch: employee.branch,
      status: statusOf(evaluation), shift,
      attendance: { imported: attendance.attendanceImported, confirmedNone: attendance.noAttendanceConfirmed, openIssues: attendance.issues.length },
      weightSet: { id: weightSet.id, name: weightSet.name, isDefault: weightSet.isDefault }, score, kpis,
    };
    return {
      common, scheduled, excused, weightsUsed, weights: weightSet.weights, issues: attendance.issues, resultsNotMarked: training.resultsNotMarked, shift, counts,
      graceMinutes, rating: evaluation?.rating ?? null, comments: evaluation?.comments ?? null, submitted: null,
      formulas: frozen ? frozen.formulas : formulasInForce(period.graceMinutes, salesWeight > 0 ? { target: salesTarget } : undefined), rulesFrozen: frozen !== null,
    };
  }

  async function inChunks<T, R>(items: readonly T[], run: (item: T) => Promise<R>): Promise<R[]> {
    const out: R[] = [];
    for (let i = 0; i < items.length; i += CHUNK) out.push(...(await Promise.all(items.slice(i, i + CHUNK).map(run))));
    return out;
  }

  /**
   * Everyone being evaluated in a period, each with the derived status, score and attendance import status, the tab counts and
   * the progress figures, and the Employees not scored for a missing shift. Counts and progress are always for the whole roster;
   * `tab` only narrows the rows.
   */
  async function roster(periodId: number, tab: EvaluationTab = "All"): Promise<Roster> {
    if (!isEvaluationTab(tab)) throw new RosterError("unknown-tab");
    const period = await deps.periods.requirePeriod(periodId);
    const evaluations = await evaluationsOf(period.id);
    const employees = await rosterEmployees(period, evaluations);
    const kpiList = await deps.kpis.listKpis({ includeSales: true });
    const all = await inChunks(employees, async (employee): Promise<RosterRow> => {
      const evaluation = evaluations.get(employee.id);
      const assessed = await assess(employee, period, evaluation, kpiList);
      return { ...assessed.common, scheduledDays: assessed.shift ? assessed.scheduled.length : null, excusedDays: assessed.shift ? assessed.excused.length : null, rating: assessed.rating };
    });
    const statuses = all.map((row) => row.status);
    return {
      period, tab,
      rows: tab === "All" ? all : all.filter((row) => row.status === tab),
      counts: tabCounts(statuses),
      progress: progressOf(statuses),
      notScored: all.filter((row) => row.score.outcome === "not-scored").map((row) => ({ employeeId: row.employeeId, employeeNumber: row.employeeNumber, name: row.name })),
    };
  }

  /** Finds the Employee and period and checks the Employee is on the roster; shared by the page and the submit. */
  async function locate(employeeId: number, periodId: number) {
    const period = await deps.periods.requirePeriod(periodId);
    if (!Number.isInteger(employeeId) || employeeId < 1 || employeeId > 2147483647) throw new PeriodError("unknown-employee");
    const evaluations = await evaluationsOf(period.id);
    const found = (await db.query<EmployeeRow>(`SELECT ${EMPLOYEE_COLUMNS} FROM public.hrms_employees WHERE id = $1`, [employeeId])).rows[0];
    if (!found) throw new PeriodError("unknown-employee");
    const evaluation = evaluations.get(employeeId);
    if (!isOnRoster(found, period, evaluation !== undefined)) throw new RosterError("not-in-roster");
    return { period, employee: found, evaluation };
  }

  async function detailOf(period: Period, assessed: Assessed, evaluation: EvaluationRow | undefined): Promise<EvaluationDetail> {
    const submit = submitReadiness({ attendanceImported: assessed.common.attendance.imported, shiftSet: assessed.shift !== null, openIssues: assessed.issues.length, ratingEntered: evaluation !== undefined });
    return {
      ...assessed.common,
      period,
      formulas: assessed.formulas,
      rulesFrozen: assessed.rulesFrozen,
      history: evaluation ? await historyOf(evaluation.id) : [],
      counts: assessed.counts,
      submitted: assessed.submitted,
      scheduledDays: assessed.scheduled,
      excusedDays: assessed.excused,
      graceMinutes: assessed.graceMinutes,
      weightsUsed: assessed.weightsUsed,
      weights: assessed.weights,
      rating: evaluation ? { value: assessed.rating ?? evaluation.rating, comments: assessed.comments ?? evaluation.comments, savedByName: assessed.submitted?.submittedByName ?? evaluation.savedByName, savedAt: assessed.submitted?.submittedAt ?? evaluation.savedAt } : null,
      issues: assessed.issues,
      resultsNotMarked: assessed.resultsNotMarked,
      // A submitted evaluation has nothing left to submit.
      submit: assessed.submitted ? { ...submit, unlocked: false, reason: null, action: null } : submit,
    };
  }

  /** Everything the Evaluation page needs for one Employee: the period figures, the KPI results, the weight set and the four Submit checks. */
  async function evaluationFor(employeeId: number, periodId: number): Promise<EvaluationDetail> {
    const { period, employee, evaluation } = await locate(employeeId, periodId);
    return await detailOf(period, await assess(employee, period, evaluation, await deps.kpis.listKpis({ includeSales: true })), evaluation);
  }

  /**
   * The same page figures computed fresh from today's data, for the submit to save: never from a saved version. Also returns the
   * saved evaluation row, so the submit can make sure it saves the rating it read.
   */
  async function liveDetail(employeeId: number, periodId: number) {
    const { period, employee, evaluation } = await locate(employeeId, periodId);
    const assessed = await assess(employee, period, evaluation, await deps.kpis.listKpis({ includeSales: true }), { live: true });
    return { detail: await detailOf(period, { ...assessed, submitted: null }, evaluation), evaluation, employee: { id: employee.id, name: employee.name, employeeNumber: employee.employeeNumber } };
  }

  return { roster, evaluationFor, liveDetail };
}
