import { beforeEach, describe, expect, it, vi } from "vitest";
import { PerformanceError, ReopenError } from "@/lib/performance";

const state = vi.hoisted(() => ({ performance: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/portal/performance", () => ({ performanceForRequest: async () => state.performance }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { reopenEvaluation } from "@/app/(hrms)/performance/actions";

beforeEach(() => { state.performance = { reopenEvaluation: vi.fn() }; cache.revalidatePath.mockClear(); });

describe("the reopen evaluation server action", () => {
  it("reopens through the interface with the reason and refreshes the list and that Employee's page", async () => {
    expect(await reopenEvaluation(12, 2, "Import corrected")).toEqual({ ok: true });
    expect(state.performance.reopenEvaluation).toHaveBeenCalledWith(12, 2, "Import corrected");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance/evaluation/12");
  });

  it("turns refusals into the words HR reads and does not refresh", async () => {
    state.performance.reopenEvaluation.mockRejectedValue(new ReopenError("reason-required"));
    expect(await reopenEvaluation(12, 2, "")).toEqual({ ok: false, error: "Enter the reason for reopening." });
    state.performance.reopenEvaluation.mockRejectedValue(new ReopenError("not-evaluated"));
    expect((await reopenEvaluation(12, 2, "x")).ok).toBe(false);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("sends Staff without the Module to No access", async () => {
    state.performance.reopenEvaluation.mockRejectedValue(new PerformanceError("denied"));
    await expect(reopenEvaluation(12, 2, "x")).rejects.toThrow("REDIRECT /no-access");
  });
});
