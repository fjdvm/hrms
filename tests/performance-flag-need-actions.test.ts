import { beforeEach, describe, expect, it, vi } from "vitest";
import { NeedError, PerformanceError } from "@/lib/performance";

const state = vi.hoisted(() => ({ performance: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/portal/performance", () => ({ performanceForRequest: async () => state.performance }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { flagDevelopmentNeed } from "@/app/(hrms)/performance/actions";

beforeEach(() => { state.performance = { flagDevelopmentNeed: vi.fn() }; cache.revalidatePath.mockClear(); });

describe("the flag development need server action", () => {
  it("flags through the interface and refreshes that Employee's page", async () => {
    const input = { gap: "Cash counting", action: "Training: POS", trainingId: 4 };
    expect(await flagDevelopmentNeed(12, 2, input)).toEqual({ ok: true });
    expect(state.performance.flagDevelopmentNeed).toHaveBeenCalledWith(12, 2, input);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance/evaluation/12");
  });

  it("turns refusals into the words HR reads and does not refresh", async () => {
    state.performance.flagDevelopmentNeed.mockRejectedValue(new NeedError("gap-required"));
    expect(await flagDevelopmentNeed(12, 2, { gap: "", action: "x" })).toEqual({ ok: false, error: "Enter the gap." });
    state.performance.flagDevelopmentNeed.mockRejectedValue(new NeedError("unknown-training"));
    expect((await flagDevelopmentNeed(12, 2, { gap: "x", action: "y", trainingId: 99 })).ok).toBe(false);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("sends Staff without the Module to No access", async () => {
    state.performance.flagDevelopmentNeed.mockRejectedValue(new PerformanceError("denied"));
    await expect(flagDevelopmentNeed(12, 2, { gap: "x", action: "y" })).rejects.toThrow("REDIRECT /no-access");
  });
});
