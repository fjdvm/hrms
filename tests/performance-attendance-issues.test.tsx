// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EvaluationView } from "@/components/performance/evaluation-view";
import type { EvaluationDetail, KpiLine } from "@/lib/performance-evaluations";
import { submitReadiness } from "@/lib/performance-evaluations-terms";

const actions = vi.hoisted(() => ({ saveEvaluationRating: vi.fn(), resolveAttendanceDay: vi.fn(), confirmNoAttendance: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => { actions.resolveAttendanceDay.mockResolvedValue({ ok: true }); actions.confirmNoAttendance.mockResolvedValue({ ok: true }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const kpi = (id: KpiLine["id"], name: string): KpiLine => ({ id, name, description: "", source: "Attendance import", target: "100%", status: "scored", result: 90, weight: 20, weightUsed: 20, points: 18, reason: null, flag: null });
const KPIS = [kpi("attendanceRate", "Attendance rate"), kpi("punctuality", "Punctuality"), kpi("fullShift", "Full shift"), kpi("trainingCompletion", "Training completion"), kpi("evaluatorRating", "Evaluator rating")];
const PERIOD = { id: 2, type: "Month", kind: "Company", employeeId: null, start: "2026-11-01", end: "2026-11-30", graceMinutes: 10, name: "November 2026", createdByName: "Ada" } as const;
const ISSUES = [{ kind: "missing-time-out", date: "2026-11-09" }, { kind: "missing-time-out", date: "2026-11-19" }] as EvaluationDetail["issues"];

function detail(issues: EvaluationDetail["issues"], extra: Partial<EvaluationDetail> = {}): EvaluationDetail {
  const open = issues.length;
  return {
    employeeId: 12, employeeNumber: "BR-EMP-0012", name: "Mylene Santos", position: "Production Staff", branch: "Main kitchen Antipolo", status: "In review",
    shift: { start: "06:00", end: "14:00", workingDays: [1, 2, 3, 4, 5, 6] }, attendance: { imported: true, confirmedNone: false, openIssues: open },
    weightSet: { id: 1, name: "Default weight set", isDefault: true }, score: { outcome: "scored", value: 93 }, kpis: KPIS, period: { ...PERIOD },
    formulas: { version: "1", kpis: {}, graceMinutes: 10, floorPercent: 60 }, rulesFrozen: false, history: [], counts: { counted: 26, present: 25, late: 3, earlyOut: 1 },
    submitted: null, scheduledDays: Array(26).fill("2026-11-02"), excusedDays: [], graceMinutes: 10, weightsUsed: {}, weights: null,
    rating: { value: 85, comments: "Good", savedByName: "Ada Okafor", savedAt: "2026-11-30 02:00:00+00" }, issues, resultsNotMarked: 0,
    submit: submitReadiness({ attendanceImported: true, shiftSet: true, openIssues: open, ratingEntered: true }), ...extra,
  } as EvaluationDetail;
}
const card = () => screen.getByRole("heading", { name: /Attendance issues/ }).closest("div")!;

describe("the Attendance issues card", () => {
  it("lists each open issue with its date, what is wrong and its actions, and points to re-importing", () => {
    render(<EvaluationView detail={detail(ISSUES)} />);

    expect(screen.getByRole("heading", { name: "Attendance issues · 2 open" })).toBeTruthy();
    const items = within(card()).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Mon 9 Nov 2026Time-in recorded, no time-outMark excusedMark absent",
      "Thu 19 Nov 2026Time-in recorded, no time-outMark excusedMark absent",
    ]);
    expect(screen.getByText("Or re-import a corrected attendance file. Times are never edited by hand.")).toBeTruthy();
  });

  it("appears only when issues exist", () => {
    render(<EvaluationView detail={detail([])} />);

    expect(screen.queryByRole("heading", { name: /Attendance issues/ })).toBeNull();
  });

  it("is not shown on a submitted evaluation", () => {
    render(<EvaluationView detail={detail(ISSUES, { submitted: { version: 1, submittedByName: "Ada", submittedAt: "2026-11-30 03:00:00+00", formulas: { version: "1", kpis: {}, graceMinutes: 10, floorPercent: 60 } } })} />);

    expect(screen.queryByRole("heading", { name: /Attendance issues/ })).toBeNull();
  });

  it("follows a resolved day: the card, the checklist and the banner update, and the card goes when none remain", () => {
    const { rerender } = render(<EvaluationView detail={detail(ISSUES)} />);
    expect(screen.getByTestId("submit-banner").textContent).toContain("2 attendance issues are open. Resolve each one below, or re-import a corrected file.");
    expect(screen.getByText("2 open · see Attendance issues")).toBeTruthy();

    rerender(<EvaluationView detail={detail(ISSUES.slice(1), { excusedDays: ["2026-11-09"] })} />);
    expect(screen.getByRole("heading", { name: "Attendance issues · 1 open" })).toBeTruthy();
    expect(screen.getByTestId("submit-banner").textContent).toContain("1 attendance issue is open");

    rerender(<EvaluationView detail={detail([], { excusedDays: ["2026-11-09", "2026-11-19"] })} />);
    expect(screen.queryByRole("heading", { name: /Attendance issues/ })).toBeNull();
    expect(screen.getByText("No open issues")).toBeTruthy();
    expect(screen.getByTestId("submit-banner").textContent).toMatch(/^Submit is unlocked/);
  });
});

describe("Mark excused", () => {
  async function open() {
    render(<EvaluationView detail={detail(ISSUES)} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark Mon 9 Nov excused" }));
  }

  it("takes an optional reason and states its effect", async () => {
    await open();

    expect(screen.getByRole("heading", { name: "Mark Mon 9 Nov as excused?" })).toBeTruthy();
    expect(screen.getByText("Mylene Santos · November 2026 · time-in recorded, no time-out")).toBeTruthy();
    expect(screen.getByText("The day is left out of scheduled days")).toBeTruthy();
    expect(screen.getByText("Mon 9 Nov no longer counts against the Attendance rate. Scheduled days become 25 and the score is recalculated. The attendance record is not edited.")).toBeTruthy();
    expect(screen.getByText("This is recorded with your name and the reason above.")).toBeTruthy();
    expect(screen.getByText("No email is sent.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Mark excused" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("saves with no reason, as null, and closes", async () => {
    await open();

    await userEvent.click(screen.getByRole("button", { name: "Mark excused" }));

    expect(actions.resolveAttendanceDay).toHaveBeenCalledWith(12, 2, "2026-11-09", { type: "Excused", reason: null });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Mark Mon 9 Nov as excused?" })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Day marked excused");
  });

  it("saves the reason when one is given", async () => {
    await open();
    await userEvent.type(screen.getByLabelText("Reason (optional)"), "Approved leave, filed with the Branch Head.");

    await userEvent.click(screen.getByRole("button", { name: "Mark excused" }));

    expect(actions.resolveAttendanceDay).toHaveBeenCalledWith(12, 2, "2026-11-09", { type: "Excused", reason: "Approved leave, filed with the Branch Head." });
  });
});

describe("Mark absent", () => {
  async function open() {
    render(<EvaluationView detail={detail(ISSUES)} />);
    await userEvent.click(screen.getByRole("button", { name: "Mark Thu 19 Nov absent" }));
  }
  const save = () => screen.getByRole("button", { name: "Mark absent" }) as HTMLButtonElement;

  it("cannot be saved without a reason", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Mark Thu 19 Nov as absent?" })).toBeTruthy();
    expect(save().disabled).toBe(true);

    await userEvent.type(screen.getByLabelText(/^Reason/), "   ");
    expect(screen.getByRole("alert").textContent).toBe("Enter a reason.");
    expect(save().disabled).toBe(true);
    await userEvent.click(save());
    expect(actions.resolveAttendanceDay).not.toHaveBeenCalled();
  });

  it("states its effect and saves once a reason is given", async () => {
    await open();
    expect(screen.getByText("The day counts as absent")).toBeTruthy();
    expect(screen.getByText("Thu 19 Nov stays a scheduled day with no attendance. Attendance rate and Punctuality are recalculated. The attendance record is not edited.")).toBeTruthy();

    await userEvent.type(screen.getByLabelText(/^Reason/), "No time-out was recorded, and the Branch Head confirmed the Employee left early.");
    await userEvent.click(save());

    expect(actions.resolveAttendanceDay).toHaveBeenCalledWith(12, 2, "2026-11-19", { type: "Absent", reason: "No time-out was recorded, and the Branch Head confirmed the Employee left early." });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Mark Thu 19 Nov as absent?" })).toBeNull());
  });

  it("refuses a reason with control characters before anything is sent", async () => {
    await open();

    await userEvent.type(screen.getByLabelText(/^Reason/), "left\u0007early");

    expect(screen.getByRole("alert").textContent).toMatch(/can’t contain control characters/);
    expect(save().disabled).toBe(true);
  });

  it("keeps the dialog open and shows the server's refusal", async () => {
    actions.resolveAttendanceDay.mockResolvedValue({ ok: false, error: "That day is no longer an open issue. Reload the page." });
    await open();
    await userEvent.type(screen.getByLabelText(/^Reason/), "Left early");

    await userEvent.click(save());

    expect((await screen.findByRole("alert")).textContent).toBe("That day is no longer an open issue. Reload the page.");
    expect(screen.getByRole("heading", { name: "Mark Thu 19 Nov as absent?" })).toBeTruthy();
  });
});

describe("an Employee with no attendance records", () => {
  const none = () => detail([{ kind: "no-attendance" }], { attendance: { imported: false, confirmedNone: false, openIssues: 1 }, counts: null, kpis: [], score: { outcome: "insufficient-data" } });

  it("shows one issue for the whole period, resolved by confirming no attendance with a required reason", async () => {
    render(<EvaluationView detail={none()} />);

    expect(screen.getByRole("heading", { name: "Attendance issues · 1 open" })).toBeTruthy();
    expect(within(card()).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /Mark .* excused/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Confirm no attendance" }));

    expect(screen.getByRole("heading", { name: "Confirm no attendance for this period?" })).toBeTruthy();
    expect(screen.getByText("The whole period counts as absent")).toBeTruthy();
    expect(screen.getByText(/Attendance rate is 0\./)).toBeTruthy();
  });

  it("will not confirm without a reason, and sends the reason when given", async () => {
    render(<EvaluationView detail={none()} />);
    await userEvent.click(screen.getByRole("button", { name: "Confirm no attendance" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Confirm no attendance" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    await userEvent.type(within(dialog).getByLabelText(/^Reason/), "On approved leave all month");
    await userEvent.click(confirm);

    expect(actions.confirmNoAttendance).toHaveBeenCalledWith(12, 2, "On approved leave all month");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("No attendance confirmed");
  });
});
