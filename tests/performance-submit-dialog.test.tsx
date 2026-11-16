// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvaluationView } from "@/components/performance/evaluation-view";
import type { EvaluationDetail, KpiLine } from "@/lib/performance-evaluations";
import { submitReadiness } from "@/lib/performance-evaluations-terms";

const actions = vi.hoisted(() => ({ saveEvaluationRating: vi.fn(), submitEvaluation: vi.fn(), reopenEvaluation: vi.fn(), resolveAttendanceDay: vi.fn(), confirmNoAttendance: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => { actions.submitEvaluation.mockResolvedValue({ ok: true }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const kpi = (id: KpiLine["id"], name: string): KpiLine => ({ id, name, description: "", source: "Attendance import", target: "100%", status: "scored", result: 90, weight: 20, weightUsed: 20, points: 18, reason: null, flag: null });
const KPIS = [kpi("attendanceRate", "Attendance rate"), kpi("punctuality", "Punctuality"), kpi("fullShift", "Full shift"), kpi("trainingCompletion", "Training completion"), kpi("evaluatorRating", "Evaluator rating")];
const PERIOD = { id: 2, type: "Month", kind: "Company", employeeId: null, start: "2026-11-01", end: "2026-11-30", graceMinutes: 10, name: "November 2026", createdByName: "Ada" } as const;
type Facts = { attendanceImported: boolean; shiftSet: boolean; openIssues: number; ratingEntered: boolean };
const ALL: Facts = { attendanceImported: true, shiftSet: true, openIssues: 0, ratingEntered: true };

function detail(facts: Facts = ALL, extra: Partial<EvaluationDetail> = {}): EvaluationDetail {
  return {
    employeeId: 12, employeeNumber: "BR-EMP-0012", name: "Mylene Santos", position: "Production Staff", branch: "Main kitchen Antipolo", status: facts.ratingEntered ? "In review" : "Draft",
    shift: facts.shiftSet ? { start: "06:00", end: "14:00", workingDays: [1, 2, 3, 4, 5, 6] } : null, attendance: { imported: facts.attendanceImported, confirmedNone: false, openIssues: facts.openIssues },
    weightSet: { id: 1, name: "Default weight set", isDefault: true }, score: { outcome: "scored", value: 93 }, kpis: KPIS, period: { ...PERIOD },
    formulas: { version: "1", kpis: {}, graceMinutes: 10, floorPercent: 60 }, rulesFrozen: false, history: [], counts: { counted: 26, present: 26, late: 3, earlyOut: 1 },
    submitted: null, scheduledDays: Array(26).fill("2026-11-02"), excusedDays: [], graceMinutes: 10, weightsUsed: {}, weights: null,
    rating: facts.ratingEntered ? { value: 85, comments: "Good", savedByName: "Ada Okafor", savedAt: "2026-11-30 02:00:00+00" } : null, issues: [], resultsNotMarked: 0,
    submit: submitReadiness(facts), ...extra,
  } as EvaluationDetail;
}
const submitButton = () => screen.getByRole("button", { name: "Submit evaluation" }) as HTMLButtonElement;

describe("Submit evaluation", () => {
  it("stays disabled until all four checks pass", () => {
    const missing: [string, Facts][] = [
      ["attendance not imported", { ...ALL, attendanceImported: false }],
      ["no shift", { ...ALL, shiftSet: false }],
      ["open attendance issues", { ...ALL, openIssues: 2 }],
      ["no rating", { ...ALL, ratingEntered: false }],
    ];
    for (const [, facts] of missing) {
      const { unmount } = render(<EvaluationView detail={detail(facts)} />);
      expect(submitButton().disabled).toBe(true);
      unmount();
    }
    render(<EvaluationView detail={detail()} />);
    expect(submitButton().disabled).toBe(false);
  });

  it("does not open the dialog while locked", async () => {
    render(<EvaluationView detail={detail({ ...ALL, ratingEntered: false })} />);

    await userEvent.click(submitButton());

    expect(screen.queryByRole("heading", { name: "Submit evaluation?" })).toBeNull();
  });

  it("opens a dialog with the name, period and score, what happens and the four checks as met", async () => {
    render(<EvaluationView detail={detail()} />);

    await userEvent.click(submitButton());

    expect(screen.getByRole("heading", { name: "Submit evaluation?" })).toBeTruthy();
    expect(screen.getByText("Mylene Santos · November 2026 · 93.0 / 100")).toBeTruthy();
    expect(screen.getByText("Submitting locks this evaluation")).toBeTruthy();
    expect(screen.getByText("The score, KPI results, weights and formulas used are saved for Mylene. Any Staff member who holds Performance can reopen it, with a recorded reason.")).toBeTruthy();
    expect(screen.getByText("Attendance is imported (26 days), the shift is set, attendance issues are resolved and your rating (85 / 100) is entered. All four are needed to submit.")).toBeTruthy();
    expect(screen.getByText("No email is sent.")).toBeTruthy();
  });

  it("closes with Back without submitting", async () => {
    render(<EvaluationView detail={detail()} />);
    await userEvent.click(submitButton());

    await userEvent.click(screen.getByRole("button", { name: "Back" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Submit evaluation?" })).toBeNull());
    expect(actions.submitEvaluation).not.toHaveBeenCalled();
  });

  it("submits through the action and closes", async () => {
    render(<EvaluationView detail={detail()} />);
    await userEvent.click(submitButton());

    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Submit evaluation" }));

    expect(actions.submitEvaluation).toHaveBeenCalledWith(12, 2);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Submit evaluation?" })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Evaluation submitted");
  });

  it("shows the server's reason instead of closing when a check is missing", async () => {
    actions.submitEvaluation.mockResolvedValue({ ok: false, error: "This evaluation can’t be submitted yet. Enter the rating." });
    render(<EvaluationView detail={detail()} />);
    await userEvent.click(submitButton());

    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Submit evaluation" }));

    expect((await screen.findByRole("alert")).textContent).toBe("This evaluation can’t be submitted yet. Enter the rating.");
    expect(screen.getByRole("heading", { name: "Submit evaluation?" })).toBeTruthy();
  });
});

describe("the Evaluated state", () => {
  const submitted = () => detail(ALL, {
    status: "Evaluated", submit: { ...submitReadiness(ALL), unlocked: false, reason: null, action: null },
    submitted: { version: 1, submittedByName: "Ada Okafor", submittedAt: "2026-11-30 02:00:00+00", formulas: { version: "1", kpis: {}, graceMinutes: 10, floorPercent: 60 } },
  });

  it("shows the locked banner with the date and who submitted, a Reopen button and no Submit button", () => {
    render(<EvaluationView detail={submitted()} />);

    expect(screen.getByText("Evaluated")).toBeTruthy();
    expect(screen.getByTestId("submit-banner").textContent).toContain("Evaluated and locked on 30 Nov 2026 by Ada Okafor. The score, KPI results and weights used are saved.");
    expect(screen.getByRole("button", { name: "Reopen evaluation" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Submit evaluation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit rating" })).toBeNull();
  });
});
