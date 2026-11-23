import { describe, expect, it } from "vitest";
import { lineFigures } from "@/lib/performance-evaluation-view";
import { submitReadiness } from "@/lib/performance-evaluations-terms";
import type { EvaluationDetail, KpiLine } from "@/lib/performance-evaluations";

// What the Employee evaluation page says on the sales KPI row, hand-computed.
const sales = (extra: Partial<KpiLine> = {}): KpiLine => ({
  id: "sales", name: "Sales", description: "Net sales per present day", source: "POS sales", target: "₱1,000.00 net sales per present day", status: "scored", result: 75, weight: 10, weightUsed: 10, points: 7.5, reason: null, flag: null, ...extra,
});
const RATING = { value: 80, comments: "Reliable", savedByName: "Ada Okafor", savedAt: "2026-11-30T02:00:00Z" };
const detail = (extra: Partial<Pick<EvaluationDetail, "sales" | "counts">> = {}) => ({
  shift: { start: "08:00", end: "17:00", workingDays: [1, 2, 3, 4, 5] }, rating: RATING as EvaluationDetail["rating"], score: { outcome: "scored", value: 93.5 } as EvaluationDetail["score"],
  counts: { counted: 21, present: 21, late: 0, earlyOut: 0 }, sales: { netSales: 15750, orders: 412, presentDays: 21, target: 1000 }, submit: submitReadiness({ attendanceImported: true, shiftSet: true, openIssues: 0, ratingEntered: true }), ...extra,
});

describe("the sales KPI row", () => {
  it("shows the result, weight and points, with the net sales and present days behind it", () => {
    expect(lineFigures(detail(), sales())).toEqual({ result: "75.0", weight: "10%", points: "7.5", note: "₱15,750.00 net sales · 21 present days · ₱750.00 a day, target ₱1,000.00" });
  });

  it("says day, not days, for one present day", () => {
    expect(lineFigures(detail({ sales: { netSales: 500, orders: 3, presentDays: 1, target: 1000 } }), sales()).note).toBe("₱500.00 net sales · 1 present day · ₱500.00 a day, target ₱1,000.00");
  });

  it("shows negative net sales with a minus sign", () => {
    expect(lineFigures(detail({ sales: { netSales: -300, orders: 4, presentDays: 10, target: 1000 } }), sales({ result: 0, points: 0 })).note).toBe("−₱300.00 net sales · 10 present days · −₱30.00 a day, target ₱1,000.00");
  });

  it("shows the warning after the figures so a wrong link is noticed", () => {
    const warning = "No POS orders in 21 present days. Check that the right POS account is linked.";
    expect(lineFigures(detail({ sales: { netSales: 0, orders: 0, presentDays: 21, target: 1000 } }), sales({ result: 0, points: 0, flag: warning })).note)
      .toBe(`₱0.00 net sales · 21 present days · ₱0.00 a day, target ₱1,000.00 · ${warning}`);
  });

  it.each([
    ["no-linked-account", "No POS account linked"],
    ["before-go-live", "Period starts before POS go-live"],
    ["no-import-after-period", "No POS import since the period ended"],
    ["no-target", "No sales target set"],
  ] as const)("says why it is Not applicable: %s", (reason, words) => {
    expect(lineFigures(detail({ sales: null }), sales({ status: "not-applicable", result: null, weightUsed: null, points: null, reason }))).toEqual({ result: "Not applicable", weight: "—", points: "—", note: words });
  });

  it("says how many present days there were when there are too few", () => {
    const not = sales({ status: "not-applicable", result: null, weightUsed: null, points: null, reason: "too-few-present-days" });

    expect(lineFigures(detail({ sales: null, counts: { counted: 21, present: 4, late: 0, earlyOut: 0 } }), not)).toMatchObject({ result: "Not applicable", note: "Too few present days to measure: 4 present days" });
    expect(lineFigures(detail({ sales: null, counts: { counted: 21, present: 1, late: 0, earlyOut: 0 } }), not).note).toBe("Too few present days to measure: 1 present day");
  });

  it("keeps the figures a submitted Evaluation was scored on, whatever the page is given afterwards", () => {
    // The page reads the saved figures; a line with no figures (an Evaluation scored before the sales KPI) falls back to the description.
    expect(lineFigures(detail({ sales: null }), sales()).note).toBe("Net sales per present day");
  });
});
