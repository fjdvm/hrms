import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EVALUATION_TABS, isEvaluationTab, progressOf, statusOf, submitReadiness, tabCounts, type EvaluationStatus } from "@/lib/performance-evaluations-terms";

describe("the derived status", () => {
  it("is Draft with no saved evaluation, In review once a rating is saved or after a reopen, and Evaluated once submitted", () => {
    expect(statusOf(null)).toBe("Draft");
    expect(statusOf(undefined)).toBe("Draft");
    expect(statusOf({ status: "In review" })).toBe("In review");
    expect(statusOf({ status: "Evaluated" })).toBe("Evaluated");
  });

  it("knows the four tabs", () => {
    expect(EVALUATION_TABS).toEqual(["All", "Draft", "In review", "Evaluated"]);
    expect(["All", "Draft", "In review", "Evaluated"].every(isEvaluationTab)).toBe(true);
    expect(["all", "Submitted", "", null, 5].some(isEvaluationTab)).toBe(false);
  });
});

describe("the tab counts and progress", () => {
  const statuses: EvaluationStatus[] = ["Evaluated", "Evaluated", "Evaluated", "In review", "In review", "Draft", "Draft", "Draft"];

  it("counts everyone under All and each status under its tab", () => {
    expect(tabCounts(statuses)).toEqual({ All: 8, Draft: 3, "In review": 2, Evaluated: 3 });
    expect(tabCounts([])).toEqual({ All: 0, Draft: 0, "In review": 0, Evaluated: 0 });
  });

  it("reports '3 of 8 evaluated' and its whole percentage, and never divides by zero", () => {
    expect(progressOf(statuses)).toEqual({ evaluated: 3, total: 8, percent: 38 });
    expect(progressOf([])).toEqual({ evaluated: 0, total: 0, percent: 0 });
    expect(progressOf(["Evaluated"])).toEqual({ evaluated: 1, total: 1, percent: 100 });
    expect(progressOf(["Draft", "Draft", "Evaluated"])).toEqual({ evaluated: 1, total: 3, percent: 33 });
    expect(progressOf(["Draft", "Evaluated", "Evaluated"])).toEqual({ evaluated: 2, total: 3, percent: 67 });
  });
});

describe("the four Submit checks", () => {
  const ready = { attendanceImported: true, shiftSet: true, openIssues: 0, ratingEntered: true };

  it("unlocks Submit only when all four pass, in checklist order", () => {
    const result = submitReadiness(ready);

    expect(result.checks.map((c) => [c.id, c.label, c.passed, c.reason])).toEqual([
      ["attendance-imported", "Attendance imported", true, null], ["shift-set", "Shift set", true, null], ["issues-resolved", "Attendance issues resolved", true, null], ["rating-entered", "Rating entered", true, null],
    ]);
    expect(result).toMatchObject({ unlocked: true, reason: null, action: null });
  });

  it("locks Submit with the reason for the first check that is not met", () => {
    expect(submitReadiness({ ...ready, attendanceImported: false })).toMatchObject({ unlocked: false, reason: "Attendance has not been imported for this period. Import it, or confirm there was none.", action: null });
    expect(submitReadiness({ ...ready, shiftSet: false })).toMatchObject({ unlocked: false, reason: "This employee has no shift. Set it on their record to score them.", action: null });
    expect(submitReadiness({ ...ready, openIssues: 1 }).reason).toBe("1 attendance issue to resolve.");
    expect(submitReadiness({ ...ready, openIssues: 3 }).reason).toBe("3 attendance issues to resolve.");
  });

  it("offers the rating button when the rating is what is missing, and only then", () => {
    expect(submitReadiness({ ...ready, ratingEntered: false })).toMatchObject({ unlocked: false, reason: "Enter the rating.", action: "enter-rating" });
    expect(submitReadiness({ ...ready, ratingEntered: false, openIssues: 2 })).toMatchObject({ reason: "2 attendance issues to resolve.", action: null });
    const all = submitReadiness({ attendanceImported: false, shiftSet: false, openIssues: 4, ratingEntered: false });
    expect(all.checks.map((c) => c.passed)).toEqual([false, false, false, false]);
    expect(all.reason).toBe(all.checks[0].reason);
  });

  it("is pure: it imports nothing and reads no clock", () => {
    const source = readFileSync(new URL("../lib/performance-evaluations-terms.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/new Date\(|Date\.now\(/);
  });
});
