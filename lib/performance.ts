import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import type { Staff } from "./portal/client";
import { kpiModule, type Actor } from "./performance-kpis";
import { trainingCompletionModule } from "./performance-training";
import { periodsModule, type CalendarInput, type OpenPeriodInput } from "./performance-periods";
import { attendanceModule, type Resolution } from "./performance-attendance";
import { evaluationsModule } from "./performance-evaluations";
import { ratingModule } from "./performance-rating";
import { submitModule } from "./performance-submit";
import { reopenModule } from "./performance-reopen";
import { linksModule, type Directory } from "./performance-links";
import { listStaffDirectory } from "./portal/client";
import { posImportModule } from "./performance-pos-import";
import { posSettingsModule } from "./performance-pos-settings";
import { posReader } from "./pos-reader";
import { salesInputsModule } from "./performance-sales-inputs";
import { topSalesModule } from "./performance-top-sales";
import { needsModule } from "./performance-needs";
import { suggestionsModule, type SuggestionStatus } from "./performance-suggestions";
import type { AiClient, AiConfig } from "./ai";
import type { EvaluationTab } from "./performance-evaluations-terms";
import type { NeedInput } from "./performance-needs";

/**
 * The Performance interface: the single seam every Performance ticket extends. It owns the access rule and composes the
 * small domain modules behind it (scoring, attendance, periods, KPIs, evaluations, shift); screens call it and hold no
 * rule of their own.
 */

export { LinkError, NEW_ACCOUNT_REASON, UNLINK_REASONS, NOT_A_CASHIER_MESSAGE, NOTE_MAX_LENGTH, type DescribedAccount, type LinkedAccount, type LinkedEmployee, type LinkProblem, type PosAccountLink, type UnlinkReason } from "./performance-links";
export { ImportError, importRange, type ImportPreview, type ImportProblem, type ImportRecord, type SavedImport, type UnlinkedAccount } from "./performance-pos-import";
export { GoLiveError, type GoLive } from "./performance-pos-settings";
export { SalesTargetError, SALES_TARGET_MAX, type SalesTargetProblem } from "./performance-sales-inputs";
export { TopSalesError, type TopSales, type TopSalesBranch, type TopSalesProblem, type TopSalesRow } from "./performance-top-sales";
export { KpiError, type Kpi, type KpiProblem, type KpiStatus, type WeightSet, type Weights } from "./performance-kpis";
export { RESULTS_NOT_MARKED, TrainingReadError, type EmployeeTrainingCompletion, type TrainingForSuggestions, type TrainingTitle } from "./performance-training";
export { ReopenError, REASON_MAX_LENGTH, type ReopenProblem, type ReopenedEvaluation } from "./performance-reopen";
export { NeedError, ACTION_MAX_LENGTH, GAP_MAX_LENGTH, type DevelopmentNeed, type NeedInput, type NeedProblem } from "./performance-needs";
export { SuggestionError, type GenerateResult, type Suggestion, type SuggestionFailure, type SuggestionProblem, type SuggestionSet, type SuggestionStatus, type SuggestionView } from "./performance-suggestions";
export { SubmitError, type SubmitProblem, type SubmittedEvaluation } from "./performance-submit";
export { COMMENTS_MAX_LENGTH, RatingError, type RatingProblem, type SavedRating } from "./performance-rating";
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
export function performanceFor(sessionHandle: string | undefined, db: Database = database, now: () => Date = () => new Date(), ai: { client?: AiClient; config?: AiConfig } = {}, directory: Directory = listStaffDirectory, pos: ReturnType<typeof posReader> = posReader()) {
  const kpis = kpiModule(db);
  const training = trainingCompletionModule(db, now);
  const periods = periodsModule(db);
  const attendance = attendanceModule(db, periods);
  const sales = salesInputsModule(db);
  const evaluations = evaluationsModule(db, { periods, attendance, training, kpis, sales });
  const rating = ratingModule(db, periods);
  const submit = submitModule(db, { evaluations });
  const reopen = reopenModule(db, { evaluations });
  const needs = needsModule(db, { evaluations, periods });
  const links = linksModule(db, now, directory);
  const posSettings = posSettingsModule(db);
  const posImport = posImportModule(db, now, { links, reader: pos, settings: posSettings });
  const topSales = topSalesModule(db, now);
  const suggestions = suggestionsModule(db, { evaluations, training }, { ...ai, now });

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
    /** The five starter KPIs with their source, target, status and weight in the default set; KPI Setup also asks for the sales KPI. */
    listKpis: async (options?: { includeSales?: boolean }) => { await acting(); return kpis.listKpis(options); },
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
    /**
     * The titles of scheduled Trainings (not cancelled, not yet held), nearest first, as `{ id, title }` and nothing else: no trainer, date, time,
     * venue, assignee or result. It needs Performance and not Training (ADR-0004, amended). It is what the Flag development need dialog offers.
     */
    scheduledTrainingTitles: async () => { await acting(); return training.scheduledTitles(); },
    /**
     * The same Trainings with their objectives, `{ id, title, objectives }`, for building the AI suggestions request only. A screen never shows it.
     * Needs Performance and not Training.
     */
    scheduledTrainingsForSuggestions: async () => { await acting(); return training.scheduledForSuggestions(); },
    /** The POS accounts linked to one Employee now, oldest first. */
    listPosAccounts: async (employeeId: number) => { await acting(); return links.accountsOf(employeeId); },
    /** Names POS accounts from the Portal directory; with no match a row carries the staff number and branch only. */
    describePosAccounts: async (accounts: readonly { portalUserId: string; staffNumber?: string | null; branch?: string | null }[]) => { await acting(); return links.describeAccounts(accounts); },
    /** Every linked Employee with all their active POS accounts, for the POS cashier links dialog. */
    listLinkedEmployees: async () => { await acting(); return links.linkedEmployees(); },
    /** Links a POS account (a Portal user) to a cashier. An Employee with an account already needs the reason "New Portal account for the same person". */
    linkPosAccount: async (input: { employeeId: number; portalUserId: unknown; reason?: unknown }) => links.linkAccount(await acting(), input),
    /** Ends a link with a reason (and a note for "Other"). The account's sales leave the Employee, past months included. */
    unlinkPosAccount: async (linkId: number, input: { reason: unknown; note?: unknown }) => links.unlinkAccount(await acting(), linkId, input),
    /** The one company-wide sales target in pesos per present day, or null while it is not set. */
    salesTarget: async () => { await acting(); return sales.target(); },
    /** Sets the sales target (more than 0, to the centavo), audited. Without it the sales KPI is Not applicable. */
    setSalesTarget: async (amount: unknown) => sales.setTarget(await acting(), amount),
    /**
     * The Top sales card for one calendar month (`{ year, month }`): per branch, the cashiers ranked by net sales (ties share a rank), the overall top
     * seller, how many staff with sales are not shown, and whether the month is still Provisional. Computed when read; nothing is stored. Recognition only.
     */
    topSales: async (month: { year: number; month: number }) => { await acting(); return topSales.topSales(month); },
    /** The POS go-live date: the first day POS sales may be read from, or null while it is not set. */
    posGoLive: async () => { await acting(); return posSettings.goLive(); },
    /** Sets the POS go-live date ("YYYY-MM-DD"), audited. An import is refused until it is set. */
    setPosGoLive: async (date: unknown) => posSettings.setGoLive(await acting(), date),
    /** What importing POS sales would do (the current and the previous month), with nothing saved. */
    previewPosImport: async () => { await acting(); return posImport.preview(); },
    /** Reads the POS again and saves its sales, in one transaction. Nothing is saved when the POS cannot be read. */
    importPosSales: async () => posImport.confirm(await acting()),
    /** The most recent POS sales imports. */
    listPosImports: async () => { await acting(); return posImport.listImports(); },
    /** The Evaluation periods, latest first. */
    listPeriods: async () => { await acting(); return periods.listPeriods(); },
    /** Opens a company-wide period (Month, Quarter or Custom). One that overlaps another by date is refused, naming it. */
    openPeriod: async (input: OpenPeriodInput) => periods.openPeriod(await acting(), input),
    /** The company calendar's non-working dates, optionally within a range of dates. */
    listNonWorkingDates: async (range?: { from: string; to: string }) => { await acting(); return periods.listNonWorkingDates(range); },
    /** Adds a holiday, closure or other non-working date for the whole company. The same date cannot be added twice. */
    addNonWorkingDate: async (input: CalendarInput) => periods.addNonWorkingDate(await acting(), input),
    /** Edits a non-working date. A submitted evaluation keeps the scheduled days it was submitted with. */
    updateNonWorkingDate: async (id: number, input: CalendarInput) => periods.updateNonWorkingDate(await acting(), id, input),
    /** Removes a non-working date from the company calendar, with an audit event. */
    removeNonWorkingDate: async (id: number) => periods.removeNonWorkingDate(await acting(), id),
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
    /**
     * Saves the rating (0 to 100) and the comments for an Employee in a period. The first save pins the Employee to the period and
     * moves the status from Draft to In review. They can be changed until the evaluation is submitted. Any order relative to the
     * attendance import and the shift.
     */
    saveRating: async (employeeId: number, periodId: number, input: { rating: unknown; comments?: unknown }) => rating.saveRating(await acting(), employeeId, periodId, input),
    /**
     * Submits an evaluation: allowed only when attendance is imported, the shift is set, attendance issues are resolved and the rating
     * is entered. It locks the evaluation and saves the KPI results, score, weights, formulas, weight set name and rating, so nothing
     * that changes later can alter it. The audit event is queued with the change; no email or notification is sent.
     */
    submitEvaluation: async (employeeId: number, periodId: number) => submit.submitEvaluation(await acting(), employeeId, periodId),
    /**
     * Reopens an Evaluated evaluation with a required reason. It returns to In review, its results are recomputed from current data with
     * the weights and formulas saved at the first submission, and the submitted version is kept. Submitting again saves a new version.
     */
    reopenEvaluation: async (employeeId: number, periodId: number, reason: string) => reopen.reopenEvaluation(await acting(), employeeId, periodId, reason),
    /**
     * Flags a development need for an Employee in a period: the Gap and the Recommended action or Training (both required), and the id of a
     * scheduled Training when one was picked. It works while the Evaluation is In review or Evaluated, never changes the score, the rating or
     * the status, sends no email, and is recorded in the Performance audit with the Staff member. Submit and Reopen leave needs as they are.
     */
    flagDevelopmentNeed: async (employeeId: number, periodId: number, input: NeedInput) => needs.flagNeed(await acting(), employeeId, periodId, input),
    /** The development needs flagged for an Employee in a period, newest first, with who flagged each and when. */
    listDevelopmentNeeds: async (employeeId: number, periodId: number) => { await acting(); return needs.listNeeds(employeeId, periodId); },
    /** Whether suggestions are switched on and how many runs the Staff member has left today. Read when the page loads (a user action); nothing polls it. */
    suggestionStatus: async (): Promise<SuggestionStatus> => suggestions.status(await acting()),
    /**
     * The suggested development areas saved for an Employee in a period: the current set of the latest version that has one, with its version,
     * who generated it and when, and whether it can still be flagged or dismissed (not after a Reopen, and not from an earlier version).
     */
    listSuggestions: async (employeeId: number, periodId: number) => { await acting(); return suggestions.suggestionsFor(employeeId, periodId); },
    /**
     * Asks the AI for suggested development areas on an Evaluated evaluation, from its locked KPI results (no name, employee number, branch
     * or comments are sent). Insufficient data is Not available (AI-0100) and every KPI at or above target is Nothing to suggest, both with no AI
     * call and no slot used. It saves a new set and marks the old one superseded; nothing is deleted, and no score, rating or status changes.
     */
    generateSuggestions: async (employeeId: number, periodId: number) => suggestions.generate(await acting(), employeeId, periodId),
    /** Flags a Pending suggestion as a development need (AI source, linked to it) and marks it Flagged. The Gap and action can be edited first. Not twice. */
    flagSuggestion: async (suggestionId: number, input?: Partial<NeedInput>) => suggestions.flagSuggestion(await acting(), suggestionId, input),
    /** Dismisses a Pending suggestion. */
    dismissSuggestion: async (suggestionId: number) => suggestions.dismissSuggestion(await acting(), suggestionId),
  };
}
