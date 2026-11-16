import { beforeEach, describe, expect, it, vi } from "vitest";
import { KpiError, PerformanceError } from "@/lib/performance";

const state = vi.hoisted(() => ({ performance: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/portal/performance", () => ({ performanceForRequest: async () => state.performance }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { changeKpiStatus, createWeightSet } from "@/app/(hrms)/performance/actions";

beforeEach(() => { state.performance = { setKpiStatus: vi.fn(), saveWeightSet: vi.fn() }; });
const WEIGHTS = { attendanceRate: 40, punctuality: 20, fullShift: 10, trainingCompletion: 10, evaluatorRating: 20 };

describe("the KPI Setup server actions", () => {
  it("switches a KPI through the interface and says it worked", async () => {
    expect(await changeKpiStatus("fullShift", "Inactive")).toEqual({ ok: true });
    expect(state.performance.setKpiStatus).toHaveBeenCalledWith("fullShift", "Inactive");
  });

  it("creates a set through the interface for the position and weights", async () => {
    expect(await createWeightSet("Branch Cashier", WEIGHTS)).toEqual({ ok: true });
    expect(state.performance.saveWeightSet).toHaveBeenCalledWith({ position: "Branch Cashier", weights: WEIGHTS });
  });

  it("turns the interface's refusals into the words HR reads", async () => {
    state.performance.saveWeightSet.mockRejectedValue(new KpiError("position-taken", { conflictsWith: "Branch Cashier" }));
    expect(await createWeightSet("Branch Cashier", WEIGHTS)).toEqual({ ok: false, error: "A position can have only one weight set." });
    state.performance.saveWeightSet.mockRejectedValue(new KpiError("weights-total", { total: 95 }));
    expect(await createWeightSet("Stock Clerk", WEIGHTS)).toEqual({ ok: false, error: "Weights total 95, not 100." });
    state.performance.saveWeightSet.mockRejectedValue(new KpiError("weights-invalid"));
    expect(await createWeightSet("Stock Clerk", WEIGHTS)).toEqual({ ok: false, error: "Each weight must be a whole number from 0 to 100." });
    state.performance.setKpiStatus.mockRejectedValue(new KpiError("unknown-kpi"));
    expect(await changeKpiStatus("nope", "Active")).toEqual({ ok: false, error: "Something went wrong. Reload the page and try again." });
  });

  it("sends Staff without the Module to No access, a signed-out one to sign in, and reports an unavailable Portal", async () => {
    state.performance.setKpiStatus.mockRejectedValue(new PerformanceError("denied"));
    await expect(changeKpiStatus("fullShift", "Inactive")).rejects.toThrow("REDIRECT /no-access");
    state.performance.setKpiStatus.mockRejectedValue(new PerformanceError("invalid"));
    await expect(changeKpiStatus("fullShift", "Inactive")).rejects.toThrow(/REDIRECT \/.*/);
    state.performance.setKpiStatus.mockRejectedValue(new PerformanceError("unavailable"));
    expect(await changeKpiStatus("fullShift", "Inactive")).toEqual({ ok: false, error: "Performance could not reach the Portal or database. Please try again in a moment." });
  });

  it("does not swallow a bug", async () => {
    state.performance.setKpiStatus.mockRejectedValue(new TypeError("boom"));

    await expect(changeKpiStatus("fullShift", "Inactive")).rejects.toThrow("boom");
  });
});
