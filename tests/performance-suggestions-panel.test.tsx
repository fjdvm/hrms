// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvaluationView } from "@/components/performance/evaluation-view";
import type { EvaluationDetail, KpiLine } from "@/lib/performance-evaluations";
import { submitReadiness } from "@/lib/performance-evaluations-terms";

const actions = vi.hoisted(() => ({ saveEvaluationRating: vi.fn(), submitEvaluation: vi.fn(), reopenEvaluation: vi.fn(), flagDevelopmentNeed: vi.fn(), generateSuggestions: vi.fn(), flagSuggestion: vi.fn(), dismissSuggestion: vi.fn(), resolveAttendanceDay: vi.fn(), confirmNoAttendance: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => { actions.flagSuggestion.mockResolvedValue({ ok: true }); actions.dismissSuggestion.mockResolvedValue({ ok: true }); actions.generateSuggestions.mockResolvedValue({ ok: true, set: {}, left: 59 }); });
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

import type { Suggestion, SuggestionSet, SuggestionStatus, SuggestionView } from "@/lib/performance-suggestions";

const ON: SuggestionStatus = { enabled: true, left: 60, limit: 60 };
const card = (id: number, overrides: Partial<Suggestion> = {}): Suggestion => ({
  id, position: id, kpiId: "punctuality", gap: "Punctuality is below target", result: 88, target: "100%", trainingId: null, trainingTitle: null,
  recommendation: "shift readiness", reason: "3 of 25 present days were late.", status: "Pending", needId: null, reviewedByName: null, reviewedAt: null, ...overrides,
});
const aSet = (suggestions: Suggestion[], version = 1): SuggestionSet => ({ id: 7, version, model: "gpt-4.1-mini", generatedByName: "Ada Okafor", generatedAt: "2026-11-18 02:00:00+00", suggestions });
const view = (set: SuggestionSet | null, extra: Partial<SuggestionView> = {}): SuggestionView => ({ set, currentVersion: set?.version ?? 1, actionable: true, ...extra });
const FULL_SHIFT = card(2, { kpiId: "fullShift", gap: "Full shift is below target", result: 96, trainingId: 4, trainingTitle: "POS and cash handling", reason: "1 of 25 present days ended before the shift end." });
const inReview = () => evaluated({ status: "In review", submitted: null });
const suggestButton = () => screen.queryByRole("button", { name: /^(Suggest with AI|Regenerate)$/ }) as HTMLButtonElement | null;
const block = () => screen.getByRole("region", { name: "AI suggestions" });
const renderView = (detail: EvaluationDetail, props: { suggestions?: SuggestionView; status?: SuggestionStatus; needs?: never[] } = {}) =>
  render(<EvaluationView detail={detail} suggestions={props.suggestions} suggestionStatus={props.status ?? ON} trainings={[{ id: 4, title: "POS and cash handling" }]} />);

describe("the Suggest with AI button", () => {
  it("is offered on an Evaluated evaluation, next to the Development needs label", () => {
    renderView(evaluated());
    expect(suggestButton()?.textContent).toBe("Suggest with AI");
    expect(screen.getByText("Development needs")).toBeTruthy();
  });

  it("is hidden while the evaluation is In review", () => {
    renderView(inReview(), { suggestions: view(null) });
    expect(suggestButton()).toBeNull();
  });

  it("is hidden when the feature is switched off, and never shown on a Draft", () => {
    const { unmount } = renderView(evaluated(), { status: { enabled: false, left: 60, limit: 60 } });
    expect(suggestButton()).toBeNull();
    unmount();
    renderView(evaluated({ status: "Draft", rating: null, submitted: null }));
    expect(suggestButton()).toBeNull();
  });

  it("says Regenerate once there is a set for this version, and Suggest with AI when the set is from an earlier version", () => {
    const { unmount } = renderView(evaluated(), { suggestions: view(aSet([card(1)])) });
    expect(suggestButton()?.textContent).toBe("Regenerate");
    unmount();
    renderView(evaluated(), { suggestions: view(aSet([card(1)], 1), { currentVersion: 2, actionable: false }) });
    expect(suggestButton()?.textContent).toBe("Suggest with AI");
  });
});

describe("pressing Suggest with AI", () => {
  it("asks for suggestions for that Employee and period, and shows the Generating state until it answers", async () => {
    let finish: (value: unknown) => void = () => {};
    actions.generateSuggestions.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    renderView(evaluated());

    await userEvent.click(suggestButton()!);

    expect(actions.generateSuggestions).toHaveBeenCalledWith(12, 2);
    expect(within(block()).getByLabelText("Generating suggestions")).toBeTruthy();
    expect(suggestButton()!.disabled).toBe(true);
    finish({ ok: true, set: {}, left: 59 });
    await waitFor(() => expect(screen.queryByLabelText("Generating suggestions")).toBeNull());
  });

  it("shows Nothing to suggest, with the version and the never-changes-the-score line", async () => {
    actions.generateSuggestions.mockResolvedValue({ ok: false, kind: "nothing", left: 60 });
    renderView(evaluated());
    await userEvent.click(suggestButton()!);
    expect(await within(block()).findByText("All KPIs are at or above target, so there is nothing to suggest for this evaluation.")).toBeTruthy();
    expect(within(block()).getByText(/version 1\. It never changes the score\./)).toBeTruthy();
  });

  it("shows a red error with its Reference ID and Try again, and no code", async () => {
    actions.generateSuggestions.mockResolvedValue({ ok: false, kind: "ai", left: 60, failure: { banner: "red", message: "The AI service is busy. Please try again in a moment.", referenceId: "7F3K2A" } });
    renderView(evaluated());
    await userEvent.click(suggestButton()!);

    expect(await within(block()).findByText("The AI service is busy. Please try again in a moment.")).toBeTruthy();
    expect(within(block()).getByText("Reference 7F3K2A · give this to support if the problem continues")).toBeTruthy();
    expect(block().textContent).not.toMatch(/AI-\d{4}/);

    actions.generateSuggestions.mockResolvedValue({ ok: true, set: {}, left: 59 });
    await userEvent.click(within(block()).getByRole("button", { name: "Try again" }));
    expect(actions.generateSuggestions).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(screen.queryByText("Reference 7F3K2A · give this to support if the problem continues")).toBeNull());
  });

  it("shows a yellow budget message with no Reference ID and no Try again", async () => {
    actions.generateSuggestions.mockResolvedValue({ ok: false, kind: "ai", left: 40, failure: { banner: "yellow", message: "AI suggestions are unavailable right now. Please try again tomorrow.", referenceId: null } });
    renderView(evaluated());
    await userEvent.click(suggestButton()!);
    expect(await within(block()).findByText("AI suggestions are unavailable right now. Please try again tomorrow.")).toBeTruthy();
    expect(within(block()).queryByText(/Reference/)).toBeNull();
    expect(within(block()).queryByRole("button", { name: "Try again" })).toBeNull();
  });
});

describe("the other states", () => {
  it("Limit reached: a disabled button and the yellow message with the reset time, no code", () => {
    renderView(evaluated(), { status: { enabled: true, left: 0, limit: 60 } });
    expect(suggestButton()!.disabled).toBe(true);
    expect(within(block()).getByText("You've used all 60 AI suggestions today. The limit resets at 12:00 AM Manila time. You can still flag development needs yourself.")).toBeTruthy();
    expect(block().textContent).not.toMatch(/AI-\d{4}/);
  });

  it("Not available: a disabled button and the grey Insufficient data message, with no AI call", async () => {
    renderView(evaluated({ score: { outcome: "insufficient-data" } }));
    expect(suggestButton()!.disabled).toBe(true);
    expect(within(block()).getByText("Suggestions aren't available for this evaluation: it has Insufficient data, so there are too few KPI results to suggest from.")).toBeTruthy();
    await userEvent.click(suggestButton()!);
    expect(actions.generateSuggestions).not.toHaveBeenCalled();
  });
});

describe("the results", () => {
  it("shows the caption with the version, who generated it, the date and that it never changes the score, and each suggestion's KPI chip, Training and reason", () => {
    renderView(evaluated(), { suggestions: view(aSet([card(1), FULL_SHIFT])) });
    const results = block();

    expect(within(results).getByText("AI-generated from this evaluation’s KPI results · version 1 · generated by Ada Okafor, 18 Nov. It never changes the score.")).toBeTruthy();
    const [first, second] = within(results).getAllByTestId("suggestion");
    expect(within(first).getByText("Punctuality is below target")).toBeTruthy();
    expect(within(first).getByText("Punctuality 88.0 · target 100")).toBeTruthy();
    expect(within(first).getByText("No matching Training. Consider a session on shift readiness.")).toBeTruthy();
    expect(within(first).getByText("3 of 25 present days were late.")).toBeTruthy();
    expect(within(second).getByText("Recommended Training: POS and cash handling")).toBeTruthy();
    expect(within(second).getByText("Full shift 96.0 · target 100")).toBeTruthy();
    for (const one of [first, second]) {
      expect(within(one).getByRole("button", { name: "Dismiss" })).toBeTruthy();
      expect(within(one).getByRole("button", { name: "Flag as need" })).toBeTruthy();
    }
  });

  it("Flag as need opens the Flag dialog pre-filled with the gap and the recommendation, and the Suggested by AI note", async () => {
    renderView(evaluated(), { suggestions: view(aSet([card(1), FULL_SHIFT])) });
    await userEvent.click(within(within(block()).getAllByTestId("suggestion")[1]).getByRole("button", { name: "Flag as need" }));

    const dialog = screen.getByRole("dialog");
    expect((within(dialog).getByLabelText(/^Gap/) as HTMLTextAreaElement).value).toBe("Full shift is below target");
    expect((within(dialog).getByLabelText(/^Recommended action or Training/) as HTMLTextAreaElement).value).toBe("Training: POS and cash handling");
    expect(within(dialog).getByText("Suggested by AI from the KPI results. Edit anything before you flag it.")).toBeTruthy();
    expect(within(dialog).getByText("Pick a scheduled Training or describe the action.", { exact: false })).toBeTruthy();
    expect(actions.flagSuggestion).not.toHaveBeenCalled();
  });

  it("saves through the suggestion with what the Staff member edited, then closes", async () => {
    renderView(evaluated(), { suggestions: view(aSet([card(1)])) });
    await userEvent.click(within(block()).getByRole("button", { name: "Flag as need" }));
    const dialog = screen.getByRole("dialog");
    const gap = within(dialog).getByLabelText(/^Gap/);
    await userEvent.clear(gap);
    await userEvent.type(gap, "Late arrivals at opening");
    await userEvent.click(within(dialog).getByRole("button", { name: "Flag need" }));

    await waitFor(() => expect(actions.flagSuggestion).toHaveBeenCalledWith(12, 1, { gap: "Late arrivals at opening", action: "shift readiness", trainingId: null }));
    expect(actions.flagDevelopmentNeed).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("Cancel saves nothing", async () => {
    renderView(evaluated(), { suggestions: view(aSet([card(1)])) });
    await userEvent.click(within(block()).getByRole("button", { name: "Flag as need" }));
    await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(actions.flagSuggestion).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a flagged suggestion shows Flagged as a development need and loses its actions", () => {
    renderView(evaluated(), { suggestions: view(aSet([card(1, { status: "Flagged", needId: 9 })])) });
    const only = within(block()).getByTestId("suggestion");
    expect(within(only).getByText("Flagged as a development need")).toBeTruthy();
    expect(within(only).queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(within(only).queryByRole("button", { name: "Flag as need" })).toBeNull();
  });

  it("Dismiss asks the server and a dismissed suggestion is hidden", async () => {
    renderView(evaluated(), { suggestions: view(aSet([card(1)])) });
    await userEvent.click(within(block()).getByRole("button", { name: "Dismiss" }));
    expect(actions.dismissSuggestion).toHaveBeenCalledWith(12, 1);

    cleanup();
    renderView(evaluated(), { suggestions: view(aSet([card(1, { status: "Dismissed" }), card(2, { gap: "Another gap" })])) });
    expect(within(block()).getAllByTestId("suggestion")).toHaveLength(1);
    expect(within(block()).queryByText("Punctuality is below target")).toBeNull();
  });

  it("shows the server's refusal when a flag or dismiss is turned down", async () => {
    actions.dismissSuggestion.mockResolvedValue({ ok: false, error: "That suggestion has already been flagged or dismissed." });
    renderView(evaluated(), { suggestions: view(aSet([card(1)])) });
    await userEvent.click(within(block()).getByRole("button", { name: "Dismiss" }));
    expect(await within(block()).findByText("That suggestion has already been flagged or dismissed.")).toBeTruthy();
  });
});

describe("after a Reopen or a later version", () => {
  it("shows the earlier set read-only, labelled with its version, with no Suggest with AI button", () => {
    renderView(inReview(), { suggestions: view(aSet([card(1)], 1), { currentVersion: 1, actionable: false }) });
    expect(suggestButton()).toBeNull();
    expect(within(block()).getByText(/version 1 · generated by Ada Okafor/)).toBeTruthy();
    expect(within(block()).queryByRole("button", { name: "Dismiss" })).toBeNull();
    expect(within(block()).queryByRole("button", { name: "Flag as need" })).toBeNull();
  });

  it("keeps an earlier version's set read-only once the evaluation is Evaluated again, and offers a new run", () => {
    renderView(evaluated(), { suggestions: view(aSet([card(1)], 1), { currentVersion: 2, actionable: false }) });
    expect(within(block()).getByText(/version 1 · generated by/)).toBeTruthy();
    expect(within(block()).queryByRole("button", { name: "Flag as need" })).toBeNull();
    expect(suggestButton()?.textContent).toBe("Suggest with AI");
  });
});

describe("the Development needs list", () => {
  const need = (source: "manual" | "ai") => ({ id: source === "ai" ? 2 : 1, employeeId: 12, periodId: 2, gap: source === "ai" ? "Full shift" : "Cash counting", action: "Training: POS", trainingId: null, source, suggestionId: null, flaggedById: "u", flaggedByName: "Ada Okafor", flaggedAt: "2026-11-30 02:00:00+00" }) as const;

  it("tags a need that came from a suggestion as AI-suggested, and no other", () => {
    render(<EvaluationView detail={evaluated()} needs={[need("manual"), need("ai")]} />);
    const items = within(screen.getByTestId("development-needs")).getAllByRole("listitem");
    expect(within(items[0]).queryByText("AI-suggested")).toBeNull();
    expect(within(items[1]).getByText("AI-suggested")).toBeTruthy();
  });
});
