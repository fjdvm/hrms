// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SetUpPeriodDialog } from "@/components/performance/set-up-period-dialog";
import type { Kpi, WeightSet } from "@/lib/performance-kpis";
import type { Period } from "@/lib/performance-periods";

const actions = vi.hoisted(() => ({ openEvaluationPeriod: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.openEvaluationPeriod.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const KPIS: Kpi[] = [
  { id: "attendanceRate", name: "Attendance rate", description: "", source: "Attendance import", target: "100%", status: "Active", defaultWeight: 30 },
  { id: "punctuality", name: "Punctuality", description: "", source: "Attendance import", target: "100%", status: "Active", defaultWeight: 25 },
  { id: "fullShift", name: "Full shift", description: "", source: "Attendance import", target: "100%", status: "Active", defaultWeight: 15 },
  { id: "trainingCompletion", name: "Training completion", description: "", source: "Training", target: "100%", status: "Active", defaultWeight: 15 },
  { id: "evaluatorRating", name: "Evaluator rating", description: "", source: "Staff rating", target: "100", status: "Active", defaultWeight: 15 },
];
const set = (id: number, name: string, position: string | null, w: [number, number, number, number, number]): WeightSet => ({
  id, name, isDefault: position === null, position, total: 100, updatedByName: "Ada", updatedAt: "2026-11-16",
  weights: { attendanceRate: w[0], punctuality: w[1], fullShift: w[2], trainingCompletion: w[3], evaluatorRating: w[4] },
});
const DEFAULT = set(1, "Default set", null, [30, 25, 15, 15, 15]);
const CASHIER = set(2, "Branch Cashier", "Branch Cashier", [40, 20, 10, 10, 20]);
const NOVEMBER: Period = { id: 1, type: "Month", kind: "Company", employeeId: null, start: "2026-11-01", end: "2026-11-30", graceMinutes: 10, name: "November 2026", createdByName: "Ada" };

function renderDialog({ periods = [] as Period[], dates = [] as string[], sets = [DEFAULT] } = {}) {
  return render(<SetUpPeriodDialog defaultOpen today="2026-11-16" periods={periods} nonWorkingDates={dates} sets={sets} kpis={KPIS} />);
}
const openButton = () => screen.getByRole("button", { name: "Open period" });
const periodField = () => screen.getByRole("combobox", { name: /Period/ });

describe("Set up evaluation period", () => {
  it("opens on the current month with its dates filled, a 10 minute grace and the default weight set", () => {
    renderDialog({ dates: ["2026-11-02", "2026-11-30", "2026-12-25"] });

    expect(screen.getByRole("heading", { name: "Set up evaluation period" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Month" }).getAttribute("aria-pressed")).toBe("true");
    expect((periodField() as HTMLSelectElement).selectedOptions[0].textContent).toBe("1 – 30 Nov 2026");
    expect(screen.getByText("November 2026. One period per evaluation.")).toBeTruthy();
    expect((screen.getByLabelText(/Grace period/) as HTMLInputElement).value).toBe("10");
    expect(screen.getByText("Late = time-in after the shift start plus the grace period.")).toBeTruthy();
    expect(screen.getByText("The default weight set applies")).toBeTruthy();
    expect(screen.getByText(/Attendance rate 30 · Punctuality 25 · Full shift 15 · Training completion 15 · Evaluator rating 15\./)).toBeTruthy();
    expect((openButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows the non-working dates as a read-only count that points to the company calendar, with no scheduled days field", async () => {
    renderDialog({ dates: ["2026-11-02", "2026-11-30", "2026-12-25"] });

    const field = screen.getByLabelText("Non-working dates") as HTMLInputElement;
    expect(field.readOnly).toBe(true);
    expect(field.value).toBe("2 non-working dates in this period");
    expect(screen.getByRole("link", { name: "Open the company calendar" }).getAttribute("href")).toBe("/performance/calendar");
    expect(screen.queryByText(/scheduled working days/i)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));
    expect(field.value).toBe("3 non-working dates in this period");
  });

  it("names a position set in the callout when one exists", () => {
    renderDialog({ sets: [DEFAULT, CASHIER] });

    expect(screen.getByText(/Own sets: Branch Cashier\./)).toBeTruthy();
  });

  it("fills a Quarter's dates", async () => {
    renderDialog();

    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));

    expect((periodField() as HTMLSelectElement).selectedOptions[0].textContent).toBe("1 Oct – 31 Dec 2026");
    expect(screen.getByText("Q4 2026. One period per evaluation.")).toBeTruthy();
  });

  it("shows the overlap error on the Period field and disables Open period", async () => {
    renderDialog({ periods: [NOVEMBER] });
    expect((openButton() as HTMLButtonElement).disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));

    expect((periodField() as HTMLSelectElement).selectedOptions[0].textContent).toBe("1 Oct – 31 Dec 2026");
    expect(periodField().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe("Overlaps November 2026 (1 – 30 Nov 2026).");
    expect(periodField().getAttribute("aria-describedby")).toBe(screen.getByRole("alert").id);
    expect(screen.getByText("Periods can’t overlap by date. Choose dates after November 2026.")).toBeTruthy();
    expect((openButton() as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(openButton());
    expect(actions.openEvaluationPeriod).not.toHaveBeenCalled();
  });

  it("clears the error and enables Open period when a free month is picked", async () => {
    renderDialog({ periods: [NOVEMBER] });
    expect(screen.getByRole("alert").textContent).toContain("Overlaps November 2026");

    await userEvent.selectOptions(periodField(), "2026-12-01");

    expect(screen.queryByText(/Overlaps/)).toBeNull();
    expect((openButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("takes whole minutes only and says why otherwise, without changing what was typed", async () => {
    renderDialog();
    const grace = screen.getByLabelText(/Grace period/) as HTMLInputElement;

    await userEvent.clear(grace);
    await userEvent.type(grace, "7.5");
    expect(grace.value).toBe("7.5");
    expect(screen.getByRole("alert").textContent).toBe("Grace period can only be whole minutes, digits only.");
    expect((openButton() as HTMLButtonElement).disabled).toBe(true);

    await userEvent.clear(grace);
    await userEvent.type(grace, "15");
    expect(screen.queryByRole("alert")).toBeNull();
    expect((openButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it("opens the period through the action and closes", async () => {
    renderDialog();
    await userEvent.clear(screen.getByLabelText(/Grace period/));
    await userEvent.type(screen.getByLabelText(/Grace period/), "15");

    await userEvent.click(openButton());

    expect(actions.openEvaluationPeriod).toHaveBeenCalledWith({ type: "Month", year: 2026, month: 11, graceMinutes: 15 });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Set up evaluation period" })).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("November 2026 opened");
  });

  it("sends a Quarter as year and quarter", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Quarter" }));

    await userEvent.click(openButton());

    expect(actions.openEvaluationPeriod).toHaveBeenCalledWith({ type: "Quarter", year: 2026, quarter: 4, graceMinutes: 10 });
  });

  it("keeps the dialog open and shows the server's refusal", async () => {
    actions.openEvaluationPeriod.mockResolvedValue({ ok: false, error: "Overlaps December 2026. Periods can't overlap by date." });
    renderDialog();

    await userEvent.click(openButton());

    expect((await screen.findByRole("alert")).textContent).toBe("Overlaps December 2026. Periods can't overlap by date.");
    expect(screen.getByRole("heading", { name: "Set up evaluation period" })).toBeTruthy();
  });

  it("takes any start and end from the calendar popover for a Custom period", async () => {
    renderDialog();
    await userEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect((openButton() as HTMLButtonElement).disabled).toBe(true);

    const field = screen.getByRole("button", { name: /Period/ });
    expect(field.textContent).toBe("Select start and end");
    await userEvent.click(field);
    const grid = screen.getByRole("grid");
    await userEvent.click(within(grid).getByRole("button", { name: /November 3rd/ }));
    await userEvent.click(within(grid).getByRole("button", { name: /November 20th/ }));

    await waitFor(() => expect(field.textContent).toBe("3 – 20 Nov 2026"));
    expect((openButton() as HTMLButtonElement).disabled).toBe(false);
    await userEvent.click(openButton());
    expect(actions.openEvaluationPeriod).toHaveBeenCalledWith({ type: "Custom", start: "2026-11-03", end: "2026-11-20", graceMinutes: 10 });
  });
});
