import { beforeEach, describe, expect, it, vi } from "vitest";
import { PerformanceError, PeriodError } from "@/lib/performance";

const state = vi.hoisted(() => ({ performance: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/portal/performance", () => ({ performanceForRequest: async () => state.performance }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { addNonWorkingDate, editNonWorkingDate, openEvaluationPeriod, removeNonWorkingDate } from "@/app/(hrms)/performance/actions";

beforeEach(() => {
  state.performance = { openPeriod: vi.fn(), addNonWorkingDate: vi.fn(), updateNonWorkingDate: vi.fn(), removeNonWorkingDate: vi.fn() };
  cache.revalidatePath.mockClear();
});
const NOV = { type: "Month", year: 2026, month: 11, graceMinutes: 10 } as const;
const HOLIDAY = { date: "2026-11-30", name: "Bonifacio Day", type: "Holiday", notes: null };

describe("the Evaluation period and company calendar server actions", () => {
  it("opens a period through the interface and refreshes the list and the calendar", async () => {
    expect(await openEvaluationPeriod(NOV)).toEqual({ ok: true });
    expect(state.performance.openPeriod).toHaveBeenCalledWith(NOV);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance/calendar");
  });

  it("adds, edits and removes a non-working date through the interface", async () => {
    expect(await addNonWorkingDate(HOLIDAY)).toEqual({ ok: true });
    expect(await editNonWorkingDate(7, HOLIDAY)).toEqual({ ok: true });
    expect(await removeNonWorkingDate(7)).toEqual({ ok: true });
    expect(state.performance.addNonWorkingDate).toHaveBeenCalledWith(HOLIDAY);
    expect(state.performance.updateNonWorkingDate).toHaveBeenCalledWith(7, HOLIDAY);
    expect(state.performance.removeNonWorkingDate).toHaveBeenCalledWith(7);
  });

  it("turns refusals into the words HR reads and does not refresh", async () => {
    state.performance.openPeriod.mockRejectedValue(new PeriodError("overlap", { overlaps: { id: 1, name: "November 2026" } }));
    expect(await openEvaluationPeriod({ type: "Quarter", year: 2026, quarter: 4 })).toEqual({ ok: false, error: "Overlaps November 2026. Periods can't overlap by date." });
    state.performance.addNonWorkingDate.mockRejectedValue(new PeriodError("date-taken", { existing: "Bonifacio Day" }));
    expect(await addNonWorkingDate(HOLIDAY)).toEqual({ ok: false, error: "That date is already on the calendar as Bonifacio Day." });
    state.performance.openPeriod.mockRejectedValue(new PeriodError("grace-invalid"));
    expect((await openEvaluationPeriod(NOV))).toEqual({ ok: false, error: "Grace period must be whole minutes from 0 to 120." });
    state.performance.removeNonWorkingDate.mockRejectedValue(new PeriodError("unknown-entry"));
    expect(await removeNonWorkingDate(9)).toEqual({ ok: false, error: "That date is no longer on the calendar. Reload the page." });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("sends Staff without the Module to No access and reports an unavailable Portal", async () => {
    state.performance.addNonWorkingDate.mockRejectedValue(new PerformanceError("denied"));
    await expect(addNonWorkingDate(HOLIDAY)).rejects.toThrow("REDIRECT /no-access");
    state.performance.addNonWorkingDate.mockRejectedValue(new PerformanceError("unavailable"));
    expect(await addNonWorkingDate(HOLIDAY)).toEqual({ ok: false, error: "Performance could not reach the Portal or database. Please try again in a moment." });
  });

  it("does not swallow a bug", async () => {
    state.performance.removeNonWorkingDate.mockRejectedValue(new TypeError("boom"));
    await expect(removeNonWorkingDate(1)).rejects.toThrow("boom");
  });
});
