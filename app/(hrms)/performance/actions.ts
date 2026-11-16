"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { KpiError, PerformanceError } from "@/lib/performance";
import { kpiMessage } from "@/lib/performance-kpi-messages";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { performanceForRequest } from "@/lib/portal/performance";

export type KpiActionResult = { ok: true } | { ok: false; error: string };

/** Runs a Performance change. The interface rechecks the Module and the rules; this only turns a refusal into words. */
async function run(change: () => Promise<unknown>): Promise<KpiActionResult> {
  try {
    await change();
  } catch (error) {
    if (error instanceof KpiError) return { ok: false, error: kpiMessage(error.problem, error.extra) };
    if (error instanceof PerformanceError) {
      if (error.reason === "denied") redirect(NO_ACCESS_PATH);
      if (error.reason === "invalid") redirect(LOGIN_PATH);
      return { ok: false, error: "Performance could not reach the Portal or database. Please try again in a moment." };
    }
    throw error;
  }
  revalidatePath("/performance/kpis");
  return { ok: true };
}

/** Switches a KPI Active or Inactive. A KPI is never deleted. */
export async function changeKpiStatus(id: string, status: string): Promise<KpiActionResult> {
  return run(async () => (await performanceForRequest()).setKpiStatus(id, status));
}

/** Creates a weight set for one position. Refused unless the weights total 100 and the position has no set yet. */
export async function createWeightSet(position: string, weights: Record<string, number>): Promise<KpiActionResult> {
  return run(async () => (await performanceForRequest()).saveWeightSet({ position, weights }));
}
