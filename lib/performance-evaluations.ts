import type { Database } from "./database";
import { isEvaluationTab, isOnRoster, statusOf, progressOf, submitReadiness, tabCounts, type EvaluationStatus, type EvaluationTab, type SubmitReadiness } from "./performance-evaluations-terms";
import type { attendanceModule, AttendanceIssue } from "./performance-attendance";
import type { Kpi, kpiModule, WeightSet } from "./performance-kpis";
import { PeriodError, type Period, type periodsModule } from "./performance-periods";
import { KPI_IDS, scoreEvaluation, type KpiId, type NotApplicableReason } from "./performance-scoring";
import { RESULTS_NOT_MARKED, type trainingCompletionModule } from "./performance-training";

/**
 * The Performance roster and the Evaluation page's read model. One of the small domain modules behind the Performance
 * interface: it composes the periods, attendance, Training completion, KPIs and weight sets and the scoring engine, and
 * writes nothing. Saving a rating and submitting are their own modules.
 *
 * An Evaluated evaluation is read from the version saved when it was submitted (the KPI results, the weights, the weight set's
 * name, the figures), never recomputed, so nothing that changes afterwards can alter it.
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
export type SnapshotFormulas = { version: string; kpis: Record<string, string>; graceMinutes: number; floorPercent: number };
export type DayCounts = { counted: number; present: number; late: number; earlyOut: number };
export type EvaluationDetail = Common & {
  period: Period;
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
};

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

  type Assessed = {
    common: Common; scheduled: string[]; excused: string[]; weightsUsed: Partial<Record<KpiId, number>>; weights: WeightSet["weights"] | null;
    issues: AttendanceIssue[]; resultsNotMarked: number; shift: Shift | null; counts: DayCounts | null; graceMinutes: number;
    rating: number | null; comments: string | null; submitted: SubmittedVersion | null;
  };

  /** What was saved when the evaluation was submitted, shaped like a live assessment. */
  function fromSubmission(employee: EmployeeRow, evaluation: EvaluationRow, saved: { submission: SubmissionRow; results: ResultRow[] }): Assessed {
    const { submission, results } = saved;
    const figures = submission.figures;
    const kpis = KPI_IDS.map((id): KpiLine => {
      const row = results.find((entry) => entry.kpiId === id)!;
      return { id, name: row.name, description: row.description, source: row.source, target: row.target, status: row.status, result: num(row.result), weight: row.weight, weightUsed: num(row.weightUsed), points: num(row.points), reason: row.reason, flag: row.flag };
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
    const [attendance, training, weightSet] = await Promise.all([
      deps.attendance.attendanceFor(employee.id, period.id),
      deps.training.trainingCompletion(employee.id, { from: period.start, to: period.end }),
      deps.kpis.weightSetFor(employee.position),
    ]);
    const schedule = shift ? await deps.periods.scheduleFor(employee.id, period.id) : null;
    const scheduled = schedule?.scorable ? schedule.scheduledDays : [];
    const excused = schedule?.scorable ? schedule.excusedDays : [];

    let score: Score = { outcome: "not-scored", reason: "shift-missing" };
    let kpis: KpiLine[] = [];
    let weightsUsed: Partial<Record<KpiId, number>> = {};
    let counts: DayCounts | null = null;
    if (shift) {
      const scoring = scoreEvaluation({
        rows: attendance.rows, shift: { start: shift.start, end: shift.end }, graceMinutes: period.graceMinutes, scheduledDays: scheduled, excusedDays: excused,
        training: { completed: training.completion?.completed ?? 0, due: training.completion?.due ?? 0 }, rating: evaluation?.rating ?? null,
        weights: weightSet.weights, noAttendanceConfirmed: attendance.noAttendanceConfirmed, inactiveKpis: kpiList.filter((kpi) => kpi.status === "Inactive").map((kpi) => kpi.id),
      });
      score = scoring.outcome === "scored" ? { outcome: "scored", value: scoring.score } : { outcome: "insufficient-data" };
      weightsUsed = scoring.weightsUsed;
      counts = scoring.counts;
      kpis = KPI_IDS.map((id): KpiLine => {
        const kpi = kpiList.find((entry) => entry.id === id)!;
        const result = scoring.results.find((entry) => entry.kpi === id)!;
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
      graceMinutes: period.graceMinutes, rating: evaluation?.rating ?? null, comments: evaluation?.comments ?? null, submitted: null,
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
    const kpiList = await deps.kpis.listKpis();
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

  function detailOf(period: Period, assessed: Assessed, evaluation: EvaluationRow | undefined): EvaluationDetail {
    const submit = submitReadiness({ attendanceImported: assessed.common.attendance.imported, shiftSet: assessed.shift !== null, openIssues: assessed.issues.length, ratingEntered: evaluation !== undefined });
    return {
      ...assessed.common,
      period,
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
    return detailOf(period, await assess(employee, period, evaluation, await deps.kpis.listKpis()), evaluation);
  }

  /**
   * The same page figures computed fresh from today's data, for the submit to save: never from a saved version. Also returns the
   * saved evaluation row, so the submit can make sure it saves the rating it read.
   */
  async function liveDetail(employeeId: number, periodId: number) {
    const { period, employee, evaluation } = await locate(employeeId, periodId);
    const assessed = await assess(employee, period, evaluation, await deps.kpis.listKpis(), { live: true });
    return { detail: detailOf(period, { ...assessed, submitted: null }, evaluation), evaluation, employee: { id: employee.id, name: employee.name, employeeNumber: employee.employeeNumber } };
  }

  return { roster, evaluationFor, liveDetail };
}
