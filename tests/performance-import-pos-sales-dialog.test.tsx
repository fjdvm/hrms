// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ImportPosSalesDialog } from "@/components/performance/import-pos-sales-dialog";
import type { ImportPreview } from "@/lib/performance";

const actions = vi.hoisted(() => ({ previewPosSales: vi.fn(), confirmPosImport: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const AT = "2026-11-22T07:10:00Z"; // 3:10 PM in Manila
const PREVIEW: ImportPreview = {
  range: { from: "2026-10-01", to: "2026-11-30" }, goLiveDate: "2026-10-01",
  months: [{ month: "2026-10", orders: 1612, netSales: 681904, cashiers: 5, linkedCashiers: 4 }, { month: "2026-11", orders: 1567, netSales: 663560.5, cashiers: 5, linkedCashiers: 4 }],
  totals: { days: 40, orders: 3179, grossSales: 1400000, refundAmount: 54535.5, netSales: 1345464.5 },
  accounts: { linked: 4, unlinked: [{ portalUserId: "u-rob", name: "Roberto Dela Cruz", staffNumber: "1004", branch: "Cainta branch", orders: 120, netSales: 64210 }] },
  matched: ["Angelica Cruz", "Carla Mendoza", "Liza Navarro", "Patricia Gomez"], leftOut: { orders: 6, grossSales: 1800 }, schemaCheck: "passed",
};
const SAVED = { id: 3, range: PREVIEW.range, days: 40, orders: 3179, netSales: 1345464.5, removedDays: 0, importedByName: "Ada Okafor", importedAt: "2026-11-22 07:11:00+00" };

beforeEach(() => {
  actions.previewPosSales.mockResolvedValue({ ok: true, at: AT, preview: PREVIEW });
  actions.confirmPosImport.mockResolvedValue({ ok: true, at: AT, saved: SAVED });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const open = async (props: { goLiveDate: string | null; today?: string } = { goLiveDate: "2026-10-01" }) => {
  render(<ImportPosSalesDialog goLiveDate={props.goLiveDate} today={props.today ?? "2026-11-22"} />);
  await userEvent.click(screen.getByRole("button", { name: "Import POS sales" }));
};
const dialog = () => screen.getByRole("dialog");
/** The footer button of that name: the header's X is also called Close, and comes first. */
const button = (name: string) => within(dialog()).getAllByRole("button", { name }).at(-1) as HTMLButtonElement;
const readPreview = async () => { await open(); await userEvent.click(button("Read from POS")); await screen.findByText("Matched: Angelica Cruz, Carla Mendoza, Liza Navarro, Patricia Gomez"); };

describe("Import POS sales: Ready", () => {
  it("is an outline button that opens a dialog naming the two months it will read, with no month picker", async () => {
    await open();

    expect(screen.getByRole("heading", { name: "Import POS sales" })).toBeTruthy();
    expect(screen.getByText("November 2026 and October 2026 · read-only")).toBeTruthy();
    expect(screen.getByText("November 2026 · current month")).toBeTruthy();
    expect(screen.getByText("1 – 30 Nov 2026")).toBeTruthy();
    expect(screen.getByText("October 2026 · previous month")).toBeTruthy();
    expect(screen.getByText("Re-read every time: late voids and refunds can change a closed month")).toBeTruthy();
    expect(screen.getByText("Nothing is saved until you confirm. A read takes a few seconds, and the POS database can take up to 30 seconds to wake up.")).toBeTruthy();
    expect(screen.getByText("Not read yet")).toBeTruthy();
    expect(within(dialog()).queryByRole("combobox")).toBeNull();
    expect(within(dialog()).queryByRole("textbox")).toBeNull();
    expect(actions.previewPosSales).not.toHaveBeenCalled();
  });

  it("cuts the earlier month short at the go-live date", async () => {
    await open({ goLiveDate: "2026-11-12" });

    expect(screen.getByText("November 2026 · current month")).toBeTruthy();
    expect(screen.getByText("12 – 30 Nov 2026")).toBeTruthy();
    expect(screen.queryByText("October 2026 · previous month")).toBeNull();
  });

  it("says so, points to KPI setup and reads nothing when the go-live date is not set", async () => {
    await open({ goLiveDate: null });

    expect(screen.getByRole("alert").textContent).toContain("The POS go-live date is not set yet, so nothing is read.");
    expect(within(dialog()).getByRole("link", { name: "KPI setup" }).getAttribute("href")).toBe("/performance/kpis");
    expect(within(dialog()).queryByRole("button", { name: "Read from POS" })).toBeNull();
    expect(screen.getByText("Nothing read")).toBeTruthy();
    expect(actions.previewPosSales).not.toHaveBeenCalled();
  });

  it("says there is nothing to read while the go-live date is still ahead", async () => {
    await open({ goLiveDate: "2027-03-01" });

    expect(screen.getByRole("alert").textContent).toContain("1 Mar 2027");
    expect(within(dialog()).queryByRole("button", { name: "Read from POS" })).toBeNull();
  });
});

describe("Import POS sales: reading and Preview", () => {
  it("shows progress and a Cancel while it reads, and Cancel saves nothing and drops the answer", async () => {
    let finish!: (value: unknown) => void;
    actions.previewPosSales.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await open();
    await userEvent.click(button("Read from POS"));

    expect(screen.getByText("Reading the POS…")).toBeTruthy();
    expect(screen.getByText("Checking the database, then reading November 2026 and October 2026. Up to 30 seconds if it was asleep.")).toBeTruthy();
    expect(button("Reading…").disabled).toBe(true);
    await userEvent.click(button("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    finish({ ok: true, at: AT, preview: PREVIEW });

    await userEvent.click(screen.getByRole("button", { name: "Import POS sales" }));
    expect(screen.getByText("Not read yet")).toBeTruthy();
    expect(actions.confirmPosImport).not.toHaveBeenCalled();
  });

  it("shows the months, cashiers, orders, net sales, the database check, the unlinked accounts by name and the orders left out", async () => {
    await readPreview();

    expect(screen.getByText("November 2026 and October 2026 · read from the POS just now")).toBeTruthy();
    expect(screen.getByText("POS database check passed: every table and column HRMS reads was found.")).toBeTruthy();
    const rows = within(dialog()).getAllByRole("row").map((row) => [...row.querySelectorAll("th, td")].map((cell) => cell.textContent));
    expect(rows).toEqual([["Month", "Cashiers", "Orders", "Net sales"], ["November 2026", "5 (4 linked)", "1,567", "₱663,560.50"], ["October 2026", "5 (4 linked)", "1,612", "₱681,904.00"]]);
    expect(screen.getByText(/1 POS cashier is not linked to an employee: Roberto Dela Cruz \(Portal account · Cainta branch · ₱64,210\.00 net\)\. Their sales are saved but not ranked or scored/)).toBeTruthy();
    expect(screen.getByText("Left out of the totals: 6 orders with no cashier recorded (₱1,800.00).")).toBeTruthy();
    expect(screen.getByText("Not saved yet")).toBeTruthy();
  });

  it("names an unlinked account by staff number and branch only when the Portal has no match", async () => {
    actions.previewPosSales.mockResolvedValue({ ok: true, at: AT, preview: { ...PREVIEW, accounts: { linked: 4, unlinked: [{ portalUserId: "u-x", name: null, staffNumber: "1009", branch: "Taytay branch", orders: 3, netSales: 900 }] } } });
    await readPreview();

    expect(screen.getByText(/Staff no\. 1009 \(Taytay branch · ₱900\.00 net\)/)).toBeTruthy();
  });

  it("saves nothing before Confirm import: reading and Cancel never call the import", async () => {
    await readPreview();
    expect(actions.previewPosSales).toHaveBeenCalledTimes(1);
    expect(actions.confirmPosImport).not.toHaveBeenCalled();

    await userEvent.click(button("Cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    expect(actions.confirmPosImport).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("saves once on Confirm import, says so, and closes", async () => {
    await readPreview();
    await userEvent.click(button("Confirm import"));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.confirmPosImport).toHaveBeenCalledTimes(1);
    expect(toast.success).toHaveBeenCalledWith("POS sales imported");
  });
});

describe("Import POS sales: errors", () => {
  it("POS unreachable says nothing was saved, shows the last attempt, and offers Try again or Close", async () => {
    actions.previewPosSales.mockResolvedValueOnce({ ok: false, at: AT, kind: "pos-unreachable", problems: [] });
    await open();
    await userEvent.click(button("Read from POS"));

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn’t reach the POS. Nothing was saved.");
    expect(screen.getByText(/didn’t answer within 30 seconds, and the retry timed out too/)).toBeTruthy();
    expect(screen.getByText("Last attempt: 22 Nov 2026, 3:10 PM")).toBeTruthy();
    expect(screen.getByText("Nothing saved")).toBeTruthy();
    expect(button("Close")).toBeTruthy();

    await userEvent.click(button("Try again"));
    await screen.findByText("POS database check passed: every table and column HRMS reads was found.");
    expect(actions.previewPosSales).toHaveBeenCalledTimes(2);
    expect(actions.confirmPosImport).not.toHaveBeenCalled();
  });

  it("POS data changed names what changed, says nothing was saved, and offers Try again or Close", async () => {
    actions.previewPosSales.mockResolvedValueOnce({ ok: false, at: AT, kind: "pos-data-changed", problems: ["Orders.OrderStatus: missing or not readable"] });
    await open();
    await userEvent.click(button("Read from POS"));

    expect((await screen.findByRole("alert")).textContent).toBe("The POS data has changed. Nothing was saved.");
    expect(screen.getByText("Orders.OrderStatus: missing or not readable")).toBeTruthy();
    expect(screen.getByText(/Ask the POS owner about their latest migration/)).toBeTruthy();
    expect(button("Try again")).toBeTruthy();
    await userEvent.click(button("Close"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.confirmPosImport).not.toHaveBeenCalled();
  });

  it("says the POS connection is not set up when there is no connection string", async () => {
    actions.previewPosSales.mockResolvedValueOnce({ ok: false, at: AT, kind: "pos-not-configured", problems: [] });
    await open();
    await userEvent.click(button("Read from POS"));

    expect((await screen.findByRole("alert")).textContent).toBe("The POS connection is not set up. Nothing was saved.");
  });

  it("shows a failure on Confirm import as nothing saved, and stays open", async () => {
    actions.confirmPosImport.mockResolvedValueOnce({ ok: false, at: AT, kind: "pos-unreachable", problems: [] });
    await readPreview();
    await userEvent.click(button("Confirm import"));

    expect((await screen.findByRole("alert")).textContent).toBe("We couldn’t reach the POS. Nothing was saved.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });
});
