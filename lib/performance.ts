import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import type { Staff } from "./portal/client";
import { kpiModule, type Actor } from "./performance-kpis";
import { trainingCompletionModule } from "./performance-training";
import { periodsModule, type CalendarInput, type OpenPeriodInput } from "./performance-periods";
import { attendanceModule, type Resolution } from "./performance-attendance";
import { evaluationsModule } from "./performance-evaluations";
import type { EvaluationTab } from "./performance-evaluations-terms";

/**
 * The Performance interface: the single seam every Performance ticket extends. It owns the access rule and composes the
 * small domain modules behind it (scoring, attendance, periods, KPIs, evaluations, shift); screens call it and hold no
 * rule of their own.
 */

export { KpiError, type Kpi, type KpiProblem, type KpiStatus, type WeightSet, type Weights } from "./performance-kpis";
export { RESULTS_NOT_MARKED, TrainingReadError, type EmployeeTrainingCompletion } from "./performance-training";
export { RosterError, type EvaluationDetail, type KpiLine, type Roster, type RosterRow, type Score, type Shift } from "./performance-evaluations";
export { EVALUATION_TABS, type EvaluationStatus, type EvaluationTab, type SubmitCheck, type SubmitCheckId, type SubmitReadiness } from "./performance-evaluations-terms";
export { AttendanceError, type AttendanceImport, type AttendanceIssue, type AttendancePreview, type AttendanceProblem, type AttendanceState, type EmployeeWithoutRecords, type Resolution } from "./performance-attendance";
export { REJECTION_REASONS, type RawAttendanceRow, type RejectedRow, type RowRejection } from "./performance-attendance-rows";
export { PeriodError, type CalendarEntry, type CalendarInput, type OpenPeriodInput, type Period, type PeriodProblem, type Schedule } from "./performance-periods";

export class PerformanceError extends Error {
  constructor(public readonly reason: "invalid" | "unavailable" | "denied") {
    super(`Performance: ${reason}`);
  }
}

export type PerformanceAccess = { decision: "allowed"; staff: Staff } | { decision: "denied" };

/**
 * Server-side boundary. Rechecks the Portal on every operation; `db` and `now` are injectable so tests control the
 * database and the clock. Later domain modules take the same `db` and `now`.
 */
export function performanceFor(sessionHandle: string | undefined, db: Database = database, now: () => Date = () => new Date()) {
  const kpis = kpiModule(db);
  const training = trainingCompletionModule(db, now);
  const periods = periodsModule(db);
  const attendance = attendanceModule(db, periods);
  const evaluations = evaluationsModule(db, { periods, attendance, training, kpis });

  /**
   * The Performance Module grant alone decides (ADR-0004): no manager permission, no role names. A session the Portal
   * rejects or cannot answer for throws, so it is never read as "no access".
   */
  async function access(): Promise<PerformanceAccess> {
    const result = await accessFor(sessionHandle).check("Performance");
    if (result.decision === "invalid" || result.decision === "unavailable") throw new PerformanceError(result.decision);
    return result.decision === "allowed" ? { decision: "allowed", staff: result.staff } : { decision: "denied" };
  }

  /** Every operation proves the Module first and names who is acting, so each change records its Staff member. */
  async function acting(): Promise<Actor> {
    const result = await access();
    if (result.decision !== "allowed") throw new PerformanceError("denied");
    return { id: result.staff.id ?? result.staff.username, name: result.staff.name };
  }

  return {
    access,
    /** The five KPIs with their source, target, status and weight in the default set. */
    listKpis: async () => { await acting(); return kpis.listKpis(); },
    /** Activates or deactivates a KPI. There is no delete: a KPI an Evaluation used must stay explainable. */
    setKpiStatus: async (id: string, status: string) => kpis.setKpiStatus(await acting(), id, status),
    /** The default set, then the position sets, each with its total. */
    listWeightSets: async () => { await acting(); return kpis.listWeightSets(); },
    /** Creates a position set, or edits a set by `id`. Refused unless the weights total 100. */
    saveWeightSet: async (input: { id?: number; position?: string | null; weights: unknown }) => kpis.saveWeightSet(await acting(), input),
    /** The set that scores an Employee with this position, with its name; the default when no position set matches. */
    weightSetFor: async (position: string | null | undefined) => { await acting(); return kpis.weightSetFor(position); },
    /**
     * One Employee's Training completion for a date range (Manila "YYYY-MM-DD", both ends included), read with the same rules
     * as the Trainings card. Needs Performance only, and returns figures only, never the Trainings themselves.
     */
    trainingCompletion: async (employeeId: number, range: { from: string; to: string }) => { await acting(); return training.trainingCompletion(employeeId, range); },
    /** The Evaluation periods, latest first. */
    listPeriods: async () => { await acting(); return periods.listPeriods(); },
    /** Opens a company-wide period (Month, Quarter or Custom). One that overlaps another by date is refused, naming it. */
    openPeriod: async (input: OpenPeriodInput) => periods.openPeriod(await acting(), input),
    /** The company calendar's non-working dates, optionally within a range of dates. */
    listNonWorkingDates: async (range?: { from: string; to: string }) => { await acting(); return periods.listNonWorkingDates(range); },
    /** Adds a holiday, closure or other non-working date for the whole company. The same date cannot be added twice. */
    addNonWorkingDate: async (input: CalendarInput) => periods.addNonWorkingDate(await acting(), input),
    /** Records excused days for an Employee in a period. They are subtracted from the scheduled days when the score is worked out. */
    excuseDays: async (employeeId: number, periodId: number, dates: readonly string[]) => periods.excuseDays(await acting(), employeeId, periodId, dates),
    /** An Employee's scheduled and excused days in a period, or not scorable when they have no shift. */
    scheduleFor: async (employeeId: number, periodId: number) => { await acting(); return periods.scheduleFor(employeeId, periodId); },
    /** What a batch of normalised attendance rows would do, with nothing saved: usable and rejected rows, coverage and who has no records. */
    previewAttendance: async (input: { periodId: number; rows: unknown }) => { await acting(); return attendance.previewAttendance(input); },
    /** Saves a confirmed batch: only the usable rows, replacing earlier rows for the same Employee and date, with one import record. */
    importAttendance: async (input: { fileName: string; sourceRef?: string | null; rows: unknown }) => attendance.importAttendance(await acting(), input),
    /** The most recent imports: who, when, the file name and the counts. */
    listAttendanceImports: async () => { await acting(); return attendance.listImports(); },
    /** An Employee's rows for scoring in a period, their open issues, and whether attendance is imported. Never shown as an attendance record. */
    attendanceFor: async (employeeId: number, periodId: number) => { await acting(); return attendance.attendanceFor(employeeId, periodId); },
    /** Resolves a day with a time-in and no time-out as Excused (optional reason) or Absent (reason required). */
    resolveDay: async (employeeId: number, periodId: number, date: string, resolution: Resolution) => attendance.resolveDay(await acting(), employeeId, periodId, date, resolution),
    /** Confirms an Employee had no attendance in the period, with a required reason. It counts as full absence. */
    confirmNoAttendance: async (employeeId: number, periodId: number, reason: string) => attendance.confirmNoAttendance(await acting(), employeeId, periodId, reason),
    /**
     * Everyone being evaluated in a period with their derived status and score, the tab counts, the progress ("3 of 8 evaluated")
     * and the Employees not scored for a missing shift. Reads only; it writes no evaluation.
     */
    roster: async (periodId: number, tab?: EvaluationTab) => { await acting(); return evaluations.roster(periodId, tab); },
    /** Everything the Evaluation page needs for one Employee: the period figures, KPI results, weight set and the four Submit checks. */
    evaluationFor: async (employeeId: number, periodId: number) => { await acting(); return evaluations.evaluationFor(employeeId, periodId); },
  };
}
