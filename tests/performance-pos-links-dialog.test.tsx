// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LinkedEmployee } from "@/lib/performance-links";

const loadPosLinks = vi.fn();
const unlinkPosAccount = vi.fn();
const refresh = vi.fn();
const toastSuccess = vi.fn();
vi.mock("@/app/(hrms)/performance/actions", () => ({ loadPosLinks: (...a: unknown[]) => loadPosLinks(...a), unlinkPosAccount: (...a: unknown[]) => unlinkPosAccount(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));

import { PosLinksDialog } from "@/components/performance/pos-links-dialog";

beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const CARLA: LinkedEmployee = {
  employeeId: 17, employeeNumber: "BR-EMP-0017", name: "Carla Mendoza", position: "Branch Cashier",
  accounts: [
    { linkId: 12, portalUserId: "u-2", name: "Carla Mendoza", branch: "Cainta branch", linkedByName: "Ada Okafor", linkedAt: "2026-11-20 10:15:00+00", linkReason: "New Portal account for the same person", current: true },
    { linkId: 11, portalUserId: "u-1", name: "Carla Mendoza", branch: "Cainta branch", linkedByName: "Jude Nitram", linkedAt: "2026-11-12 03:00:00+00", linkReason: null, current: false },
  ],
};
const LIZA: LinkedEmployee = { employeeId: 31, employeeNumber: "BR-EMP-0031", name: "Liza Navarro", position: "Branch Cashier", accounts: [
  { linkId: 21, portalUserId: "u-3", name: null, branch: null, linkedByName: "Ada Okafor", linkedAt: "2026-11-02 01:00:00+00", linkReason: null, current: true }] };

const open = async () => { await userEvent.click(screen.getByRole("button", { name: "Manage POS links" })); };

describe("the POS cashier links dialog", () => {
  it("reads nothing until it is opened, then lists each employee with all their accounts", async () => {
    loadPosLinks.mockResolvedValue({ ok: true, employees: [CARLA, LIZA] });
    render(<PosLinksDialog />);
    expect(loadPosLinks).not.toHaveBeenCalled();

    await open();
    const carla = await screen.findByRole("region", { name: "Carla Mendoza" });
    expect(loadPosLinks).toHaveBeenCalledTimes(1);
    expect(within(carla).getByText("BR-EMP-0017 · Branch Cashier · 2 POS accounts")).toBeTruthy();
    expect(within(carla).getByText("linked 20 Nov 2026 by Ada Okafor")).toBeTruthy();
    expect(within(carla).getByText("linked 12 Nov 2026 by Jude Nitram")).toBeTruthy();
    expect(within(carla).getByText("Current")).toBeTruthy();
    expect(within(carla).getByText("Earlier")).toBeTruthy();
    expect(within(carla).getAllByRole("button", { name: /^Unlink / })).toHaveLength(2);
    expect(within(carla).getByRole("button", { name: "Add account for Carla Mendoza" })).toBeTruthy();
    const liza = screen.getByRole("region", { name: "Liza Navarro" });
    expect(within(liza).getByText("Unnamed POS account")).toBeTruthy();
    expect(within(liza).getByText("No sales yet")).toBeTruthy();
    expect(screen.getByText("Linked 2")).toBeTruthy();
  });

  it("keeps Unlink account disabled until the reason is valid, with a note for Other, and changes nothing before it is pressed", async () => {
    loadPosLinks.mockResolvedValue({ ok: true, employees: [CARLA] });
    render(<PosLinksDialog />);
    await open();
    await userEvent.click((await screen.findAllByRole("button", { name: /^Unlink / }))[1]);

    expect(screen.getByText("Carla Mendoza (Cainta branch, linked 12 Nov 2026) from BR-EMP-0017")).toBeTruthy();
    expect(screen.getByText(/removes this account’s sales from the employee, including past months/)).toBeTruthy();
    const submit = screen.getByRole("button", { name: "Unlink account" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText(/Reason/), "Other");
    expect(submit.disabled).toBe(true);
    await userEvent.type(screen.getByLabelText(/Note/), "Left the company");
    expect(submit.disabled).toBe(false);
    expect(unlinkPosAccount).not.toHaveBeenCalled();
  });

  it("unlinks with the reason and note, then reads the list again and refreshes the page so Top sales follows", async () => {
    loadPosLinks.mockResolvedValueOnce({ ok: true, employees: [CARLA] }).mockResolvedValueOnce({ ok: true, employees: [{ ...CARLA, accounts: [CARLA.accounts[0]] }] });
    unlinkPosAccount.mockResolvedValue({ ok: true });
    render(<PosLinksDialog />);
    await open();
    await userEvent.click((await screen.findAllByRole("button", { name: /^Unlink / }))[1]);
    await userEvent.selectOptions(screen.getByLabelText(/Reason/), "Wrong person linked");
    await userEvent.click(screen.getByRole("button", { name: "Unlink account" }));

    await waitFor(() => expect(unlinkPosAccount).toHaveBeenCalledWith(11, "Wrong person linked", ""));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith("POS account unlinked");
    const carla = await screen.findByRole("region", { name: "Carla Mendoza" });
    await waitFor(() => expect(within(carla).getAllByRole("button", { name: /^Unlink / })).toHaveLength(1));
    expect(screen.queryByText("Unlink POS account")).toBeNull();
  });

  it("shows a refusal inside the prompt and leaves the list alone", async () => {
    loadPosLinks.mockResolvedValue({ ok: true, employees: [CARLA] });
    unlinkPosAccount.mockResolvedValue({ ok: false, error: "This account was already unlinked. Close the dialog to see the current list." });
    render(<PosLinksDialog />);
    await open();
    await userEvent.click((await screen.findAllByRole("button", { name: /^Unlink / }))[0]);
    await userEvent.selectOptions(screen.getByLabelText(/Reason/), "Linked to the wrong POS account");
    await userEvent.click(screen.getByRole("button", { name: "Unlink account" }));

    expect((await screen.findByRole("alert")).textContent).toContain("already unlinked");
    expect(refresh).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("says so when the list cannot be read, and reads again only on Try again", async () => {
    loadPosLinks.mockResolvedValueOnce({ ok: false, error: "Performance could not reach the Portal or database. Please try again in a moment." }).mockResolvedValueOnce({ ok: true, employees: [LIZA] });
    render(<PosLinksDialog />);
    await open();
    expect((await screen.findByRole("alert")).textContent).toContain("could not reach the Portal or database");
    expect(loadPosLinks).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Liza Navarro" })).toBeTruthy();
    expect(loadPosLinks).toHaveBeenCalledTimes(2);
  });
});
