"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { KpiError, PerformanceError, PeriodError, RatingError, RosterError, type CalendarInput, type OpenPeriodInput } from "@/lib/performance";
import { kpiMessage } from "@/lib/performance-kpi-messages";
import { periodMessage } from "@/lib/performance-period-messages";
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
    if (error instanceof PeriodError) return { ok: false, error: periodMessage(error.problem, error.extra) };
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
