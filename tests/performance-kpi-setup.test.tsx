// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KpiSetup, inTab, matchesSearch } from "@/components/performance/kpi-setup";
import type { Kpi, WeightSet } from "@/lib/performance-kpis";

const actions = vi.hoisted(() => ({ changeKpiStatus: vi.fn(), createWeightSet: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.changeKpiStatus.mockResolvedValue({ ok: true });
  actions.createWeightSet.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const KPIS: Kpi[] = [
  { id: "attendanceRate", name: "Attendance rate", description: "Days present ÷ scheduled days", source: "Attendance import", target: "100%", status: "Active", defaultWeight: 30 },
  { id: "punctuality", name: "Punctuality", description: "On-time days ÷ present days", source: "Attendance import", target: "100%", status: "Active", defaultWeight: 25 },
  { id: "fullShift", name: "Full shift", description: "Full-shift days ÷ present days", source: "Attendance import", target: "100%", status: "Active", defaultWeight: 15 },
  { id: "trainingCompletion", name: "Training completion", description: "Completed ÷ assigned Trainings", source: "Training", target: "100%", status: "Active", defaultWeight: 15 },
  { id: "evaluatorRating", name: "Evaluator rating", description: "0 to 100, entered by the Staff member evaluating", source: "Staff rating", target: "100", status: "Active", defaultWeight: 15 },
];
const set = (id: number, name: string, position: string | null, w: [number, number, number, number, number]): WeightSet => ({
  id, name, isDefault: position === null, position, total: w.reduce((a, b) => a + b, 0), updatedByName: "Ada", updatedAt: "2026-11-16",
  weights: { attendanceRate: w[0], punctuality: w[1], fullShift: w[2], trainingCompletion: w[3], evaluatorRating: w[4] },
});
const DEFAULT = set(1, "Default set", null, [30, 25, 15, 15, 15]);
const CASHIER = set(2, "Branch Cashier", "Branch Cashier", [40, 20, 10, 10, 20]);
const renderSetup = (sets = [DEFAULT, CASHIER], kpis = KPIS) => render(<KpiSetup kpis={kpis} sets={sets} />);
const tableRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const cells = (row: HTMLElement) => within(row).getAllByRole("cell").map((cell) => cell.textContent);

describe("the KPI list", () => {
  it("lists the five KPIs with source, the set they belong to, weight, target and status", () => {
    renderSetup([DEFAULT]);

    expect(tableRows().map((row) => cells(row).map((text) => text?.replace(/\s+/g, " ")))).toEqual([
      ["Attendance rateDays present ÷ scheduled days", "Attendance import", "Default set", "30", "100%", "Active"],
      ["PunctualityOn-time days ÷ present days", "Attendance import", "Default set", "25", "100%", "Active"],
      ["Full shiftFull-shift days ÷ present days", "Attendance import", "Default set", "15", "100%", "Active"],
      ["Training completionCompleted ÷ assigned Trainings", "Training", "Default set", "15", "100%", "Active"],
      ["Evaluator rating0 to 100, entered by the Staff member evaluating", "Staff rating", "Default set", "15", "100", "Active"],
    ]);
  });

  it("shows the selected set's total out of 100, and follows the set picked", async () => {
    renderSetup();
    expect(screen.getByText("Weights · Default set")).toBeTruthy();
    expect(screen.getByTestId("weights-total").textContent).toBe("100");
    expect(screen.getByText("of 100 allocated")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");

    await userEvent.click(screen.getByRole("button", { name: "Branch Cashier" }));
    expect(screen.getByText("Weights · Branch Cashier")).toBeTruthy();
    expect(tableRows().map((row) => [cells(row)[2], cells(row)[3]])).toEqual([["Branch Cashier", "40"], ["Branch Cashier", "20"], ["Branch Cashier", "10"], ["Branch Cashier", "10"], ["Branch Cashier", "20"]]);
    expect(screen.getByTestId("weights-total").textContent).toBe("100");
  });

  it("offers no set picker when there is only the default set, and no way to delete a KPI", () => {
    renderSetup([DEFAULT]);

    expect(screen.queryByRole("group", { name: "Weight set" })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete|remove/i })).toBeNull();
    expect(screen.getByText(/can’t be deleted, only deactivated/)).toBeTruthy();
  });

  it("has the All, Active and Inactive tabs with counts, and a search", async () => {
    renderSetup([DEFAULT]);
    const tab = (name: RegExp) => screen.getByRole("button", { name });

    expect([tab(/^All/).textContent, tab(/^Active/).textContent, tab(/^Inactive/).textContent]).toEqual(["All 5", "Active 5", "Inactive 0"]);
    await userEvent.click(tab(/^Inactive/));
    expect(screen.getByText("No inactive KPIs.")).toBeTruthy();
    await userEvent.click(tab(/^All/));
    await userEvent.type(screen.getByPlaceholderText("Search KPIs"), "train");
    expect(tableRows()).toHaveLength(1);
    expect(cells(tableRows()[0])[0]).toContain("Training completion");
    await userEvent.clear(screen.getByPlaceholderText("Search KPIs"));
    await userEvent.type(screen.getByPlaceholderText("Search KPIs"), "attendance import");
    expect(tableRows()).toHaveLength(3);
    await userEvent.clear(screen.getByPlaceholderText("Search KPIs"));
    await userEvent.type(screen.getByPlaceholderText("Search KPIs"), "nothing like this");
    expect(screen.getByText("No KPIs match your search.")).toBeTruthy();
  });

  it("filters by tab and search with the same rules the list uses", () => {
    expect(inTab({ status: "Active" }, "All") && inTab({ status: "Active" }, "Active") && !inTab({ status: "Active" }, "Inactive")).toBe(true);
    expect(matchesSearch(KPIS[0], "  ATTEND ")).toBe(true);
    expect(matchesSearch(KPIS[0], "staff rating")).toBe(false);
    expect(matchesSearch(KPIS[4], "staff rating")).toBe(true);
    expect(matchesSearch(KPIS[0], "")).toBe(true);
  });
});

describe("switching a KPI on or off", () => {
  it("sets it Inactive, moves it between the tabs and tells HR", async () => {
    renderSetup([DEFAULT]);
    await userEvent.click(screen.getByRole("switch", { name: "Full shift active" }));

    expect(actions.changeKpiStatus).toHaveBeenCalledWith("fullShift", "Inactive");
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Full shift is now inactive"));
    expect([screen.getByRole("button", { name: /^Active/ }).textContent, screen.getByRole("button", { name: /^Inactive/ }).textContent]).toEqual(["Active 4", "Inactive 1"]);
    await userEvent.click(screen.getByRole("button", { name: /^Inactive/ }));
    expect(tableRows().map((row) => cells(row)[0])).toEqual(["Full shiftFull-shift days ÷ present days"]);
    expect(within(tableRows()[0]).getByText("Inactive")).toBeTruthy();
  });

  it("sets it Active again", async () => {
    renderSetup([DEFAULT], KPIS.map((kpi) => (kpi.id === "punctuality" ? { ...kpi, status: "Inactive" as const } : kpi)));
    await userEvent.click(screen.getByRole("switch", { name: "Punctuality active" }));

    expect(actions.changeKpiStatus).toHaveBeenCalledWith("punctuality", "Active");
  });

  it("puts it back and says why when the change is refused", async () => {
    actions.changeKpiStatus.mockResolvedValue({ ok: false, error: "Performance could not reach the Portal or database. Please try again in a moment." });
    renderSetup([DEFAULT]);
    await userEvent.click(screen.getByRole("switch", { name: "Full shift active" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Performance could not reach the Portal or database. Please try again in a moment."));
    expect(screen.getByRole("switch", { name: "Full shift active" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("button", { name: /^Active/ }).textContent).toBe("Active 5");
  });
});

describe("the New weight set dialog", () => {
  const open = async (sets = [DEFAULT, CASHIER]) => {
    renderSetup(sets);
    await userEvent.click(screen.getByRole("button", { name: "New weight set" }));
    return screen.getByRole("dialog");
  };
  const create = (dialog: HTMLElement) => within(dialog).getByRole("button", { name: "Create set" }) as HTMLButtonElement;
  const weight = (dialog: HTMLElement, kpi: string) => within(dialog).getByLabelText(`${kpi} weight`) as HTMLInputElement;
  const position = (dialog: HTMLElement) => within(dialog).getByLabelText(/Position/) as HTMLInputElement;

  it("shows the default set's weights and a running total of 100, with Create set off until a position is typed", async () => {
    const dialog = await open();

    expect(within(dialog).getByText("New weight set", { selector: "h2" })).toBeTruthy();
    expect(within(dialog).getByText("For one position")).toBeTruthy();
    expect(within(dialog).getByText("Default set · 30 / 25 / 15 / 15 / 15")).toBeTruthy();
    expect(within(dialog).getByTestId("weight-total").textContent).toBe("100");
    expect(within(dialog).getByText("Each weight set must total 100 before it can be saved.")).toBeTruthy();
    expect(within(dialog).getByText("Not saved yet")).toBeTruthy();
    expect(create(dialog).disabled).toBe(true);
    await userEvent.type(position(dialog), "Stock Clerk");
    expect(create(dialog).disabled).toBe(false);
  });

  it("keeps Create set disabled when the total is not 100", async () => {
    const dialog = await open();
    await userEvent.type(position(dialog), "Stock Clerk");
    expect(create(dialog).disabled).toBe(false);

    await userEvent.clear(weight(dialog, "Evaluator rating"));
    await userEvent.type(weight(dialog, "Evaluator rating"), "10");
    expect(within(dialog).getByTestId("weight-total").textContent).toBe("95");
    expect(within(dialog).getByText("Weights total 95, not 100.")).toBeTruthy();
    expect(create(dialog).disabled).toBe(true);
    await userEvent.click(create(dialog));
    expect(actions.createWeightSet).not.toHaveBeenCalled();

    await userEvent.clear(weight(dialog, "Evaluator rating"));
    await userEvent.type(weight(dialog, "Evaluator rating"), "25");
    expect(within(dialog).getByTestId("weight-total").textContent).toBe("110");
    expect(create(dialog).disabled).toBe(true);
    await userEvent.clear(weight(dialog, "Evaluator rating"));
    await userEvent.type(weight(dialog, "Evaluator rating"), "15");
    expect(create(dialog).disabled).toBe(false);
  });

  it("starts a Blank set at 0 and needs weights that total 100", async () => {
    const dialog = await open();
    await userEvent.type(position(dialog), "Stock Clerk");
    await userEvent.click(within(dialog).getByRole("button", { name: "Blank" }));

    expect(within(dialog).getByText("Blank · 0 / 0 / 0 / 0 / 0")).toBeTruthy();
    expect(within(dialog).getByTestId("weight-total").textContent).toBe("0");
    expect(create(dialog).disabled).toBe(true);
    for (const [kpi, value] of [["Attendance rate", "50"], ["Punctuality", "50"]] as const) await userEvent.type(weight(dialog, kpi), value);
    expect(within(dialog).getByTestId("weight-total").textContent).toBe("100");
    expect(create(dialog).disabled).toBe(false);
  });

  it("copies another set's weights", async () => {
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole("button", { name: "Another set" }));

    expect(within(dialog).getByText("Branch Cashier · 40 / 20 / 10 / 10 / 20")).toBeTruthy();
    expect(weight(dialog, "Attendance rate").value).toBe("40");
    await userEvent.click(within(dialog).getByRole("button", { name: "Default set" }));
    expect(weight(dialog, "Attendance rate").value).toBe("30");
  });

  it("offers Another set only when a position set exists", async () => {
    const dialog = await open([DEFAULT]);

    expect((within(dialog).getByRole("button", { name: "Another set" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("refuses a position that already has a set with the message from the Figma, ignoring case and extra spaces", async () => {
    const dialog = await open();
    await userEvent.type(position(dialog), "  branch   CASHIER ");

    expect(within(dialog).getByRole("alert").textContent).toBe("A position can have only one weight set.");
    expect(create(dialog).disabled).toBe(true);
    expect(within(dialog).queryByText(/uses this set/)).toBeNull();
    await userEvent.clear(position(dialog));
    await userEvent.type(position(dialog), "Branch Cashier II");
    expect(within(dialog).queryByRole("alert")).toBeNull();
    expect(create(dialog).disabled).toBe(false);
  });

  it("explains which Employees the set applies to once the position is valid", async () => {
    const dialog = await open();
    await userEvent.type(position(dialog), "Stock Clerk");

    expect(within(dialog).getByText("Stock Clerk uses this set")).toBeTruthy();
    expect(within(dialog).getByText(/Employees whose position is Stock Clerk use it in place of the default set\. Evaluations already submitted keep the weights they were submitted with\./)).toBeTruthy();
  });

  it("refuses an odd position and keeps only digits in a weight", async () => {
    const dialog = await open();
    await userEvent.type(position(dialog), "Cashier<script>");
    expect(within(dialog).getByRole("alert").textContent).toContain("Position can only contain");
    expect(create(dialog).disabled).toBe(true);

    fireEvent.change(weight(dialog, "Punctuality"), { target: { value: "2a5.5" } });
    expect(weight(dialog, "Punctuality").value).toBe("255");
  });

  it("creates the set with the weights typed, tells HR and closes", async () => {
    const dialog = await open();
    await userEvent.type(position(dialog), "  Stock   Clerk ");
    await userEvent.clear(weight(dialog, "Attendance rate"));
    await userEvent.type(weight(dialog, "Attendance rate"), "40");
    await userEvent.clear(weight(dialog, "Punctuality"));
    await userEvent.type(weight(dialog, "Punctuality"), "15");
    await userEvent.click(create(dialog));

    expect(actions.createWeightSet).toHaveBeenCalledWith("Stock Clerk", { attendanceRate: 40, punctuality: 15, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Weight set created for Stock Clerk"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("shows the server's refusal and stays open", async () => {
    actions.createWeightSet.mockResolvedValue({ ok: false, error: "A position can have only one weight set." });
    const dialog = await open();
    await userEvent.type(position(dialog), "Stock Clerk");
    await userEvent.click(create(dialog));

    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toBe("A position can have only one weight set."));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("closes on Cancel without saving", async () => {
    const dialog = await open();
    await userEvent.type(position(dialog), "Stock Clerk");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.createWeightSet).not.toHaveBeenCalled();
  });
});
