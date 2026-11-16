import { beforeEach, describe, expect, it, vi } from "vitest";
import { PerformanceError, SubmitError } from "@/lib/performance";

const state = vi.hoisted(() => ({ performance: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/portal/performance", () => ({ performanceForRequest: async () => state.performance }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { submitEvaluation } from "@/app/(hrms)/performance/actions";

beforeEach(() => { state.performance = { submitEvaluation: vi.fn() }; cache.revalidatePath.mockClear(); });

describe("the submit evaluation server action", () => {
  it("submits through the interface and refreshes the list and that Employee's page", async () => {
    expect(await submitEvaluation(12, 2)).toEqual({ ok: true });
    expect(state.performance.submitEvaluation).toHaveBeenCalledWith(12, 2);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance/evaluation/12");
  });

  it("says why a check is missing, in the checks' own words, and does not refresh", async () => {
    state.performance.submitEvaluation.mockRejectedValue(new SubmitError("checks-missing", [
      { id: "rating-entered", label: "Rating entered", passed: false, reason: "Enter the rating." },
      { id: "issues-resolved", label: "Attendance issues resolved", passed: false, reason: "2 attendance issues to resolve." },
    ]));
    expect(await submitEvaluation(12, 2)).toEqual({ ok: false, error: "This evaluation can’t be submitted yet. Enter the rating. 2 attendance issues to resolve." });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("words an already submitted evaluation and a change while submitting", async () => {
    state.performance.submitEvaluation.mockRejectedValue(new SubmitError("already-submitted"));
    expect(await submitEvaluation(12, 2)).toEqual({ ok: false, error: "This evaluation is already submitted. Reload the page." });
    state.performance.submitEvaluation.mockRejectedValue(new SubmitError("changed"));
    expect((await submitEvaluation(12, 2)).ok).toBe(false);
  });

  it("sends Staff without the Module to No access", async () => {
    state.performance.submitEvaluation.mockRejectedValue(new PerformanceError("denied"));
    await expect(submitEvaluation(12, 2)).rejects.toThrow("REDIRECT /no-access");
  });
});
