// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvaluationView } from "@/components/performance/evaluation-view";
import type { EvaluationDetail, KpiLine } from "@/lib/performance-evaluations";
import { submitReadiness } from "@/lib/performance-evaluations-terms";
import type { Suggestion, SuggestionStatus, SuggestionView } from "@/lib/performance-suggestions";

const actions = vi.hoisted(() => ({
  saveEvaluationRating: vi.fn(), submitEvaluation: vi.fn(), reopenEvaluation: vi.fn(), flagDevelopmentNeed: vi.fn(), resolveAttendanceDay: vi.fn(), confirmNoAttendance: vi.fn(),
  generateSuggestions: vi.fn(), flagSuggestedNeed: vi.fn(), dismissSuggestedNeed: vi.fn(),
}));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => { actions.flagSuggestedNeed.mockResolvedValue({ ok: true }); actions.dismissSuggestedNeed.mockResolvedValue({ ok: true }); });
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
const inReview = () => evaluated({ status: "In review", submitted: null });

const suggestion = (id: number, extra: Partial<Suggestion> = {}): Suggestion => ({
  id, position: id, kpiId: "punctuality", gap: "Punctuality is below target", result: 88, target: "100%", trainingId: null, trainingTitle: null,
  recommendation: "shift readiness", reason: "3 of 25 present days were late.", status: "Pending", needId: null, reviewedByName: null, reviewedAt: null, ...extra,
});
const view = (suggestions: Suggestion[], extra: Partial<SuggestionView> = {}): SuggestionView => ({
  set: { id: 1, version: 1, model: "m", generatedByName: "Ada Okafor", generatedAt: "2026-11-18 02:00:00+00", suggestions }, currentVersion: 1, actionable: true, ...extra,
});
const ON: SuggestionStatus = { enabled: true, left: 59, limit: 60 };
const TRAININGS = [{ id: 4, title: "POS and cash handling" }];
const NONE: SuggestionView = { set: null, currentVersion: 1, actionable: false };

describe("Suggest with AI", () => {
  it("is offered on an Evaluated evaluation and hidden while In review or when the feature is off", () => {
    const { unmount } = render(<EvaluationView detail={evaluated()} suggestions={NONE} aiStatus={ON} />);
    expect(screen.getByRole("button", { name: "Suggest with AI" })).toBeTruthy();
    unmount();
    const review = render(<EvaluationView detail={inReview()} suggestions={NONE} aiStatus={ON} />);
    expect(screen.queryByRole("button", { name: "Suggest with AI" })).toBeNull();
    review.unmount();
    render(<EvaluationView detail={evaluated()} suggestions={NONE} aiStatus={{ ...ON, enabled: false }} />);
    expect(screen.queryByRole("button", { name: "Suggest with AI" })).toBeNull();
  });

  it("is hidden while In review even when an earlier version's set exists, and that set is read-only with its version", () => {
    render(<EvaluationView detail={inReview()} suggestions={view([suggestion(1), suggestion(2, { status: "Flagged", needId: 9 })], { actionable: false })} aiStatus={ON} />);
    expect(screen.queryByRole("button", { name: /Suggest with AI|Regenerate/ })).toBeNull();
    expect(screen.getByText(/version 1/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Flag as need" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(screen.getByText("Flagged as a development need")).toBeTruthy();
  });

  it("shows each suggestion with its KPI chip, the recommendation, the reason and the caption", () => {
    render(<EvaluationView detail={evaluated()} suggestions={view([suggestion(1), suggestion(2, { gap: "Full shift is below target", kpiId: "fullShift", result: 96, trainingId: 4, trainingTitle: "POS and cash handling", reason: "1 of 25 ended early." })])} aiStatus={ON} trainings={TRAININGS} />);
    expect(screen.getByText("Punctuality 88.0 · target 100")).toBeTruthy();
    expect(screen.getByText("No matching Training, consider a session on shift readiness")).toBeTruthy();
    expect(screen.getByText("Recommended Training: POS and cash handling")).toBeTruthy();
    expect(screen.getByText("3 of 25 present days were late.")).toBeTruthy();
    expect(screen.getByText(/generated by Ada Okafor, 18 Nov/)).toBeTruthy();
    expect(screen.getByText(/It never changes the score/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeTruthy();
  });

  it("Flag as need opens the Flag dialog pre-filled with the gap and the recommendation, with the AI note", async () => {
    render(<EvaluationView detail={evaluated()} suggestions={view([suggestion(1, { trainingId: 4, trainingTitle: "POS and cash handling" })])} aiStatus={ON} trainings={TRAININGS} />);
    await userEvent.click(screen.getByRole("button", { name: "Flag as need" }));

    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByLabelText(/^Gap/) as HTMLTextAreaElement).value).toBe("Punctuality is below target: 3 of 25 present days were late.");
    expect((within(dialog).getByLabelText(/^Recommended action or Training/) as HTMLTextAreaElement).value).toBe("Training: POS and cash handling");
    expect(within(dialog).getByText("Suggested by AI from the KPI results. Edit anything before you flag it.")).toBeTruthy();
    expect(within(dialog).getByText(/Pick a scheduled Training or describe the action/)).toBeTruthy();
    expect(actions.flagSuggestedNeed).not.toHaveBeenCalled();

    await userEvent.click(within(dialog).getByRole("button", { name: "Flag need" }));
    await waitFor(() => expect(actions.flagSuggestedNeed).toHaveBeenCalledWith(12, 1, { gap: "Punctuality is below target: 3 of 25 present days were late.", action: "Training: POS and cash handling", trainingId: 4 }));
    expect(actions.flagDevelopmentNeed).not.toHaveBeenCalled();
  });

  it("a flagged suggestion loses its actions and an AI-sourced need carries the AI-suggested tag", () => {
    const need = { id: 9, employeeId: 12, periodId: 2, gap: "Full shift", action: "Training: POS", trainingId: 4, source: "ai", suggestionId: 2, flaggedById: "s1", flaggedByName: "Ada Okafor", flaggedAt: "2026-11-30 02:00:00+00" } as const;
    render(<EvaluationView detail={evaluated()} needs={[need]} suggestions={view([suggestion(1), suggestion(2, { status: "Flagged", needId: 9 })])} aiStatus={ON} />);
    const cards = screen.getAllByTestId("suggestion");
    expect(within(cards[0]).getByRole("button", { name: "Flag as need" })).toBeTruthy();
    expect(within(cards[1]).getByText("Flagged as a development need")).toBeTruthy();
    expect(within(cards[1]).queryByRole("button")).toBeNull();
    expect(screen.getByText("AI-suggested")).toBeTruthy();
  });

  it("Dismiss hides the suggestion", async () => {
    render(<EvaluationView detail={evaluated()} suggestions={view([suggestion(1), suggestion(2, { gap: "Full shift is below target" })])} aiStatus={ON} />);
    await userEvent.click(within(screen.getAllByTestId("suggestion")[0]).getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByText("Punctuality is below target")).toBeNull());
    expect(actions.dismissSuggestedNeed).toHaveBeenCalledWith(12, 1);
    expect(screen.getByText("Full shift is below target")).toBeTruthy();
  });

  it("limit reached shows the yellow message with the reset time and a disabled button, and no code", () => {
    render(<EvaluationView detail={evaluated()} suggestions={NONE} aiStatus={{ ...ON, left: 0 }} />);
    expect((screen.getByRole("button", { name: "Suggest with AI" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("You've used all 60 AI suggestions today. The limit resets at 12:00 AM Manila time. You can still flag development needs yourself.")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/AI-0\d+/);
  });

  it("pressing the button asks once, and nothing asks on its own", async () => {
    actions.generateSuggestions.mockResolvedValue({ ok: false, kind: "nothing", left: 59 });
    render(<EvaluationView detail={evaluated()} suggestions={NONE} aiStatus={ON} />);
    expect(actions.generateSuggestions).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));
    expect(await screen.findByText("All KPIs are at or above target, so there is nothing to suggest for this evaluation.")).toBeTruthy();
    expect(actions.generateSuggestions).toHaveBeenCalledTimes(1);
    expect(actions.generateSuggestions).toHaveBeenCalledWith(12, 2);
  });

  it("an unavailable answer shows the red message, a Reference ID and Try again, without a code", async () => {
    actions.generateSuggestions.mockResolvedValue({ ok: false, kind: "ai", banner: "red", message: "The AI service is busy. Please try again in a moment.", referenceId: "7F3K2A", left: 59 });
    render(<EvaluationView detail={evaluated()} suggestions={NONE} aiStatus={ON} />);
    await userEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));
    expect(await screen.findByText("The AI service is busy. Please try again in a moment.")).toBeTruthy();
    expect(screen.getByText(/Reference 7F3K2A/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/AI-0\d+/);
  });

  it("a Not available answer shows the grey message only", async () => {
    actions.generateSuggestions.mockResolvedValue({ ok: false, kind: "ai", banner: "grey", message: "Suggestions aren't available for this evaluation: it has Insufficient data, so there are too few KPI results to suggest from.", referenceId: null, left: 59 });
    render(<EvaluationView detail={evaluated()} suggestions={NONE} aiStatus={ON} />);
    await userEvent.click(screen.getByRole("button", { name: "Suggest with AI" }));
    expect(await screen.findByText(/it has Insufficient data/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  });
});
