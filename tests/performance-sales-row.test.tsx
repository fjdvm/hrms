// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { EvaluationView } from "@/components/performance/evaluation-view";
import type { EvaluationDetail, KpiLine } from "@/lib/performance-evaluations";
import { submitReadiness } from "@/lib/performance-evaluations-terms";

vi.mock("@/app/(hrms)/performance/actions", () => ({ saveEvaluationRating: vi.fn(), submitEvaluation: vi.fn(), reopenEvaluation: vi.fn(), resolveAttendanceDay: vi.fn(), confirmNoAttendance: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => cleanup());

const kpi = (id: KpiLine["id"], name: string, source: string, weight: number, extra: Partial<KpiLine> = {}): KpiLine => ({ id, name, description: name, source, target: "100%", status: "scored", result: 100, weight, weightUsed: weight, points: weight, reason: null, flag: null, ...extra });
const SALES_SCORED = kpi("sales", "Sales", "POS sales", 10, { result: 75, points: 7.5 });
const OTHERS = [kpi("attendanceRate", "Attendance rate", "Attendance import", 30), kpi("punctuality", "Punctuality", "Attendance import", 20), kpi("fullShift", "Full shift", "Attendance import", 10), kpi("trainingCompletion", "Training completion", "Training", 10), kpi("evaluatorRating", "Evaluator rating", "Staff rating", 20, { result: 80, points: 16 })];
const PERIOD = { id: 2, type: "Month", kind: "Company", employeeId: null, start: "2026-11-01", end: "2026-11-30", graceMinutes: 10, name: "November 2026", createdByName: "Ada" } as const;
const FORMULAS = { version: "2026-12", kpis: {}, graceMinutes: 10, floorPercent: 60 };
const FACTS = { attendanceImported: true, shiftSet: true, openIssues: 0, ratingEntered: true };

function detail(kpis: KpiLine[], extra: Partial<EvaluationDetail> = {}): EvaluationDetail {
  return {
    employeeId: 17, employeeNumber: "BR-EMP-0017", name: "Carla Mendoza", position: "Branch Cashier", branch: "Cainta branch", status: "In review",
    shift: { start: "06:00", end: "14:00", workingDays: [1, 2, 3, 4, 5, 6] }, attendance: { imported: true, confirmedNone: false, openIssues: 0 },
    weightSet: { id: 2, name: "Branch Cashier", isDefault: false }, score: { outcome: "scored", value: 93.5 }, kpis, period: { ...PERIOD }, formulas: FORMULAS, rulesFrozen: false,
    history: [], counts: { counted: 21, present: 21, late: 0, earlyOut: 0 }, sales: { netSales: 15750, orders: 412, presentDays: 21, target: 1000 }, scheduledDays: Array(21).fill("2026-11-02"), excusedDays: [], graceMinutes: 10,
    weightsUsed: {}, weights: null, rating: { value: 80, comments: "Reliable", savedByName: "Ada Okafor", savedAt: "2026-11-30 02:00:00+00" }, issues: [], resultsNotMarked: 0, submitted: null,
    submit: { ...submitReadiness(FACTS), unlocked: true, reason: null, action: "submit" }, ...extra,
  } as EvaluationDetail;
}
const row = (name: string) => screen.getByText(name, { selector: "span" }).closest("tr")!;

describe("the sales KPI row on the Employee evaluation page", () => {
  it("shows the source POS sales, the result, the net sales and present days behind it, the weight and the points", () => {
    render(<EvaluationView detail={detail([...OTHERS, SALES_SCORED])} />);

    const sales = within(row("Sales"));
    expect(sales.getByText("POS sales")).toBeTruthy();
    expect(sales.getByText("75.0")).toBeTruthy();
    expect(sales.getByText("₱15,750.00 net sales · 21 present days · ₱750.00 a day, target ₱1,000.00")).toBeTruthy();
    expect(sales.getByText("10%")).toBeTruthy();
    expect(sales.getByText("7.5")).toBeTruthy();
  });

  it("shows the reason when it is Not applicable", () => {
    const na = kpi("sales", "Sales", "POS sales", 10, { status: "not-applicable", result: null, weightUsed: null, points: null, reason: "no-linked-account" });
    render(<EvaluationView detail={detail([...OTHERS, na], { sales: null })} />);

    const sales = within(row("Sales"));
    expect(sales.getByText("Not applicable")).toBeTruthy();
    expect(sales.getByText("No POS account linked")).toBeTruthy();
  });

  it("shows the warning on a cashier with many present days and no orders", () => {
    const warned = kpi("sales", "Sales", "POS sales", 10, { result: 0, points: 0, flag: "No POS orders in 21 present days. Check that the right POS account is linked." });
    render(<EvaluationView detail={detail([...OTHERS, warned], { sales: { netSales: 0, orders: 0, presentDays: 21, target: 1000 } })} />);

    expect(within(row("Sales")).getByText(/No POS orders in 21 present days\. Check that the right POS account is linked\./)).toBeTruthy();
  });

  it("shows only the KPIs a submitted Evaluation was scored on: no sales row when it was not scored on sales", () => {
    render(<EvaluationView detail={detail(OTHERS, { sales: null, status: "Evaluated", submitted: { version: 1, submittedByName: "Ada Okafor", submittedAt: "2026-11-30 02:00:00+00", formulas: FORMULAS } })} />);

    expect(screen.queryByText("POS sales")).toBeNull();
    expect(screen.getByText("Attendance rate")).toBeTruthy();
  });
});
