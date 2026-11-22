// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { KpiSetup } from "@/components/performance/kpi-setup";
import type { Kpi, WeightSet } from "@/lib/performance-kpis";

const actions = vi.hoisted(() => ({ changeKpiStatus: vi.fn(), createWeightSet: vi.fn(), saveSalesSettings: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.saveSalesSettings.mockResolvedValue({ ok: true });
  actions.createWeightSet.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

const KPI = (id: Kpi["id"], name: string, source: string, defaultWeight: number, extra: Partial<Kpi> = {}): Kpi => ({ id, name, description: name, source, target: "100%", status: "Active", defaultWeight, ...extra });
const KPIS: Kpi[] = [
  KPI("attendanceRate", "Attendance rate", "Attendance import", 30), KPI("punctuality", "Punctuality", "Attendance import", 25), KPI("fullShift", "Full shift", "Attendance import", 15),
  KPI("trainingCompletion", "Training completion", "Training", 15), KPI("evaluatorRating", "Evaluator rating", "Staff rating", 15),
  KPI("sales", "Sales", "POS sales import", 0, { target: "Not set", targetAmount: null }),
];
const DEFAULT: WeightSet = { id: 1, name: "Default set", isDefault: true, position: null, total: 100, updatedByName: "System", updatedAt: "2026-11-16",
  weights: { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 } };
const CASHIER: WeightSet = { ...DEFAULT, id: 2, name: "Branch Cashier", isDefault: false, position: "Branch Cashier", weights: { attendanceRate: 30, punctuality: 20, fullShift: 10, trainingCompletion: 10, evaluatorRating: 20, sales: 10 } };

const show = (sales: { target: number | null; goLiveDate: string | null } = { target: null, goLiveDate: null }, sets = [DEFAULT]) =>
  render(<KpiSetup kpis={KPIS.map((kpi) => (kpi.id === "sales" && sales.target !== null ? { ...kpi, targetAmount: sales.target } : kpi))} sets={sets} sales={sales} />);
const dialog = () => screen.getByRole("dialog");
const field = (label: string | RegExp) => within(dialog()).getByLabelText(label) as HTMLInputElement;
const save = () => within(dialog()).getByRole("button", { name: "Save" }) as HTMLButtonElement;
/** The sales KPI's table row, found by its source. */
const salesRow = () => screen.getByText("POS sales import").closest("tr")!;
/** The go-live date field: its label names it, and it shows the date. */
const goLiveField = () => within(dialog()).getByRole("button", { name: "POS go-live date" });
const openSettings = async () => userEvent.click(screen.getByRole("button", { name: "Edit sales settings" }));

describe("KPI Setup: the sales KPI row and settings", () => {
  it("lists the sales KPI with its weight (0 means off) and its target, and shows the target and go-live date", () => {
    show({ target: 1500, goLiveDate: "2026-11-10" }, [DEFAULT, CASHIER]);

    const row = salesRow();
    expect(within(row).getByText("POS sales import")).toBeTruthy();
    expect(within(row).getByText("₱1,500.00/day")).toBeTruthy();
    expect(within(row).getByText("0")).toBeTruthy();
    expect(screen.getByTestId("sales-target").textContent).toBe("₱1,500.00 per present day");
    expect(screen.getByTestId("sales-go-live").textContent).toBe("10 Nov 2026");
    expect(screen.getByRole("button", { name: /All 6/ })).toBeTruthy();
  });

  it("says Not set for a target and a go-live date that are not set", () => {
    show();

    expect(screen.getByTestId("sales-target").textContent).toBe("Not set");
    expect(screen.getByTestId("sales-go-live").textContent).toBe("Not set");
    expect(screen.getByText("Not set", { selector: "td" })).toBeTruthy();
  });

  it("shows the sales weight of the selected position set", async () => {
    show({ target: 1500, goLiveDate: "2026-11-10" }, [DEFAULT, CASHIER]);
    await userEvent.click(screen.getByRole("button", { name: "Branch Cashier" }));

    expect(screen.getByTestId("weights-total").textContent).toBe("100");
    expect(within(salesRow()).getByText("10")).toBeTruthy();
  });
});

describe("the Sales settings dialog", () => {
  it("opens with what is saved, and Save stays off until something valid changes", async () => {
    show({ target: 1500, goLiveDate: "2026-11-10" });
    await openSettings();

    expect(screen.getByRole("heading", { name: "Sales settings" })).toBeTruthy();
    expect(field("Sales target").value).toBe("1500");
    expect(goLiveField().textContent).toBe("10 Nov 2026");
    expect(screen.getByText("No changes")).toBeTruthy();
    expect(save().disabled).toBe(true);

    await userEvent.type(field("Sales target"), "5");
    expect(save().disabled).toBe(false);
    expect(screen.getByText("Not saved yet")).toBeTruthy();
  });

  it("saves nothing until Save, and sends only the field that changed", async () => {
    show({ target: 1500, goLiveDate: "2026-11-10" });
    await openSettings();
    await userEvent.clear(field("Sales target"));
    await userEvent.type(field("Sales target"), "1750.50");
    expect(actions.saveSalesSettings).not.toHaveBeenCalled();

    await userEvent.click(save());

    await waitFor(() => expect(actions.saveSalesSettings).toHaveBeenCalledTimes(1));
    expect(actions.saveSalesSettings).toHaveBeenCalledWith({ target: 1750.5 });
    expect(toast.success).toHaveBeenCalledWith("Sales settings saved");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("sets the go-live date from the calendar, and sends it alone", async () => {
    show({ target: 1500, goLiveDate: "2026-11-10" });
    await openSettings();
    await userEvent.click(goLiveField());
    await userEvent.click(within(screen.getByRole("grid")).getByRole("button", { name: /November 15th/ }));
    await userEvent.click(save());

    await waitFor(() => expect(actions.saveSalesSettings).toHaveBeenCalledWith({ goLive: "2026-11-15" }));
  });

  it("sets a target for the first time while the go-live date stays empty", async () => {
    show();
    await openSettings();
    await userEvent.type(field("Sales target"), "1200");
    await userEvent.click(save());

    await waitFor(() => expect(actions.saveSalesSettings).toHaveBeenCalledWith({ target: 1200 }));
  });

  it("rejects a bad target with a clear message and does not save", async () => {
    show();
    await openSettings();
    await userEvent.type(field("Sales target"), "12.345");

    expect(within(dialog()).getByRole("alert").textContent).toContain("with at most 2 decimals");
    expect(save().disabled).toBe(true);
    await userEvent.click(save());
    expect(actions.saveSalesSettings).not.toHaveBeenCalled();
  });

  it("does not let a saved target be cleared", async () => {
    show({ target: 1500, goLiveDate: null });
    await openSettings();
    await userEvent.clear(field("Sales target"));

    expect(within(dialog()).getByRole("alert").textContent).toContain("can be changed, not cleared");
    expect(save().disabled).toBe(true);
  });

  it("shows the server's refusal and stays open", async () => {
    actions.saveSalesSettings.mockResolvedValueOnce({ ok: false, error: "Choose a real calendar date." });
    show();
    await openSettings();
    await userEvent.type(field("Sales target"), "1200");
    await userEvent.click(save());

    expect((await within(dialog()).findByRole("alert")).textContent).toBe("Choose a real calendar date.");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("saves nothing on Cancel", async () => {
    show();
    await openSettings();
    await userEvent.type(field("Sales target"), "1200");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.saveSalesSettings).not.toHaveBeenCalled();
  });
});

describe("a sales weight in a position set", () => {
  const openNewSet = async () => {
    show({ target: 1500, goLiveDate: "2026-11-10" });
    await userEvent.click(screen.getByRole("button", { name: "New weight set" }));
  };

  it("starts at 0 (off), counts toward the total of 100 and is sent only when above 0", async () => {
    await openNewSet();
    expect((field("Sales weight")).value).toBe("0");
    expect(screen.getByTestId("weight-total").textContent).toBe("100");

    await userEvent.type(within(dialog()).getByLabelText("Position *"), "Branch Cashier");
    await userEvent.clear(field("Attendance rate weight"));
    await userEvent.type(field("Attendance rate weight"), "20");
    await userEvent.clear(field("Sales weight"));
    await userEvent.type(field("Sales weight"), "10");

    expect(screen.getByTestId("weight-total").textContent).toBe("100");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create set" }));
    await waitFor(() => expect(actions.createWeightSet).toHaveBeenCalledWith("Branch Cashier", { attendanceRate: 20, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15, sales: 10 }));
  });

  it("leaves the weights as they were when sales stays at 0", async () => {
    await openNewSet();
    await userEvent.type(within(dialog()).getByLabelText("Position *"), "Stock Clerk");
    await userEvent.click(within(dialog()).getByRole("button", { name: "Create set" }));

    await waitFor(() => expect(actions.createWeightSet).toHaveBeenCalledWith("Stock Clerk", { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 }));
  });

  it("refuses a total that is not 100 once sales weight is added", async () => {
    await openNewSet();
    await userEvent.type(within(dialog()).getByLabelText("Position *"), "Branch Cashier");
    await userEvent.clear(field("Sales weight"));
    await userEvent.type(field("Sales weight"), "10");

    expect(screen.getByTestId("weight-total").textContent).toBe("110");
    expect(within(dialog()).getByText("Weights total 110, not 100.")).toBeTruthy();
    expect((within(dialog()).getByRole("button", { name: "Create set" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
