import { describe, expect, it } from "vitest";
import { SALES_FORMULA, SALES_MIN_PRESENT_DAYS, scoreSales, type SalesInput } from "@/lib/performance-sales-scoring";
import { SCORING_FORMULAS, SCORING_RULES_VERSION, scoreEvaluation, type ScoringInput } from "@/lib/performance-scoring";

// Hand-computed. A target of P1,000 net sales per present day scores 100.
const ready = (netSales: number, target = 1000): SalesInput => ({ status: "ready", netSales, target });

describe("the sales KPI", () => {
  it("scores net sales per present day as a percentage of the target", () => {
    expect(scoreSales(ready(18000), 20)).toEqual({ result: 90 });   // 18,000 ÷ 20 = 900 a day = 90%
    expect(scoreSales(ready(15750), 21)).toEqual({ result: 75 });   // 750 a day
    expect(scoreSales(ready(5000), 5)).toEqual({ result: 100 });    // exactly the target
    expect(scoreSales(ready(1234.5), 10, 5)).toEqual({ result: 12.345 });
  });

  it("caps the score at 100", () => {
    expect(scoreSales(ready(40000), 20)).toEqual({ result: 100 });  // 2,000 a day = 200%
    expect(scoreSales(ready(5000.01), 5)).toEqual({ result: 100 });
  });

  it("scores negative net sales and no sales as 0, never as Not applicable", () => {
    expect(scoreSales(ready(-300), 10)).toEqual({ result: 0 });     // refunds beyond sales in the period
    expect(scoreSales(ready(0), 10)).toEqual({ result: 0 });        // present days with no orders count as zero sales
  });

  it("is Not applicable with fewer than 5 present days, and scored at exactly 5", () => {
    expect(SALES_MIN_PRESENT_DAYS).toBe(5);
    expect(scoreSales(ready(4000), 4)).toEqual({ reason: "too-few-present-days" });
    expect(scoreSales(ready(4000), 0)).toEqual({ reason: "too-few-present-days" });
    expect(scoreSales(ready(2500), 5)).toEqual({ result: 50 });
    expect(scoreSales(ready(4000), 4, 3)).toEqual({ result: 100 }); // a reopened evaluation uses the minimum it was first scored with
  });

  it.each(["no-linked-account", "before-go-live", "no-import-after-period", "no-target"] as const)("passes on the reason %s", (reason) => {
    expect(scoreSales({ status: "not-applicable", reason }, 20)).toEqual({ reason });
  });

  it("refuses figures that cannot be scored", () => {
    expect(() => scoreSales(ready(100, 0), 10)).toThrow(RangeError);
    expect(() => scoreSales(ready(100, -5), 10)).toThrow(RangeError);
    expect(() => scoreSales(ready(Number.NaN), 10)).toThrow(RangeError);
    expect(() => scoreSales(ready(100), 2.5)).toThrow(RangeError);
  });
});

// Ten scheduled days, all present and on time, both Trainings done, a rating of 80.
const WEEK = Array.from({ length: 10 }, (_, i) => `2026-11-${String(i + 2).padStart(2, "0")}`);
const base = (overrides: Partial<ScoringInput> = {}): ScoringInput => ({
  rows: WEEK.map((date) => ({ date, timeIn: "06:00", timeOut: "14:00" })), shift: { start: "06:00", end: "14:00" }, graceMinutes: 10,
  scheduledDays: WEEK, excusedDays: [], training: { completed: 2, due: 2 }, rating: 80,
  weights: { attendanceRate: 20, punctuality: 20, fullShift: 10, trainingCompletion: 10, evaluatorRating: 20, sales: 20 }, ...overrides,
});

describe("the sales KPI in the engine", () => {
  it("adds its weighted points to the score", () => {
    const scoring = scoreEvaluation(base({ sales: ready(8000) }));   // 10 present days: 800 a day = 80%

    expect(scoring.results.find((r) => r.kpi === "sales")).toMatchObject({ status: "scored", result: 80, weight: 20, weightUsed: 20, points: 16 });
    // 20 + 20 + 10 + 10 + 16 (rating) + 16 (sales)
    expect(scoring).toMatchObject({ outcome: "scored", score: 92 });
  });

  it("rescales the other weights when sales is Not applicable, so the score stays out of 100", () => {
    const scoring = scoreEvaluation(base({ sales: { status: "not-applicable", reason: "no-linked-account" } }));

    expect(scoring.results.find((r) => r.kpi === "sales")).toMatchObject({ status: "not-applicable", reason: "no-linked-account", weight: 20 });
    expect(scoring.weightsUsed).toEqual({ attendanceRate: 25, punctuality: 25, fullShift: 12.5, trainingCompletion: 12.5, evaluatorRating: 25 });
    // 25 + 25 + 12.5 + 12.5 + 20 (80 x 25%)
    expect(scoring).toMatchObject({ outcome: "scored", score: 95 });
  });

  it("is Insufficient data when sales and the rating both leave too little weight", () => {
    const scoring = scoreEvaluation(base({ rating: null, weights: { attendanceRate: 10, punctuality: 10, fullShift: 10, trainingCompletion: 10, evaluatorRating: 30, sales: 30 }, sales: { status: "not-applicable", reason: "no-target" } }));

    expect(scoring.weightRemainingPercent).toBe(40);
    expect(scoring.outcome).toBe("insufficient-data");
  });

  it("leaves sales out of the result entirely while its weight is 0, so nothing changes for anyone", () => {
    const weights = { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 };
    const without = scoreEvaluation(base({ weights }));
    const zero = scoreEvaluation(base({ weights: { ...weights, sales: 0 }, sales: ready(999999) }));

    expect(zero).toEqual(without);
    expect(without.results.map((r) => r.kpi)).toEqual(["attendanceRate", "punctuality", "fullShift", "trainingCompletion", "evaluatorRating"]);
    expect(without.weightsUsed).not.toHaveProperty("sales");
  });

  it("needs the sales figures whenever the set weighs sales", () => {
    expect(() => scoreEvaluation(base())).toThrow(/sales figures/);
  });

  it("treats an inactive sales KPI like any inactive KPI", () => {
    const scoring = scoreEvaluation(base({ sales: ready(8000), inactiveKpis: ["sales"] }));

    expect(scoring.results.find((r) => r.kpi === "sales")).toMatchObject({ status: "not-applicable", reason: "inactive" });
  });
});

describe("the frozen formula", () => {
  it("is part of the formulas saved with every submitted Evaluation, under a new rules version", () => {
    expect(SCORING_RULES_VERSION).toBe("2026-12");
    expect(SCORING_FORMULAS.sales).toBe(SALES_FORMULA);
    expect(SALES_FORMULA).toContain("capped at 100");
    expect(SALES_FORMULA).toContain("Negative net sales score 0");
    expect(SALES_FORMULA).toContain(`fewer than ${SALES_MIN_PRESENT_DAYS} present days`);
  });
});
