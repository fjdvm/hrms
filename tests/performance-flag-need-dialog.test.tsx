// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvaluationView } from "@/components/performance/evaluation-view";
import type { EvaluationDetail, KpiLine } from "@/lib/performance-evaluations";
import { submitReadiness } from "@/lib/performance-evaluations-terms";

const actions = vi.hoisted(() => ({ saveEvaluationRating: vi.fn(), submitEvaluation: vi.fn(), reopenEvaluation: vi.fn(), flagDevelopmentNeed: vi.fn(), resolveAttendanceDay: vi.fn(), confirmNoAttendance: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => { actions.flagDevelopmentNeed.mockResolvedValue({ ok: true }); });
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

const NEED = { id: 1, employeeId: 12, periodId: 2, gap: "Cash counting at closing", action: "Training: POS and cash handling", trainingId: 4, source: "manual", suggestionId: null, flaggedById: "s1", flaggedByName: "Ada Okafor", flaggedAt: "2026-11-30 02:00:00+00" } as const;
const TRAININGS = [{ id: 4, title: "POS and cash handling" }, { id: 5, title: "Food safety" }];
const inReview = () => evaluated({ status: "In review", submitted: null });
const open = async () => userEvent.click(screen.getByRole("button", { name: "Flag development need" }));
const dialog = () => screen.getByRole("dialog");
const confirm = () => within(dialog()).getByRole("button", { name: "Flag need" }) as HTMLButtonElement;

describe("Flag development need", () => {
  it("is offered on an Evaluation that is In review and on one that is Evaluated, but not on a Draft", () => {
    const { unmount } = render(<EvaluationView detail={inReview()} />);
    expect(screen.getByRole("button", { name: "Flag development need" })).toBeTruthy();
    unmount();
    render(<EvaluationView detail={evaluated()} />);
    expect(screen.getByRole("button", { name: "Flag development need" })).toBeTruthy();
    cleanup();
    render(<EvaluationView detail={evaluated({ status: "Draft", rating: null, submitted: null })} />);
    expect(screen.queryByRole("button", { name: "Flag development need" })).toBeNull();
  });

  it("opens a dialog for the Employee and period with its fields, notes and the no-email line", async () => {
    render(<EvaluationView detail={inReview()} />);
    await open();

    expect(screen.getByRole("heading", { name: "Flag development need" })).toBeTruthy();
    expect(screen.getByText("Mylene Santos · November 2026")).toBeTruthy();
    expect(screen.getByLabelText(/^Gap/)).toBeTruthy();
    expect(screen.getByLabelText(/^Recommended action or Training/)).toBeTruthy();
    expect(screen.getByText(/Job-related gaps only\./)).toBeTruthy();
    expect(screen.getByText(/Pick a scheduled Training or describe the action/)).toBeTruthy();
    expect(screen.getByText("A flag is a recommendation for Staff to review. It never changes the score.")).toBeTruthy();
    expect(screen.getByText("No email is sent.")).toBeTruthy();
    expect(confirm().disabled).toBe(true);
  });

  it("saves nothing before it is confirmed, and Cancel saves nothing", async () => {
    render(<EvaluationView detail={inReview()} />);
    await open();
    await userEvent.type(screen.getByLabelText(/^Gap/), "Cash counting at closing");
    await userEvent.type(screen.getByLabelText(/^Recommended action or Training/), "Coaching on cash counts");
    expect(actions.flagDevelopmentNeed).not.toHaveBeenCalled();

    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(actions.flagDevelopmentNeed).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("needs both fields, refusing text that does not belong before anything is sent", async () => {
    render(<EvaluationView detail={inReview()} />);
    await open();
    await userEvent.type(screen.getByLabelText(/^Gap/), "   ");
    expect(screen.getAllByRole("alert").map((alert) => alert.textContent)).toContain("Enter the gap.");
    await userEvent.click(confirm());
    expect(actions.flagDevelopmentNeed).not.toHaveBeenCalled();
    expect(confirm().disabled).toBe(true);
  });

  it("saves the typed gap and action, closes and confirms", async () => {
    render(<EvaluationView detail={inReview()} trainings={TRAININGS} />);
    await open();
    await userEvent.type(screen.getByLabelText(/^Gap/), "Cash counting at closing");
    await userEvent.type(screen.getByLabelText(/^Recommended action or Training/), "Coaching on cash counts");
    await userEvent.click(confirm());

    await waitFor(() => expect(actions.flagDevelopmentNeed).toHaveBeenCalledWith(12, 2, { gap: "Cash counting at closing", action: "Coaching on cash counts", trainingId: null }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Development need flagged");
  });

  it("fills the action from a scheduled Training's title, and typing over it makes it a described action again", async () => {
    render(<EvaluationView detail={inReview()} trainings={TRAININGS} />);
    await open();
    await userEvent.type(screen.getByLabelText(/^Gap/), "Cash counting at closing");
    await userEvent.click(within(dialog()).getByRole("button", { name: "POS and cash handling" }));
    expect((screen.getByLabelText(/^Recommended action or Training/) as HTMLTextAreaElement).value).toBe("Training: POS and cash handling");
    await userEvent.click(confirm());
    await waitFor(() => expect(actions.flagDevelopmentNeed).toHaveBeenCalledWith(12, 2, { gap: "Cash counting at closing", action: "Training: POS and cash handling", trainingId: 4 }));

    actions.flagDevelopmentNeed.mockClear();
    await open();
    await userEvent.type(screen.getByLabelText(/^Gap/), "Customer service");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Food safety" }));
    await userEvent.type(screen.getByLabelText(/^Recommended action or Training/), " refresher");
    await userEvent.click(confirm());
    await waitFor(() => expect(actions.flagDevelopmentNeed).toHaveBeenCalledWith(12, 2, { gap: "Customer service", action: "Training: Food safety refresher", trainingId: null }));
  });

  it("offers no picks when the Training lookup is empty, and the action can still be typed", async () => {
    render(<EvaluationView detail={inReview()} />);
    await open();
    expect(screen.queryByRole("group", { name: "Scheduled Trainings" })).toBeNull();
  });

  it("shows the server's refusal and keeps the dialog open", async () => {
    actions.flagDevelopmentNeed.mockResolvedValue({ ok: false, error: "That Training no longer exists. Pick another or describe the action." });
    render(<EvaluationView detail={inReview()} trainings={TRAININGS} />);
    await open();
    await userEvent.type(screen.getByLabelText(/^Gap/), "Cash counting");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Food safety" }));
    await userEvent.click(confirm());

    expect((await screen.findAllByRole("alert")).map((alert) => alert.textContent)).toContain("That Training no longer exists. Pick another or describe the action.");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });
});

describe("the Development needs list", () => {
  it("shows each flagged need as the gap and its action, with who flagged it and when", () => {
    render(<EvaluationView detail={inReview()} needs={[NEED]} />);
    const list = screen.getByTestId("development-needs");
    expect(within(list).getByText("Cash counting at closing · recommended Training: POS and cash handling")).toBeTruthy();
    expect(within(list).getByText("Flagged by Ada Okafor on 30 Nov")).toBeTruthy();
    expect(screen.queryByText(/no gap flagged/)).toBeNull();
    expect(screen.queryByText(/Review again in/)).toBeNull();
  });

  it("shows no list when nothing is flagged", () => {
    render(<EvaluationView detail={inReview()} />);
    expect(screen.queryByTestId("development-needs")).toBeNull();
  });
});
