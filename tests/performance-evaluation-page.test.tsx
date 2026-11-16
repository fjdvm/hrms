// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvaluationView } from "@/components/performance/evaluation-view";
import type { EvaluationDetail, KpiLine } from "@/lib/performance-evaluations";
import { submitReadiness } from "@/lib/performance-evaluations-terms";

const actions = vi.hoisted(() => ({ saveEvaluationRating: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => { actions.saveEvaluationRating.mockResolvedValue({ ok: true }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const line = (id: KpiLine["id"], name: string, source: string, extra: Partial<KpiLine> = {}): KpiLine => ({
  id, name, description: "", source, target: "100%", status: "scored", result: 96.2, weight: 30, weightUsed: 30, points: 28.9, reason: null, flag: null, ...extra,
});
const KPIS = [
  line("attendanceRate", "Attendance rate", "Attendance import"),
  line("punctuality", "Punctuality", "Attendance import", { result: 88, weight: 25, weightUsed: 25, points: 22 }),
  line("fullShift", "Full shift", "Attendance import", { result: 96, weight: 15, weightUsed: 15, points: 14.4 }),
  line("trainingCompletion", "Training completion", "Training", { result: 100, weight: 15, weightUsed: 15, points: 15 }),
  line("evaluatorRating", "Evaluator rating", "Staff rating", { result: 85, weight: 15, weightUsed: 15, points: 12.8 }),
];
const NOVEMBER = { id: 2, type: "Month", kind: "Company", employeeId: null, start: "2026-11-01", end: "2026-11-30", graceMinutes: 10, name: "November 2026", createdByName: "Ada" } as const;

function detailOf(extra: Partial<EvaluationDetail> = {}, facts = { attendanceImported: true, shiftSet: true, openIssues: 0, ratingEntered: true }): EvaluationDetail {
  const rated = facts.ratingEntered;
  return {
    employeeId: 12, employeeNumber: "BR-EMP-0012", name: "Mylene Santos", position: "Production Staff", branch: "Main kitchen Antipolo",
    status: rated ? "In review" : "Draft", shift: { start: "06:00", end: "14:00", workingDays: [1, 2, 3, 4, 5, 6] },
    attendance: { imported: facts.attendanceImported, confirmedNone: false, openIssues: facts.openIssues },
    weightSet: { id: 1, name: "Default weight set", isDefault: true }, score: { outcome: "scored", value: 93 }, kpis: KPIS,
    period: { ...NOVEMBER }, formulas: { version: "1", kpis: {}, graceMinutes: 10, floorPercent: 60 }, rulesFrozen: false, history: [],
    counts: { counted: 26, present: 25, late: 3, earlyOut: 1 }, submitted: null, scheduledDays: Array(26).fill("2026-11-02"), excusedDays: [], graceMinutes: 10,
    weightsUsed: {}, weights: null, rating: rated ? { value: 85, comments: "Consistent on opening duties.", savedByName: "Ada Okafor", savedAt: "2026-11-30 02:00:00+00" } : null,
    issues: [], resultsNotMarked: 0, submit: submitReadiness(facts), ...extra,
  } as EvaluationDetail;
}
const locked = (facts: Partial<Parameters<typeof detailOf>[1]> = {}) => detailOf({}, { attendanceImported: true, shiftSet: true, openIssues: 0, ratingEntered: false, ...facts });

describe("the Employee evaluation page", () => {
  it("shows the name with the status badge, and number, position, branch and period", () => {
    render(<EvaluationView detail={detailOf()} />);

    expect(screen.getByRole("heading", { name: "Mylene Santos" })).toBeTruthy();
    expect(screen.getByText("In review")).toBeTruthy();
    expect(screen.getByText("BR-EMP-0012 · Production Staff · Main kitchen Antipolo · November 2026")).toBeTruthy();
  });

  it("names the missing check in the banner, with an Enter rating button when the rating is what is missing", async () => {
    render(<EvaluationView detail={locked()} />);

    const banner = screen.getByTestId("submit-banner");
    expect(banner.textContent).toContain("Submit is locked: the rating is not entered yet.");
    expect(banner.textContent).toContain("Attendance is imported, the shift is set and attendance issues are resolved.");
    await userEvent.click(within(banner).getByRole("button", { name: "Enter rating" }));
    expect(screen.getByRole("heading", { name: "Enter rating" })).toBeTruthy();
  });

  it("names a missing import and open issues, with no Enter rating button when something else blocks", () => {
    render(<EvaluationView detail={detailOf({}, { attendanceImported: false, shiftSet: true, openIssues: 2, ratingEntered: true })} />);

    const banner = screen.getByTestId("submit-banner");
    expect(banner.textContent).toContain("attendance is not imported yet");
    expect(banner.textContent).toContain("2 attendance issues are open");
    expect(within(banner).queryByRole("button")).toBeNull();
  });

  it("says Submit is unlocked when every check passes", () => {
    render(<EvaluationView detail={detailOf()} />);

    expect(screen.getByTestId("submit-banner").textContent).toMatch(/^Submit is unlocked: attendance is imported, the shift is set/);
  });

  it("fades Submit evaluation while locked, and cannot act until the submit dialog is wired", () => {
    const { rerender } = render(<EvaluationView detail={locked()} />);
    expect((screen.getByRole("button", { name: "Submit evaluation" }) as HTMLButtonElement).disabled).toBe(true);

    const submit = vi.fn();
    rerender(<EvaluationView detail={detailOf()} onSubmit={submit} />);
    const button = screen.getByRole("button", { name: "Submit evaluation" }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });

  it("shows the Evaluation period card: period, shift, scheduled days with excused, and grace", () => {
    render(<EvaluationView detail={detailOf({ excusedDays: ["2026-11-03"] })} />);

    const card = screen.getByRole("heading", { name: "Evaluation period" }).closest("div")!.parentElement!;
    expect(card.textContent).toContain("November 2026");
    expect(card.textContent).toContain("1 – 30 Nov 2026");
    expect(card.textContent).toContain("6 AM – 2 PM");
    expect(card.textContent).toContain("26 (1 excused)");
    expect(card.textContent).toContain("10 minutes");
  });

  it("titles the KPI results with the score out of 100 and the weight set, and lists source, result, weight and points", () => {
    render(<EvaluationView detail={detailOf()} />);

    expect(screen.getByRole("heading", { name: "KPI results · 93.0 / 100 · Default weight set" })).toBeTruthy();
    const rows = within(screen.getByRole("table")).getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell").map((cell) => cell.textContent))[0]).toEqual(["Attendance rate25 of 26 days present", "Attendance import", "96.2", "30%", "28.9"]);
    expect(screen.getByTestId("overall-score").textContent).toBe("93.0 / 100");
  });

  it("shows the rating as incomplete, with no score, while it is not entered", () => {
    render(<EvaluationView detail={locked()} />);

    expect(screen.getByRole("heading", { name: "KPI results · incomplete · Default weight set" })).toBeTruthy();
    expect(screen.getByTestId("overall-score").textContent).toBe("Incomplete");
    expect(screen.getByText("No rating or comments yet. Enter a rating from 0 to 100 and comments, then submit.")).toBeTruthy();
    // One in the banner and one on the KPI results.
    expect(screen.getAllByRole("button", { name: "Enter rating" })).toHaveLength(2);
  });

  it("shows a Not-applicable Training result with the weights rescaled, as in the Training not applicable frame", () => {
    const kpis = [
      line("attendanceRate", "Attendance rate", "Attendance import", { weightUsed: 35.3, points: 34 }),
      line("punctuality", "Punctuality", "Attendance import", { result: 88, weight: 25, weightUsed: 29.4, points: 25.9 }),
      line("fullShift", "Full shift", "Attendance import", { result: 96, weight: 15, weightUsed: 17.6, points: 16.9 }),
      line("trainingCompletion", "Training completion", "Training", { status: "not-applicable", result: null, weightUsed: null, points: null, reason: "no-training-due", weight: 15 }),
      line("evaluatorRating", "Evaluator rating", "Staff rating", { result: 85, weight: 15, weightUsed: 17.6, points: 15 }),
    ];
    render(<EvaluationView detail={detailOf({ kpis, score: { outcome: "scored", value: 91.8 } })} />);

    expect(screen.getByRole("heading", { name: "KPI results · 91.8 / 100 · Default weight set, rescaled" })).toBeTruthy();
    const training = within(screen.getByRole("table")).getAllByRole("row")[4];
    expect(within(training).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Training completionNo Training due in this period", "Training", "Not applicable", "—", "—"]);
    expect(within(screen.getByRole("table")).getAllByRole("row")[1].textContent).toContain("35.3%");
    expect(screen.getByText("Rescaled from 85%")).toBeTruthy();
  });

  it("flags Results not marked and Insufficient data in words from the spec", () => {
    const flagged = [...KPIS.slice(0, 3), line("trainingCompletion", "Training completion", "Training", { flag: "Results not marked" }), KPIS[4]];
    const { unmount } = render(<EvaluationView detail={detailOf({ kpis: flagged })} />);
    expect(screen.getByText(/Results not marked/)).toBeTruthy();
    unmount();

    render(<EvaluationView detail={detailOf({ score: { outcome: "insufficient-data" } })} />);
    expect(screen.getByRole("heading", { name: "KPI results · Insufficient data · Default weight set" })).toBeTruthy();
    expect(screen.getByTestId("overall-score").textContent).toBe("Insufficient data");
  });

  it("shows 'Not scored: shift missing' for an Employee with no shift", () => {
    render(<EvaluationView detail={detailOf({ shift: null, score: { outcome: "not-scored", reason: "shift-missing" }, kpis: [], counts: null, scheduledDays: [], rating: null }, { attendanceImported: false, shiftSet: false, openIssues: 0, ratingEntered: false })} />);

    expect(screen.getByRole("heading", { name: /KPI results · Not scored: shift missing/ })).toBeTruthy();
    expect(screen.getByText(/Not scored: shift missing\. Set the Employee/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("shows the four-item Submit checklist with each check's detail, and how many issues are open", () => {
    render(<EvaluationView detail={detailOf({}, { attendanceImported: true, shiftSet: true, openIssues: 3, ratingEntered: true })} />);

    const items = within(screen.getByRole("heading", { name: "Submit checklist" }).parentElement!).getAllByRole("listitem");
    expect(items.map((item) => [item.textContent, item.getAttribute("data-passed")])).toEqual([
      ["DoneAttendance imported25 days matched", "true"],
      ["DoneShift set6 AM – 2 PM · Mon, Tue, Wed, Thu, Fri, Sat", "true"],
      ["Not doneAttendance issues resolved3 open · see Attendance issues", "false"],
      ["DoneRating entered85 / 100 · entered 30 Nov", "true"],
    ]);
  });

  it("shows the saved rating and comments, and Edit rating opens the form with them", async () => {
    render(<EvaluationView detail={detailOf()} />);

    expect(screen.getByText("Rating 85 / 100")).toBeTruthy();
    expect(screen.getByText("Consistent on opening duties.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Edit rating" }));
    expect(screen.getByRole("heading", { name: "Edit rating" })).toBeTruthy();
    expect((screen.getByLabelText(/Rating \(0 to 100\)/) as HTMLInputElement).value).toBe("85");
    expect((screen.getByLabelText("Comments") as HTMLTextAreaElement).value).toBe("Consistent on opening duties.");
  });

  it("does not offer to change the rating of a submitted evaluation", () => {
    render(<EvaluationView detail={detailOf({ status: "Evaluated", submitted: { version: 1, submittedByName: "Ada Okafor", submittedAt: "2026-11-30 03:00:00+00", formulas: { version: "1", kpis: {}, graceMinutes: 10, floorPercent: 60 } }, submit: { ...submitReadiness({ attendanceImported: true, shiftSet: true, openIssues: 0, ratingEntered: true }), unlocked: false, reason: null, action: null } })} />);

    expect(screen.queryByRole("button", { name: "Edit rating" })).toBeNull();
    expect(screen.getByTestId("submit-banner").textContent).toMatch(/submitted and locked/);
  });
});

describe("entering the rating", () => {
  async function open() {
    render(<EvaluationView detail={locked()} />);
    await userEvent.click(within(screen.getByTestId("submit-banner")).getByRole("button", { name: "Enter rating" }));
  }
  const save = () => screen.getByRole("button", { name: "Save rating" }) as HTMLButtonElement;

  it("needs a whole rating from 0 to 100 before it can be saved, and says why", async () => {
    await open();
    expect(save().disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(/Rating \(0 to 100\)/), "101");
    expect(screen.getByRole("alert").textContent).toBe("Enter a whole number from 0 to 100.");
    expect(save().disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText(/Rating \(0 to 100\)/));
    await userEvent.type(screen.getByLabelText(/Rating \(0 to 100\)/), "8.5");
    expect(save().disabled).toBe(true);
    await userEvent.clear(screen.getByLabelText(/Rating \(0 to 100\)/));
    await userEvent.type(screen.getByLabelText(/Rating \(0 to 100\)/), "85");
    expect(save().disabled).toBe(false);
  });

  it("refuses comments with characters that do not belong", async () => {
    await open();
    await userEvent.type(screen.getByLabelText(/Rating \(0 to 100\)/), "85");

    await userEvent.type(screen.getByLabelText("Comments"), "ok\u0007");

    expect(screen.getByRole("alert").textContent).toMatch(/can’t contain/);
    expect(save().disabled).toBe(true);
  });

  it("saves the rating and comments through the action and closes", async () => {
    await open();
    await userEvent.type(screen.getByLabelText(/Rating \(0 to 100\)/), "85");
    await userEvent.type(screen.getByLabelText("Comments"), "Needs more practice with cash counts.");

    await userEvent.click(save());

    expect(actions.saveEvaluationRating).toHaveBeenCalledWith(12, 2, { rating: 85, comments: "Needs more practice with cash counts." });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Enter rating" })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Rating saved");
  });

  it("keeps the form open and shows the server's refusal", async () => {
    actions.saveEvaluationRating.mockResolvedValue({ ok: false, error: "This evaluation is already submitted, so its rating can’t be changed." });
    await open();
    await userEvent.type(screen.getByLabelText(/Rating \(0 to 100\)/), "85");

    await userEvent.click(save());

    expect((await screen.findByRole("alert")).textContent).toBe("This evaluation is already submitted, so its rating can’t be changed.");
    expect(screen.getByRole("heading", { name: "Enter rating" })).toBeTruthy();
  });
});
