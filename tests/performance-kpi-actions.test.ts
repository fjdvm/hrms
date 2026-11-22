import { beforeEach, describe, expect, it, vi } from "vitest";
import { GoLiveError, KpiError, PerformanceError } from "@/lib/performance";

const state = vi.hoisted(() => ({ performance: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/portal/performance", () => ({ performanceForRequest: async () => state.performance }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { changeKpiStatus, createWeightSet, saveSalesSettings } from "@/app/(hrms)/performance/actions";

beforeEach(() => { state.performance = { setKpiStatus: vi.fn(), saveWeightSet: vi.fn(), setSalesTarget: vi.fn(), setPosGoLive: vi.fn() }; });
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

describe("the sales settings server action", () => {
  it("saves the target and the go-live date through the interface, only what is sent", async () => {
    expect(await saveSalesSettings({ target: 1500.5, goLive: "2026-11-10" })).toEqual({ ok: true });
    expect(state.performance.setSalesTarget).toHaveBeenCalledWith(1500.5);
    expect(state.performance.setPosGoLive).toHaveBeenCalledWith("2026-11-10");

    state.performance.setSalesTarget.mockClear(); state.performance.setPosGoLive.mockClear();
    expect(await saveSalesSettings({ goLive: "2026-12-01" })).toEqual({ ok: true });
    expect(state.performance.setSalesTarget).not.toHaveBeenCalled();
    expect(state.performance.setPosGoLive).toHaveBeenCalledWith("2026-12-01");
  });

  it("checks both values before saving either, so a bad one saves nothing", async () => {
    expect(await saveSalesSettings({ target: 1500, goLive: "2026-02-30" })).toEqual({ ok: false, error: "Choose a real calendar date." });
    expect(await saveSalesSettings({ target: 0, goLive: "2026-11-10" })).toMatchObject({ ok: false, error: expect.stringContaining("more than 0") });
    expect(await saveSalesSettings({ target: 12.345 })).toMatchObject({ ok: false });
    expect(state.performance.setSalesTarget).not.toHaveBeenCalled();
    expect(state.performance.setPosGoLive).not.toHaveBeenCalled();
  });

  it("turns the interface's refusal into words, and sends a Staff member without the Module to No access", async () => {
    state.performance.setPosGoLive.mockRejectedValue(new GoLiveError("date-invalid"));
    expect(await saveSalesSettings({ goLive: "2026-11-10" })).toEqual({ ok: false, error: "Choose a real calendar date." });
    state.performance.setSalesTarget.mockRejectedValue(new PerformanceError("denied"));
    await expect(saveSalesSettings({ target: 1500 })).rejects.toThrow("REDIRECT /no-access");
  });
});
