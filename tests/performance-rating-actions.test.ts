import { beforeEach, describe, expect, it, vi } from "vitest";
import { PerformanceError, RatingError, RosterError } from "@/lib/performance";

const state = vi.hoisted(() => ({ performance: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/portal/performance", () => ({ performanceForRequest: async () => state.performance }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { saveEvaluationRating } from "@/app/(hrms)/performance/actions";

beforeEach(() => { state.performance = { saveRating: vi.fn() }; cache.revalidatePath.mockClear(); });

describe("the save rating server action", () => {
  it("saves through the interface and refreshes the list and that Employee's page", async () => {
    expect(await saveEvaluationRating(12, 2, { rating: 85, comments: "Good" })).toEqual({ ok: true });
    expect(state.performance.saveRating).toHaveBeenCalledWith(12, 2, { rating: 85, comments: "Good" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance/evaluation/12");
  });

  it("turns refusals into the words HR reads and does not refresh", async () => {
    state.performance.saveRating.mockRejectedValue(new RatingError("rating-invalid"));
    expect(await saveEvaluationRating(12, 2, { rating: 101, comments: "" })).toEqual({ ok: false, error: "Enter a whole number from 0 to 100." });
    state.performance.saveRating.mockRejectedValue(new RatingError("already-submitted"));
    expect((await saveEvaluationRating(12, 2, { rating: 80, comments: "" })).ok).toBe(false);
    state.performance.saveRating.mockRejectedValue(new RosterError("not-in-roster"));
    expect(await saveEvaluationRating(12, 2, { rating: 80, comments: "" })).toEqual({ ok: false, error: "That employee isn’t listed in this period." });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("sends Staff without the Module to No access", async () => {
    state.performance.saveRating.mockRejectedValue(new PerformanceError("denied"));
    await expect(saveEvaluationRating(12, 2, { rating: 80, comments: "" })).rejects.toThrow("REDIRECT /no-access");
  });
});
