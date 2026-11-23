// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PosLinksDialog } from "@/components/performance/pos-links-dialog";
import { NEW_ACCOUNT_REASON, type LinkedEmployee, type PosAccountNeedingLink } from "@/lib/performance";

const actions = vi.hoisted(() => ({ loadPosLinks: vi.fn(), linkPosCashier: vi.fn(), unlinkPosAccount: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const FIRST = { linkId: 11, portalUserId: "u-1", name: "Carla Mendoza", branch: "Cainta branch", linkedByName: "Ada Okafor", linkedAt: "2026-11-12 03:00:00+00", linkReason: null, current: true };
const CARLA: LinkedEmployee = { employeeId: 17, employeeNumber: "BR-EMP-0017", name: "Carla Mendoza", position: "Branch Cashier", accounts: [FIRST] };
const LIZA: LinkedEmployee = { employeeId: 31, employeeNumber: "BR-EMP-0031", name: "Liza Navarro", position: "Branch Cashier", accounts: [{ ...FIRST, linkId: 21, portalUserId: "u-3", name: "Liza Navarro" }] };
const NEW_PORTAL: PosAccountNeedingLink = { portalUserId: "u-2", name: "Carla M. (new)", staffNumber: "1021", branch: "Cainta branch", orders: 38, netSales: 12480, from: "2026-11-15", to: "2026-11-28" };
const NAMELESS: PosAccountNeedingLink = { portalUserId: "u-liz", name: null, staffNumber: "1012", branch: "Taytay branch", orders: 5, netSales: 900, from: "2026-11-02", to: "2026-11-09" };
const read = (employees: LinkedEmployee[], accounts: PosAccountNeedingLink[]) => ({ ok: true, employees, accounts, candidates: [] });

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  actions.loadPosLinks.mockResolvedValue(read([CARLA, LIZA], [NEW_PORTAL, NAMELESS]));
  actions.linkPosCashier.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const dialogs = () => screen.getAllByRole("dialog");
const addDialog = () => dialogs().at(-1)!;
const addButton = () => within(addDialog()).getByRole("button", { name: "Add account" }) as HTMLButtonElement;
const openAdd = async (name = "Carla Mendoza") => {
  render(<PosLinksDialog />);
  await userEvent.click(screen.getByRole("button", { name: "Manage POS links" }));
  await userEvent.click(await screen.findByRole("tab", { name: /^Linked/ }));
  await userEvent.click(await screen.findByRole("button", { name: `Add account for ${name}` }));
  await screen.findByRole("heading", { name: "Add POS account" });
};
/** The accounts listbox: the reason select's own options are also "option"s, so the accounts are found by their list. */
const accountList = () => within(addDialog()).getByRole("listbox", { name: "POS accounts not linked to anyone" });
const searchBox = () => within(addDialog()).getByPlaceholderText("Search by name, staff number or branch");
const choose = (name: RegExp) => userEvent.click(within(accountList()).getByRole("option", { name }));

describe("Add account", () => {
  it("is enabled on each employee in the Linked tab, and opens a dialog showing the employee read-only with their current account", async () => {
    await openAdd();

    expect(within(addDialog()).getByText("Another POS account for Carla Mendoza")).toBeTruthy();
    expect(within(addDialog()).getByText("BR-EMP-0017 · Branch Cashier")).toBeTruthy();
    const current = within(within(addDialog()).getByRole("list", { name: "Current accounts" })).getByRole("listitem");
    expect(current.textContent).toContain("Carla Mendoza · Cainta branch · linked 12 Nov 2026 by Ada Okafor · Current");
    expect(within(addDialog()).queryByRole("textbox", { name: /Employee/ })).toBeNull();
    expect(screen.getByText("Not added yet")).toBeTruthy();
  });

  it("lists only POS accounts that are not linked to anyone, with branch, staff number and figures", async () => {
    await openAdd();

    const options = within(accountList()).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual([
      "Carla M. (new)Portal account · Cainta branch · staff no. 1021₱12,480.0038 orders · November 2026",
      "Staff no. 1012Taytay branch₱900.005 orders · November 2026"]);
    expect(within(addDialog()).queryByText("Liza Navarro")).toBeNull();
  });

  it("searches the accounts, and says so when none matches", async () => {
    await openAdd();
    await userEvent.type(searchBox(), "taytay");
    expect(within(accountList()).getAllByRole("option")).toHaveLength(1);

    await userEvent.clear(searchBox());
    await userEvent.type(searchBox(), "zzz");
    expect(within(addDialog()).getByText("No POS account matches.")).toBeTruthy();
  });

  it("says so when no POS account is waiting to be linked", async () => {
    actions.loadPosLinks.mockResolvedValue(read([CARLA], []));
    await openAdd();

    expect(within(addDialog()).getByText("No POS account with sales is waiting to be linked.")).toBeTruthy();
    expect(addButton().disabled).toBe(true);
  });

  it("requires the reason as well as the account before Add account is enabled", async () => {
    await openAdd();
    expect(addButton().disabled).toBe(true);

    await choose(/Carla M\. \(new\)/);
    expect(addButton().disabled).toBe(true);
    const reason = within(addDialog()).getByLabelText(/^Reason/) as HTMLSelectElement;
    expect(reason.value).toBe("");
    await userEvent.click(addButton());
    expect(actions.linkPosCashier).not.toHaveBeenCalled();

    await userEvent.selectOptions(reason, NEW_ACCOUNT_REASON);
    expect(addButton().disabled).toBe(false);
  });

  it("adds the account with the reason, then the employee's accounts and totals update", async () => {
    const both: LinkedEmployee = { ...CARLA, accounts: [{ ...FIRST, linkId: 12, portalUserId: "u-2", name: "Carla M. (new)", current: true, linkedAt: "2026-11-23 01:00:00+00" }, { ...FIRST, current: false }] };
    actions.loadPosLinks.mockResolvedValueOnce(read([CARLA, LIZA], [NEW_PORTAL, NAMELESS])).mockResolvedValueOnce(read([both, LIZA], [NAMELESS]));
    await openAdd();
    await choose(/Carla M\. \(new\)/);
    await userEvent.selectOptions(within(addDialog()).getByLabelText(/^Reason/), NEW_ACCOUNT_REASON);
    await userEvent.click(addButton());

    await waitFor(() => expect(actions.linkPosCashier).toHaveBeenCalledWith("u-2", 17, NEW_ACCOUNT_REASON));
    expect(toast.success).toHaveBeenCalledWith("POS account added for Carla Mendoza");
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add POS account" })).toBeNull());
    const carla = await screen.findByRole("region", { name: "Carla Mendoza" });
    expect(await within(carla).findByText("BR-EMP-0017 · Branch Cashier · 2 POS accounts")).toBeTruthy();
    expect(actions.loadPosLinks).toHaveBeenCalledTimes(2);
    expect(router.refresh).toHaveBeenCalled();
    expect(screen.getByRole("tab", { name: "Needs linking 1" })).toBeTruthy();
  });

  it("shows the server's refusal and stays open, adding nothing", async () => {
    actions.linkPosCashier.mockResolvedValueOnce({ ok: false, error: "That POS account is already linked to an employee." });
    await openAdd();
    await choose(/Carla M\. \(new\)/);
    await userEvent.selectOptions(within(addDialog()).getByLabelText(/^Reason/), NEW_ACCOUNT_REASON);
    await userEvent.click(addButton());

    expect((await within(addDialog()).findByRole("alert")).textContent).toBe("That POS account is already linked to an employee.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Add POS account" })).toBeTruthy();
  });

  it("adds nothing on Cancel", async () => {
    await openAdd();
    await choose(/Carla M\. \(new\)/);
    await userEvent.click(within(addDialog()).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Add POS account" })).toBeNull());
    expect(actions.linkPosCashier).not.toHaveBeenCalled();
  });

  it("opens for the employee whose Add account was pressed", async () => {
    await openAdd("Liza Navarro");

    expect(within(addDialog()).getByText("Another POS account for Liza Navarro")).toBeTruthy();
    expect(within(addDialog()).getByText("BR-EMP-0031 · Branch Cashier")).toBeTruthy();
  });
});
