"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AttendanceError, GoLiveError, ImportError, KpiError, LinkError, type LinkedEmployee, NeedError, PerformanceError, PeriodError, RatingError, ReopenError, RosterError, SubmitError, SuggestionError, type CalendarInput, type ImportPreview, type OpenPeriodInput, type ImportProblem, type Resolution, type SavedImport } from "@/lib/performance";
import { readGoLiveDate } from "@/lib/performance-pos-settings";
import { readSalesTarget, SalesTargetError } from "@/lib/performance-sales-inputs";
import { GO_LIVE_MESSAGE, TARGET_MESSAGE } from "@/lib/performance-sales-setup-terms";
import { linkMessage } from "@/lib/performance-pos-links-terms";
import { kpiMessage } from "@/lib/performance-kpi-messages";
import { periodMessage } from "@/lib/performance-period-messages";
import { attendanceMessage } from "@/lib/performance-attendance-terms";
import { needMessage } from "@/lib/performance-needs-terms";
import { suggestionMessage } from "@/lib/performance-suggestions-terms";
import { reopenMessage } from "@/lib/performance-reopen-terms";
import { submitMessage } from "@/lib/performance-submit-messages";
import { ratingMessage } from "@/lib/performance-rating-terms";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { performanceForRequest } from "@/lib/portal/performance";

export type KpiActionResult = { ok: true } | { ok: false; error: string };
export type PeriodActionResult = KpiActionResult;

/** Runs a Performance change. The interface rechecks the Module and the rules; this only turns a refusal into words. */
async function run(change: () => Promise<unknown>, paths: readonly string[]): Promise<KpiActionResult> {
  try {
    await change();
  } catch (error) {
    if (error instanceof KpiError) return { ok: false, error: kpiMessage(error.problem, error.extra) };
    if (error instanceof LinkError) return { ok: false, error: linkMessage(error.problem) };
    if (error instanceof SalesTargetError) return { ok: false, error: TARGET_MESSAGE };
    if (error instanceof GoLiveError) return { ok: false, error: GO_LIVE_MESSAGE };
    if (error instanceof PeriodError) return { ok: false, error: periodMessage(error.problem, error.extra) };
    if (error instanceof NeedError) return { ok: false, error: needMessage(error.problem) };
    if (error instanceof SuggestionError) return { ok: false, error: suggestionMessage(error.problem) };
    if (error instanceof ReopenError) return { ok: false, error: reopenMessage(error.problem) };
    if (error instanceof SubmitError) return { ok: false, error: submitMessage(error.problem, error.missing) };
    if (error instanceof AttendanceError) return { ok: false, error: attendanceMessage(error.problem) };
    if (error instanceof RatingError) return { ok: false, error: ratingMessage(error.problem) };
    if (error instanceof RosterError) return { ok: false, error: ratingMessage(error.problem) };
    if (error instanceof PerformanceError) {
      if (error.reason === "denied") redirect(NO_ACCESS_PATH);
      if (error.reason === "invalid") redirect(LOGIN_PATH);
      return { ok: false, error: "Performance could not reach the Portal or database. Please try again in a moment." };
    }
    throw error;
  }
  for (const path of paths) revalidatePath(path);
  return { ok: true };
}

const KPI_PATHS = ["/performance/kpis"] as const;
const PERIOD_PATHS = ["/performance", "/performance/calendar"] as const;

/** Switches a KPI Active or Inactive. A KPI is never deleted. */
export async function changeKpiStatus(id: string, status: string): Promise<KpiActionResult> {
  return run(async () => (await performanceForRequest()).setKpiStatus(id, status), KPI_PATHS);
}

/** Creates a weight set for one position. Refused unless the weights total 100 and the position has no set yet. */
export async function createWeightSet(position: string, weights: Record<string, number>): Promise<KpiActionResult> {
  return run(async () => (await performanceForRequest()).saveWeightSet({ position, weights }), KPI_PATHS);
}

/**
 * Saves the company-wide sales target (pesos per present day) and/or the POS go-live date from KPI Setup. Both are checked before either is saved, so a
 * bad value saves nothing; each real change is audited with the Staff member by the interface.
 */
export async function saveSalesSettings(input: { target?: number; goLive?: string }): Promise<KpiActionResult> {
  return run(async () => {
    const target = input.target === undefined ? undefined : readSalesTarget(input.target);
    const goLive = input.goLive === undefined ? undefined : readGoLiveDate(input.goLive);
    const performance = await performanceForRequest();
    if (target !== undefined) await performance.setSalesTarget(target);
    if (goLive !== undefined) await performance.setPosGoLive(goLive);
  }, [...KPI_PATHS, "/performance"]);
}

/** Opens a company-wide Evaluation period. One that overlaps another by date is refused. */
export async function openEvaluationPeriod(input: OpenPeriodInput): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).openPeriod(input), PERIOD_PATHS);
}

/** Adds a holiday, closure or other non-working date to the company calendar. */
export async function addNonWorkingDate(input: CalendarInput): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).addNonWorkingDate(input), PERIOD_PATHS);
}

/** Edits a non-working date. */
export async function editNonWorkingDate(id: number, input: CalendarInput): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).updateNonWorkingDate(id, input), PERIOD_PATHS);
}

/** Removes a non-working date. */
export async function removeNonWorkingDate(id: number): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).removeNonWorkingDate(id), PERIOD_PATHS);
}

/**
 * Saves the rating (0 to 100) and the comments for an Employee in a period. The first save moves the status from Draft to In review.
 * The page is refreshed so the banner, the checklist and the score follow the rating.
 */
export async function saveEvaluationRating(employeeId: number, periodId: number, input: { rating: number; comments: string }): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).saveRating(employeeId, periodId, input), ["/performance", `/performance/evaluation/${employeeId}`]);
}

const evaluationPaths = (employeeId: number) => ["/performance", `/performance/evaluation/${employeeId}`];

/**
 * Resolves a day with a time-in and no time-out as Excused (optional reason) or Absent (reason required). The record is never edited.
 * The page is refreshed so the card, the checklist, the banner and the score follow.
 */
export async function resolveAttendanceDay(employeeId: number, periodId: number, date: string, resolution: Resolution): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).resolveDay(employeeId, periodId, date, resolution), evaluationPaths(employeeId));
}

/** Confirms an Employee had no attendance in the period, with a required reason. It counts as full absence. */
export async function confirmNoAttendance(employeeId: number, periodId: number, reason: string): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).confirmNoAttendance(employeeId, periodId, reason), evaluationPaths(employeeId));
}

/**
 * Submits an evaluation: it locks, and the KPI results, score, weights and formulas used are saved. Refused, with the reason, when a
 * check is not met. No email is sent. The page is refreshed so it shows the locked Evaluated state.
 */
export async function submitEvaluation(employeeId: number, periodId: number): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).submitEvaluation(employeeId, periodId), evaluationPaths(employeeId));
}

/**
 * Reopens an evaluated evaluation with a required reason. It returns to In review; the submitted version is kept and the score is
 * recalculated from current data with the same weights. No email is sent. The page is refreshed so it shows In review.
 */
export async function reopenEvaluation(employeeId: number, periodId: number, reason: string): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).reopenEvaluation(employeeId, periodId, reason), evaluationPaths(employeeId));
}

/**
 * Flags a development need on an Employee's evaluation: the gap, and the recommended action or the scheduled Training picked for it. It never
 * changes the score, rating or status and sends no email. The Evaluation page is refreshed so the Development needs list shows it.
 */
export async function flagDevelopmentNeed(employeeId: number, periodId: number, input: { gap: string; action: string; trainingId?: number | null }): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).flagDevelopmentNeed(employeeId, periodId, input), [`/performance/evaluation/${employeeId}`]);
}

/**
 * Flags a suggested development area as a development need (AI source, linked to the suggestion). The Gap and the action start as the
 * suggestion's own words and are whatever Staff left in the dialog. It cannot be done twice and never changes the score, rating or status.
 */
export async function flagSuggestedNeed(employeeId: number, suggestionId: number, input: { gap: string; action: string; trainingId?: number | null }): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).flagSuggestion(suggestionId, input), evaluationPaths(employeeId));
}

/** Dismisses a Pending suggested development area, which then stops showing. */
export async function dismissSuggestedNeed(employeeId: number, suggestionId: number): Promise<PeriodActionResult> {
  return run(async () => (await performanceForRequest()).dismissSuggestion(suggestionId), evaluationPaths(employeeId));
}

/**
 * What a screen learns from asking for suggestions: saved (the page refreshes to show the new set), nothing to suggest, a refusal or failure
 * with its banner colour, message and, on red only, a Reference ID (never the internal code), or a plain error.
 */
export type GenerateActionResult =
  | { ok: true; left: number }
  | { ok: false; kind: "nothing"; left: number }
  | { ok: false; kind: "ai"; banner: "yellow" | "red" | "grey" | "none"; message: string | null; referenceId: string | null; left: number }
  | { ok: false; kind: "error"; error: string };

/** Asks the AI for suggested development areas on an Evaluated evaluation. A button press only: nothing asks again on its own. */
export async function generateSuggestions(employeeId: number, periodId: number): Promise<GenerateActionResult> {
  try {
    const result = await (await performanceForRequest()).generateSuggestions(employeeId, periodId);
    if (result.ok) {
      revalidatePath(`/performance/evaluation/${employeeId}`);
      return { ok: true, left: result.left };
    }
    if (result.kind === "nothing") return { ok: false, kind: "nothing", left: result.left };
    return { ok: false, kind: "ai", banner: result.failure.banner, message: result.failure.message, referenceId: result.failure.referenceId, left: result.left };
  } catch (error) {
    if (error instanceof SuggestionError) return { ok: false, kind: "error", error: suggestionMessage(error.problem) };
    if (error instanceof RosterError || error instanceof PeriodError) return { ok: false, kind: "error", error: "That evaluation could not be found." };
    if (error instanceof PerformanceError) {
      if (error.reason === "denied") redirect(NO_ACCESS_PATH);
      if (error.reason === "invalid") redirect(LOGIN_PATH);
      return { ok: false, kind: "error", error: "Performance could not reach the Portal or database. Please try again in a moment." };
    }
    throw error;
  }
}

/**
 * What an Import POS sales run ends in: the preview or the saved import, or why it could not read the POS. A failure always means nothing was saved.
 * `at` is when the attempt was made, for "Last attempt".
 */
export type PosImportResult =
  | { ok: true; at: string; preview: ImportPreview }
  | { ok: true; at: string; saved: SavedImport }
  | { ok: false; at: string; kind: ImportProblem; problems: string[] };

async function runPosImport(read: (performance: Awaited<ReturnType<typeof performanceForRequest>>) => Promise<{ preview: ImportPreview } | { saved: SavedImport }>): Promise<PosImportResult> {
  const at = new Date().toISOString();
  try {
    return { ok: true, at, ...(await read(await performanceForRequest())) };
  } catch (error) {
    if (error instanceof ImportError) return { ok: false, at, kind: error.problem, problems: [...error.problems] };
    if (error instanceof PerformanceError) {
      if (error.reason === "denied") redirect(NO_ACCESS_PATH);
      if (error.reason === "invalid") redirect(LOGIN_PATH);
      return { ok: false, at, kind: "pos-unreachable", problems: [] };
    }
    throw error;
  }
}

/** Reads the POS for the current and the previous month and returns what an import would do. Saves nothing. A button press only. */
export async function previewPosSales(): Promise<PosImportResult> {
  return runPosImport(async (performance) => ({ preview: await performance.previewPosImport() }));
}

/** Reads the POS again and saves it, in one transaction. Only the Confirm import button calls this. */
export async function confirmPosImport(): Promise<PosImportResult> {
  const result = await runPosImport(async (performance) => ({ saved: await performance.importPosSales() }));
  if (result.ok) for (const path of PERIOD_PATHS) revalidatePath(path);
  return result;
}

export type PosLinksResult = { ok: true; employees: LinkedEmployee[] } | { ok: false; error: string };

/** Reads every linked Employee with all their POS accounts, for the POS cashier links dialog. Read-only; the dialog asks when it opens and again on Try again. */
export async function loadPosLinks(): Promise<PosLinksResult> {
  try {
    return { ok: true, employees: await (await performanceForRequest()).listLinkedEmployees() };
  } catch (error) {
    if (error instanceof PerformanceError) {
      if (error.reason === "denied") redirect(NO_ACCESS_PATH);
      if (error.reason === "invalid") redirect(LOGIN_PATH);
      return { ok: false, error: "Performance could not reach the Portal or database. Please try again in a moment." };
    }
    throw error;
  }
}

/** Ends one POS account link with a reason (and a note, required for Other). The account's sales leave the Employee, past months included; Top sales is refreshed. */
export async function unlinkPosAccount(linkId: number, reason: string, note: string): Promise<KpiActionResult> {
  return run(async () => (await performanceForRequest()).unlinkPosAccount(linkId, { reason, note }), PERIOD_PATHS);
}
