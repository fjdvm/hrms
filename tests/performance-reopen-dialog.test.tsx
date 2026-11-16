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

beforeEach(() => { actions.reopenEvaluation.mockResolvedValue({ ok: true }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const kpi = (id: KpiLine["id"], name: string): KpiLine => ({ id, name, description: "", source: "Attendance import", target: "100%", status: "scored", result: 90, weight: 20, weightUsed: 20, points: 18, reason: null, flag: null });
const KPIS = [kpi("attendanceRate", "Attendance rate"), kpi("punctuality", "Punctuality"), kpi("fullShift", "Full shift"), kpi("trainingCompletion", "Training completion"), kpi("evaluatorRating", "Evaluator rating")];
const PERIOD = { id: 2, type: "Month", kind: "Company", employeeId: null, start: "2026-11-01", end: "2026-11-30", graceMinutes: 10, name: "November 2026", createdByName: "Ada" } as const;
const FACTS = { attendanceImported: true, shiftSet: true, openIssues: 0, ratingEntered: true };
const FORMULAS = { version: "1", kpis: {}, graceMinutes: 10, floorPercent: 60 };

function evaluated(extra: Partial<EvaluationDetail> = {}): EvaluationDetail {
  return {
    employeeId: 12, employeeNumber: "BR-EMP-0012", name: "Mylene Santos", position: "Production Staff", branch: "Main kitchen Antipolo", status: "Evaluated",
    shift: { start: "06:00", end: "14:00", workingDays: [1, 2, 3, 4, 5, 6] }, attendance: { imported: true, confirmedNone: false, openIssues: 0 },
    weightSet: { id: 1, name: "Default weight set", isDefault: true }, score: { outcome: "scored", value: 93 }, kpis: KPIS, period: { ...PERIOD }, formulas: FORMULAS, rulesFrozen: false,
    history: [], counts: { counted: 26, present: 26, late: 3, earlyOut: 1 }, scheduledDays: Array(26).fill("2026-11-02"), excusedDays: [], graceMinutes: 10, weightsUsed: {}, weights: null,
    rating: { value: 85, comments: "Good", savedByName: "Ada Okafor", savedAt: "2026-11-30 02:00:00+00" }, issues: [], resultsNotMarked: 0,
    submitted: { version: 1, submittedByName: "Ada Okafor", submittedAt: "2026-11-30 02:00:00+00", formulas: FORMULAS },
    submit: { ...submitReadiness(FACTS), unlocked: false, reason: null, action: null }, ...extra,
  } as EvaluationDetail;
}
const reopenButton = () => screen.getByRole("button", { name: "Reopen evaluation" });
const dialog = () => screen.getByRole("dialog");
const confirm = () => within(dialog()).getByRole("button", { name: "Reopen evaluation" }) as HTMLButtonElement;

describe("Reopen evaluation", () => {
  it("opens a dialog with the name, period, submitted date and score, and what happens", async () => {
    render(<EvaluationView detail={evaluated()} />);

    await userEvent.click(reopenButton());

    expect(screen.getByRole("heading", { name: "Reopen evaluation?" })).toBeTruthy();
    expect(screen.getByText("Mylene Santos · November 2026 · submitted 30 Nov · 93.0 / 100")).toBeTruthy();
    expect(screen.getByText("The submitted version is kept")).toBeTruthy();
    expect(screen.getByText("The evaluation returns to In review. The version submitted on 30 Nov (93.0) is kept, and the score is recalculated from current data with the same weights.")).toBeTruthy();
    expect(screen.getByText("Any Staff member who holds Performance can reopen an evaluation. This is recorded with your name and the reason above.")).toBeTruthy();
    expect(screen.getByText("No email is sent.")).toBeTruthy();
  });

  it("stays disabled until a reason is entered", async () => {
    render(<EvaluationView detail={evaluated()} />);
    await userEvent.click(reopenButton());
    expect(confirm().disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(/^Reason/), "   ");
    expect(screen.getByRole("alert").textContent).toBe("Enter the reason for reopening.");
    expect(confirm().disabled).toBe(true);
    await userEvent.click(confirm());
    expect(actions.reopenEvaluation).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText(/^Reason/), "Attendance import for 12 Nov was corrected.");
    expect(confirm().disabled).toBe(false);
  });

  it("refuses a reason with control characters before anything is sent", async () => {
    render(<EvaluationView detail={evaluated()} />);
    await userEvent.click(reopenButton());

    await userEvent.type(screen.getByLabelText(/^Reason/), "bad\u0007reason");

    expect(screen.getByRole("alert").textContent).toMatch(/can’t contain control/);
    expect(confirm().disabled).toBe(true);
  });

  it("keeps it locked with Keep locked, changing nothing", async () => {
    render(<EvaluationView detail={evaluated()} />);
    await userEvent.click(reopenButton());
    await userEvent.type(screen.getByLabelText(/^Reason/), "Some reason");

    await userEvent.click(within(dialog()).getByRole("button", { name: "Keep locked" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Reopen evaluation?" })).toBeNull());
    expect(actions.reopenEvaluation).not.toHaveBeenCalled();
  });

  it("reopens through the action with the reason and closes", async () => {
    render(<EvaluationView detail={evaluated()} />);
    await userEvent.click(reopenButton());
    await userEvent.type(screen.getByLabelText(/^Reason/), "Attendance import for 12 Nov was corrected.");

    await userEvent.click(confirm());

    expect(actions.reopenEvaluation).toHaveBeenCalledWith(12, 2, "Attendance import for 12 Nov was corrected.");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Reopen evaluation?" })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Evaluation reopened");
  });

  it("keeps the dialog open and shows the server's refusal", async () => {
    actions.reopenEvaluation.mockResolvedValue({ ok: false, error: "This evaluation is not submitted, so there is nothing to reopen. Reload the page." });
    render(<EvaluationView detail={evaluated()} />);
    await userEvent.click(reopenButton());
    await userEvent.type(screen.getByLabelText(/^Reason/), "Some reason");

    await userEvent.click(confirm());

    expect((await screen.findByRole("alert")).textContent).toMatch(/nothing to reopen/);
    expect(screen.getByRole("heading", { name: "Reopen evaluation?" })).toBeTruthy();
  });
});

describe("after reopening", () => {
  const reopened = () => evaluated({
    status: "In review", submitted: null,
    history: [{ version: 1, outcome: "scored", score: 93, rating: 85, weightSetName: "Default weight set", submittedByName: "Ada Okafor", submittedAt: "2026-11-30 02:00:00+00", reopened: { reason: "Import corrected.", reopenedByName: "Bo Cruz", reopenedAt: "2026-12-02 03:00:00+00" } }],
    submit: submitReadiness(FACTS),
  });

  it("shows In review, an unlocked banner and Submit, with the previous version noted as kept", () => {
    render(<EvaluationView detail={reopened()} />);

    expect(screen.getByText("In review")).toBeTruthy();
    expect(screen.getByTestId("submit-banner").textContent).toMatch(/^Submit is unlocked/);
    expect((screen.getByRole("button", { name: "Submit evaluation" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Reopen evaluation" })).toBeNull();
    expect(screen.getByTestId("kept-version").textContent).toBe("Reopened by Bo Cruz on 2 Dec 2026: Import corrected. Version 1, submitted on 30 Nov 2026 (93.0), is kept.");
  });

  it("always shows the Reopening note, and no kept-version line before any submit", () => {
    render(<EvaluationView detail={evaluated({ status: "In review", submitted: null, history: [], submit: submitReadiness(FACTS) })} />);

    expect(screen.getByRole("heading", { name: "Reopening" })).toBeTruthy();
    expect(screen.getByText("Any Staff member who holds Performance can reopen a submitted evaluation, with a recorded reason. The previous version is kept.")).toBeTruthy();
    expect(screen.queryByTestId("kept-version")).toBeNull();
  });
});
