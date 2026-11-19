import { beforeEach, describe, expect, it, vi } from "vitest";
import { NeedError, PerformanceError, SuggestionError } from "@/lib/performance";

const state = vi.hoisted(() => ({ performance: {} as Record<string, ReturnType<typeof vi.fn>> }));
vi.mock("@/lib/portal/performance", () => ({ performanceForRequest: async () => state.performance }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

import { dismissSuggestion, flagSuggestion, generateSuggestions } from "@/app/(hrms)/performance/actions";

beforeEach(() => { state.performance = { generateSuggestions: vi.fn(), flagSuggestion: vi.fn(), dismissSuggestion: vi.fn() }; cache.revalidatePath.mockClear(); });

describe("the generate suggestions server action", () => {
  it("passes a saved set through and refreshes that Employee's page", async () => {
    const result = { ok: true, set: { id: 7, version: 1, suggestions: [] }, left: 59 };
    state.performance.generateSuggestions.mockResolvedValue(result);
    expect(await generateSuggestions(12, 2)).toEqual(result);
    expect(state.performance.generateSuggestions).toHaveBeenCalledWith(12, 2);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance/evaluation/12");
  });

  it("passes Nothing to suggest and an AI refusal through without refreshing, with no internal code in them", async () => {
    state.performance.generateSuggestions.mockResolvedValue({ ok: false, kind: "nothing", left: 60 });
    expect(await generateSuggestions(12, 2)).toEqual({ ok: false, kind: "nothing", left: 60 });
    const refusal = { ok: false, kind: "ai", left: 0, failure: { banner: "yellow", message: "You've used all 60 AI suggestions today.", referenceId: null } };
    state.performance.generateSuggestions.mockResolvedValue(refusal);
    expect(await generateSuggestions(12, 2)).toEqual(refusal);
    expect(JSON.stringify(refusal)).not.toMatch(/AI-\d{4}/);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("turns an evaluation that is not submitted into words", async () => {
    state.performance.generateSuggestions.mockRejectedValue(new SuggestionError("not-evaluated"));
    expect(await generateSuggestions(12, 2)).toEqual({ ok: false, kind: "error", error: "Suggestions can be used once the evaluation is submitted." });
  });

  it("sends Staff without the Module to No access, and a lapsed session to sign in", async () => {
    state.performance.generateSuggestions.mockRejectedValue(new PerformanceError("denied"));
    await expect(generateSuggestions(12, 2)).rejects.toThrow("REDIRECT /no-access");
    state.performance.generateSuggestions.mockRejectedValue(new PerformanceError("invalid"));
    await expect(generateSuggestions(12, 2)).rejects.toThrow("REDIRECT");
    state.performance.generateSuggestions.mockRejectedValue(new PerformanceError("unavailable"));
    expect(await generateSuggestions(12, 2)).toMatchObject({ ok: false, kind: "error" });
  });
});

describe("the flag and dismiss suggestion server actions", () => {
  it("flags through the interface with the edited words and refreshes that Employee's page", async () => {
    expect(await flagSuggestion(12, 5, { gap: "Late arrivals", action: "Coaching", trainingId: null })).toEqual({ ok: true });
    expect(state.performance.flagSuggestion).toHaveBeenCalledWith(5, { gap: "Late arrivals", action: "Coaching", trainingId: null });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance/evaluation/12");
  });

  it("dismisses through the interface and refreshes the page", async () => {
    expect(await dismissSuggestion(12, 5)).toEqual({ ok: true });
    expect(state.performance.dismissSuggestion).toHaveBeenCalledWith(5);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/performance/evaluation/12");
  });

  it("turns refusals into the words HR reads and does not refresh", async () => {
    state.performance.flagSuggestion.mockRejectedValue(new SuggestionError("already-reviewed"));
    expect(await flagSuggestion(12, 5, { gap: "g", action: "a" })).toEqual({ ok: false, error: "That suggestion has already been flagged or dismissed." });
    state.performance.flagSuggestion.mockRejectedValue(new NeedError("gap-required"));
    expect(await flagSuggestion(12, 5, { gap: "", action: "a" })).toEqual({ ok: false, error: "Enter the gap." });
    state.performance.dismissSuggestion.mockRejectedValue(new SuggestionError("earlier-version"));
    expect((await dismissSuggestion(12, 5)).ok).toBe(false);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("sends Staff without the Module to No access", async () => {
    state.performance.dismissSuggestion.mockRejectedValue(new PerformanceError("denied"));
    await expect(dismissSuggestion(12, 5)).rejects.toThrow("REDIRECT /no-access");
  });
});
