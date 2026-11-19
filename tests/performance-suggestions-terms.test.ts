import { describe, expect, it } from "vitest";
import { buildSuggestionRequest, isBelowTarget, parseSuggestions, targetValue, type KpiFact } from "@/lib/performance-suggestions-terms";

const kpi = (overrides: Partial<KpiFact> = {}): KpiFact => ({ id: "punctuality", name: "Punctuality", target: "100%", status: "scored", result: 88, reason: null, ...overrides });
const good = { kpiId: "punctuality", gap: "Arrives late", trainingId: 4, recommendation: "Coaching on time-keeping", reason: "Punctuality 88.0 against a target of 100." };
const allowed = { belowTarget: ["punctuality", "evaluatorRating"], trainingIds: [4, 5] };

describe("targetValue", () => {
  it("reads the number in a target with or without a percent sign", () => {
    expect(targetValue("100%")).toBe(100);
    expect(targetValue("100")).toBe(100);
    expect(targetValue(" 95.5 % ")).toBe(95.5);
    expect(targetValue("as high as possible")).toBeNull();
  });
});

describe("isBelowTarget", () => {
  it("is below only with a result under the target", () => {
    expect(isBelowTarget(kpi({ result: 88 }))).toBe(true);
    expect(isBelowTarget(kpi({ result: 99.9 }))).toBe(true);
  });
  it("is not below when exactly at target or above", () => {
    expect(isBelowTarget(kpi({ result: 100 }))).toBe(false);
    expect(isBelowTarget(kpi({ result: 100, target: "100" }))).toBe(false);
  });
  it("is never below for a Not-applicable KPI, however it is filled in", () => {
    expect(isBelowTarget(kpi({ status: "not-applicable", result: null, reason: "no-training-due" }))).toBe(false);
    expect(isBelowTarget(kpi({ status: "not-applicable", result: 0, reason: "inactive" }))).toBe(false);
  });
  it("is not below when the target holds no number", () => {
    expect(isBelowTarget(kpi({ target: "n/a" }))).toBe(false);
  });
});

describe("buildSuggestionRequest", () => {
  const request = buildSuggestionRequest({
    position: "Branch Cashier",
    kpis: [kpi(), kpi({ id: "trainingCompletion", name: "Training completion", status: "not-applicable", result: null, reason: "no-training-due" })],
    trainings: [{ id: 4, title: "POS and cash handling", objectives: "Count cash accurately." }],
  });
  const body = JSON.parse(request.user);

  it("holds the position, results, targets, the Not-applicable reason and the Trainings", () => {
    expect(body.position).toBe("Branch Cashier");
    expect(body.kpis[0]).toEqual({ id: "punctuality", name: "Punctuality", target: "100%", result: 88, belowTarget: true });
    expect(body.kpis[1]).toEqual({ id: "trainingCompletion", name: "Training completion", target: "100%", result: null, belowTarget: false, notApplicable: "no Training was due" });
    expect(body.trainings).toEqual([{ id: 4, title: "POS and cash handling", objectives: "Count cash accurately." }]);
  });
  it("has no field for a name, an employee number, a branch or comments", () => {
    expect(Object.keys(body).sort()).toEqual(["kpis", "position", "trainings"]);
  });
});

describe("parseSuggestions", () => {
  it("accepts one to five suggestions that name a KPI below target", () => {
    expect(parseSuggestions({ suggestions: [good] }, allowed)).toEqual([good]);
    expect(parseSuggestions({ suggestions: Array(5).fill(good) }, allowed)).toHaveLength(5);
  });
  it("refuses none, more than five, or a malformed answer", () => {
    expect(parseSuggestions({ suggestions: [] }, allowed)).toBeNull();
    expect(parseSuggestions({ suggestions: Array(6).fill(good) }, allowed)).toBeNull();
    expect(parseSuggestions({}, allowed)).toBeNull();
    expect(parseSuggestions(null, allowed)).toBeNull();
    expect(parseSuggestions({ suggestions: ["x"] }, allowed)).toBeNull();
  });
  it("refuses a KPI that is not below target", () => {
    expect(parseSuggestions({ suggestions: [{ ...good, kpiId: "fullShift" }] }, allowed)).toBeNull();
  });
  it("drops a Training id that is not one of the Trainings offered and keeps the suggestion", () => {
    expect(parseSuggestions({ suggestions: [{ ...good, trainingId: 99 }] }, allowed)?.[0].trainingId).toBeNull();
    expect(parseSuggestions({ suggestions: [{ ...good, trainingId: null }] }, allowed)?.[0].trainingId).toBeNull();
    expect(parseSuggestions({ suggestions: [{ ...good, trainingId: "4" }] }, allowed)).toBeNull();
  });
  it("refuses empty, over-long or control-character text, and cleans spacing and line breaks", () => {
    for (const bad of [{ gap: "  " }, { gap: "x".repeat(121) }, { recommendation: "x".repeat(301) }, { reason: "x".repeat(201) }, { reason: "bad‮text" }, { gap: 5 }])
      expect(parseSuggestions({ suggestions: [{ ...good, ...bad }] }, allowed)).toBeNull();
    expect(parseSuggestions({ suggestions: [{ ...good, reason: "  one\nline   only " }] }, allowed)?.[0].reason).toBe("one line only");
  });
});
