// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LinkCandidate, LinkedEmployee, UnlinkedPosAccount } from "@/lib/performance-links";

const loadPosLinks = vi.fn();
const loadLinkCandidates = vi.fn();
const linkPosAccount = vi.fn();
const unlinkPosAccount = vi.fn();
const refresh = vi.fn();
const toastSuccess = vi.fn();
vi.mock("@/app/(hrms)/performance/actions", () => ({ loadPosLinks: (...a: unknown[]) => loadPosLinks(...a), unlinkPosAccount: (...a: unknown[]) => unlinkPosAccount(...a),
  loadLinkCandidates: (...a: unknown[]) => loadLinkCandidates(...a), linkPosAccount: (...a: unknown[]) => linkPosAccount(...a) }));
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
    loadPosLinks.mockResolvedValue({ ok: true, employees: [CARLA, LIZA], unlinked: [] });
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
    expect(screen.getByRole("button", { name: "Linked 2" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Needs linking 0" })).toBeTruthy();
  });

  it("keeps Unlink account disabled until the reason is valid, with a note for Other, and changes nothing before it is pressed", async () => {
    loadPosLinks.mockResolvedValue({ ok: true, employees: [CARLA], unlinked: [] });
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
    loadPosLinks.mockResolvedValueOnce({ ok: true, employees: [CARLA], unlinked: [] }).mockResolvedValueOnce({ ok: true, employees: [{ ...CARLA, accounts: [CARLA.accounts[0]] }], unlinked: [] });
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
    loadPosLinks.mockResolvedValue({ ok: true, employees: [CARLA], unlinked: [] });
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
    loadPosLinks.mockResolvedValueOnce({ ok: false, error: "Performance could not reach the Portal or database. Please try again in a moment." }).mockResolvedValueOnce({ ok: true, employees: [LIZA], unlinked: [] });
    render(<PosLinksDialog />);
    await open();
    expect((await screen.findByRole("alert")).textContent).toContain("could not reach the Portal or database");
    expect(loadPosLinks).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("region", { name: "Liza Navarro" })).toBeTruthy();
    expect(loadPosLinks).toHaveBeenCalledTimes(2);
  });
});

const MARIA: UnlinkedPosAccount = { portalUserId: "u-9", name: "Maria Santos", branch: "Cainta branch", orders: 38, netSales: 12480, from: "2026-11-03", to: "2026-11-20" };
const NOBODY: UnlinkedPosAccount = { portalUserId: "u-8", name: null, branch: "Taytay branch", orders: 1, netSales: 450.5, from: "2026-10-30", to: "2026-11-02" };
const candidate = (extra: Partial<LinkCandidate>): LinkCandidate => ({ employeeId: 1, employeeNumber: "BR-EMP-0001", name: "Someone", position: "Branch Cashier", branch: "Cainta branch", isCashier: true, accountCount: 0, ...extra });
const CANDIDATES = [
  candidate({ employeeId: 17, employeeNumber: "BR-EMP-0017", name: "Carla Mendoza", accountCount: 1 }),
  candidate({ employeeId: 52, employeeNumber: "BR-EMP-0052", name: "Carla Reyes", branch: "Taytay branch" }),
  candidate({ employeeId: 19, employeeNumber: "BR-EMP-0019", name: "Carlos Mendoza", position: "Production Staff", branch: "Main kitchen Antipolo", isCashier: false }),
];

describe("the Needs linking tab and the Link cashier dialog", () => {
  const openNeeds = async () => {
    loadPosLinks.mockResolvedValue({ ok: true, employees: [CARLA], unlinked: [MARIA, NOBODY] });
    loadLinkCandidates.mockResolvedValue({ ok: true, candidates: CANDIDATES });
    render(<PosLinksDialog />);
    await open();
    await screen.findByRole("button", { name: "Needs linking 2" });
  };

  it("opens on Needs linking when accounts need linking, listing each with branch, net sales and orders", async () => {
    await openNeeds();
    expect(screen.getByRole("button", { name: "Needs linking 2" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Maria Santos")).toBeTruthy();
    expect(screen.getByText("Portal account · Cainta branch")).toBeTruthy();
    expect(screen.getByText("₱12,480.00")).toBeTruthy();
    expect(screen.getByText("38 orders · November 2026")).toBeTruthy();
    // No directory name: the branch alone identifies the account. HRMS keeps no staff number.
    expect(screen.getByText("Unnamed POS account")).toBeTruthy();
    expect(screen.getByText("Portal account · Taytay branch")).toBeTruthy();
    expect(screen.getByText("1 order · October – November 2026")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Linked 1" }));
    expect(screen.getByRole("region", { name: "Carla Mendoza" })).toBeTruthy();
  });

  it("says every account is linked when none needs linking", async () => {
    loadPosLinks.mockResolvedValue({ ok: true, employees: [CARLA], unlinked: [] });
    render(<PosLinksDialog />);
    await open();
    expect(await screen.findByRole("region", { name: "Carla Mendoza" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Needs linking 0" }));
    expect(screen.getByText("Every POS account with sales is linked to an employee.")).toBeTruthy();
  });

  it("shows a non-cashier but cannot choose them, and tags an employee who already has an account", async () => {
    await openNeeds();
    await userEvent.click(screen.getByRole("button", { name: "Link Maria Santos" }));
    expect(await screen.findByText("2 POS accounts have sales but are not linked to an employee")).toBeTruthy();
    const options = await screen.findAllByRole("option");
    const carlos = options.find((o) => within(o).queryByText("Carlos Mendoza"))!;
    expect(within(carlos).getByText("Not a cashier position")).toBeTruthy();
    expect((within(carlos).getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(within(options.find((o) => within(o).queryByText("Carla Mendoza"))!).getByText("Has 1 POS account")).toBeTruthy();

    await userEvent.type(screen.getByRole("searchbox"), "reyes");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(within(screen.getByRole("option")).getByText(/Taytay branch/)).toBeTruthy();
  });

  it("asks for the reason only when the employee already has an account, and keeps Link cashier disabled until the form is valid", async () => {
    await openNeeds();
    await userEvent.click(screen.getByRole("button", { name: "Link Maria Santos" }));
    const submit = (await screen.findByRole("button", { name: "Link cashier" })) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    await userEvent.click(screen.getByRole("button", { name: /Carla Reyes/ }));
    expect(screen.queryByLabelText(/Reason/)).toBeNull();
    expect(submit.disabled).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: /Carla Mendoza/ }));
    expect(screen.getByText(/Needed because Carla Mendoza already has a POS account/)).toBeTruthy();
    expect(submit.disabled).toBe(true);
    await userEvent.selectOptions(screen.getByLabelText(/Reason/), "New Portal account for the same person");
    expect(submit.disabled).toBe(false);
    expect(linkPosAccount).not.toHaveBeenCalled();
  });

  it("links the account, then reads the list again and refreshes the page", async () => {
    await openNeeds();
    linkPosAccount.mockResolvedValue({ ok: true });
    await userEvent.click(screen.getByRole("button", { name: "Link Maria Santos" }));
    await userEvent.click(await screen.findByRole("button", { name: /Carla Mendoza/ }));
    await userEvent.selectOptions(screen.getByLabelText(/Reason/), "New Portal account for the same person");
    await userEvent.click(screen.getByRole("button", { name: "Link cashier" }));

    await waitFor(() => expect(linkPosAccount).toHaveBeenCalledWith(17, "u-9", "New Portal account for the same person"));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalledWith("POS account linked");
    expect(loadPosLinks).toHaveBeenCalledTimes(2);
  });

  it("sends no reason for a first account, and shows a refusal inside the dialog", async () => {
    await openNeeds();
    linkPosAccount.mockResolvedValue({ ok: false, error: "This POS account is already linked to an employee. Close the dialog to see the current list." });
    await userEvent.click(screen.getByRole("button", { name: "Link Maria Santos" }));
    await userEvent.click(await screen.findByRole("button", { name: /Carla Reyes/ }));
    await userEvent.click(screen.getByRole("button", { name: "Link cashier" }));

    await waitFor(() => expect(linkPosAccount).toHaveBeenCalledWith(52, "u-9", ""));
    expect((await screen.findByRole("alert")).textContent).toContain("already linked to an employee");
    expect(refresh).not.toHaveBeenCalled();
  });
});
