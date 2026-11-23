// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PosLinksDialog } from "@/components/performance/pos-links-dialog";
import { NEW_ACCOUNT_REASON, type LinkCandidate, type PosAccountNeedingLink } from "@/lib/performance";

const actions = vi.hoisted(() => ({ loadPosLinks: vi.fn(), linkPosCashier: vi.fn() }));
vi.mock("@/app/(hrms)/performance/actions", () => actions);
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const ROBERTO: PosAccountNeedingLink = { portalUserId: "u-rob", name: "Roberto Dela Cruz", staffNumber: "1004", branch: "Cainta branch", orders: 120, netSales: 64210, from: "2026-11-03", to: "2026-11-28" };
const NAMELESS: PosAccountNeedingLink = { portalUserId: "u-liz", name: null, staffNumber: "1012", branch: "Taytay branch", orders: 38, netSales: 12480, from: "2026-10-12", to: "2026-11-20" };
const person = (id: number, name: string, extra: Partial<LinkCandidate> = {}): LinkCandidate => ({ id, employeeNumber: `BR-EMP-00${id}`, name, position: "Branch Cashier", branch: "Cainta branch", cashier: true, accounts: 0, ...extra });
const CANDIDATES = [person(17, "Carla Mendoza", { accounts: 1 }), person(52, "Carla Reyes", { branch: "Taytay branch" }), person(19, "Carlos Mendoza", { position: "Production Staff", branch: "Main kitchen Antipolo", cashier: false })];

beforeEach(() => {
  actions.loadPosLinks.mockResolvedValue({ ok: true, accounts: [ROBERTO, NAMELESS], candidates: CANDIDATES });
  actions.linkPosCashier.mockResolvedValue({ ok: true });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const trigger = <button type="button">Link accounts</button>;
const openList = async () => {
  render(<PosLinksDialog>{trigger}</PosLinksDialog>);
  await userEvent.click(screen.getByRole("button", { name: "Link accounts" }));
  await screen.findByText("Roberto Dela Cruz");
};
const dialogs = () => screen.getAllByRole("dialog");
const linkDialog = () => dialogs().at(-1)!;
const openLink = async (name: string) => { await userEvent.click(screen.getByRole("button", { name: `Link ${name}` })); await screen.findByRole("heading", { name: "Link POS cashier" }); };
const linkButton = () => within(linkDialog()).getByRole("button", { name: "Link cashier" }) as HTMLButtonElement;
/** The employee search box: the reason field is a native select, which is also a combobox, so this one is found by its placeholder. */
const searchBox = () => within(linkDialog()).getByPlaceholderText("Search by name, number or position");
const pick = async (search: string, option: RegExp) => {
  await userEvent.click(searchBox());
  await userEvent.clear(searchBox());
  if (search) await userEvent.type(searchBox(), search);
  await userEvent.click(within(linkDialog()).getByRole("option", { name: option }));
};

describe("the Needs linking tab", () => {
  it("reads only when it is opened, then lists each account by name with branch, staff number, net sales and orders", async () => {
    render(<PosLinksDialog>{trigger}</PosLinksDialog>);
    expect(actions.loadPosLinks).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Link accounts" }));
    await screen.findByText("Roberto Dela Cruz");

    expect(actions.loadPosLinks).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "POS cashier links" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Needs linking 2" })).toBeTruthy();
    expect(screen.getByText("Portal account · Cainta branch · staff no. 1004")).toBeTruthy();
    expect(screen.getByText("₱64,210.00")).toBeTruthy();
    expect(screen.getByText("120 orders")).toBeTruthy();
    expect(screen.getByText("2 accounts")).toBeTruthy();
  });

  it("shows the staff number and branch only when the Portal has no name for the account", async () => {
    await openList();

    expect(screen.getByText("Staff no. 1012")).toBeTruthy();
    expect(screen.getByText("Taytay branch")).toBeTruthy();
    expect(screen.queryByText(/Portal account · Taytay/)).toBeNull();
    expect(screen.getByRole("button", { name: "Link Staff no. 1012" })).toBeTruthy();
  });

  it("says so when every account is linked, and shows a loading state first", async () => {
    let finish!: (value: unknown) => void;
    actions.loadPosLinks.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    render(<PosLinksDialog>{trigger}</PosLinksDialog>);
    await userEvent.click(screen.getByRole("button", { name: "Link accounts" }));
    expect(screen.getByRole("status", { name: "Loading POS accounts" })).toBeTruthy();

    finish({ ok: true, accounts: [], candidates: [] });
    expect(await screen.findByText("Every POS account with sales is linked to an employee.")).toBeTruthy();
  });

  it("shows an error with Try again when it cannot read, and reads again only on that press", async () => {
    actions.loadPosLinks.mockResolvedValueOnce({ ok: false, error: "Performance could not reach the Portal or database. Please try again in a moment." });
    render(<PosLinksDialog>{trigger}</PosLinksDialog>);
    await userEvent.click(screen.getByRole("button", { name: "Link accounts" }));
    expect((await screen.findByRole("alert")).textContent).toContain("could not reach the Portal or database");
    expect(actions.loadPosLinks).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Roberto Dela Cruz");
    expect(actions.loadPosLinks).toHaveBeenCalledTimes(2);
  });
});

describe("the Link POS cashier dialog", () => {
  it("shows the POS account and what it covers", async () => {
    await openList();
    await openLink("Roberto Dela Cruz");

    expect(within(linkDialog()).getByText("2 POS accounts have sales but are not linked to an employee")).toBeTruthy();
    expect(within(linkDialog()).getByText("Roberto Dela Cruz")).toBeTruthy();
    expect(within(linkDialog()).getByText("Portal account · Cainta branch · staff no. 1004")).toBeTruthy();
    expect(within(linkDialog()).getByText("₱64,210.00")).toBeTruthy();
    expect(within(linkDialog()).getByText("120 orders · November 2026")).toBeTruthy();
    expect(screen.getByText("Not linked yet")).toBeTruthy();
    expect(linkButton().disabled).toBe(true);
  });

  it("shows an employee who is not a cashier, greyed with Not a cashier position, and will not let them be chosen", async () => {
    await openList();
    await openLink("Roberto Dela Cruz");
    await userEvent.click(searchBox());
    await userEvent.type(searchBox(), "Carlos");

    const option = within(linkDialog()).getByRole("option", { name: /Carlos Mendoza/ });
    expect(option.getAttribute("aria-disabled")).toBe("true");
    expect(within(option).getByText("Not a cashier position")).toBeTruthy();
    await userEvent.click(option);

    expect(option.getAttribute("aria-selected")).toBe("false");
    expect(linkButton().disabled).toBe(true);
    await userEvent.click(linkButton());
    expect(actions.linkPosCashier).not.toHaveBeenCalled();
  });

  it("links a cashier with no account yet without asking for a reason", async () => {
    await openList();
    await openLink("Roberto Dela Cruz");
    await pick("reyes", /Carla Reyes/);

    expect(within(linkDialog()).queryByLabelText(/^Reason/)).toBeNull();
    expect(linkButton().disabled).toBe(false);
    await userEvent.click(linkButton());

    await waitFor(() => expect(actions.linkPosCashier).toHaveBeenCalledWith("u-rob", 52, null));
    expect(toast.success).toHaveBeenCalledWith("POS account linked to Carla Reyes");
  });

  it("marks an employee who already has an account, and then requires the reason before Link cashier is enabled", async () => {
    await openList();
    await openLink("Roberto Dela Cruz");
    await userEvent.click(searchBox());
    await userEvent.type(searchBox(), "carla");
    expect(within(within(linkDialog()).getByRole("option", { name: /Carla Mendoza/ })).getByText("Has 1 POS account")).toBeTruthy();
    expect(within(linkDialog()).queryByLabelText(/^Reason/)).toBeNull();

    await userEvent.click(within(linkDialog()).getByRole("option", { name: /Carla Mendoza/ }));
    const reason = within(linkDialog()).getByLabelText(/^Reason/) as HTMLSelectElement;
    expect(reason.value).toBe("");
    expect(within(linkDialog()).getByText(/Needed because Carla Mendoza already has a POS account/)).toBeTruthy();
    expect(linkButton().disabled).toBe(true);

    await userEvent.selectOptions(reason, NEW_ACCOUNT_REASON);
    expect(linkButton().disabled).toBe(false);
    await userEvent.click(linkButton());
    await waitFor(() => expect(actions.linkPosCashier).toHaveBeenCalledWith("u-rob", 17, NEW_ACCOUNT_REASON));
  });

  it("drops the reason when the choice changes to someone with no account", async () => {
    await openList();
    await openLink("Roberto Dela Cruz");
    await pick("carla", /Carla Mendoza/);
    await userEvent.selectOptions(within(linkDialog()).getByLabelText(/^Reason/), NEW_ACCOUNT_REASON);
    await pick("", /Carla Reyes/);

    expect(within(linkDialog()).queryByLabelText(/^Reason/)).toBeNull();
    await userEvent.click(linkButton());
    await waitFor(() => expect(actions.linkPosCashier).toHaveBeenCalledWith("u-rob", 52, null));
  });

  it("shows the server's refusal and stays open, linking nothing", async () => {
    actions.linkPosCashier.mockResolvedValueOnce({ ok: false, error: "That POS account is already linked to an employee." });
    await openList();
    await openLink("Roberto Dela Cruz");
    await pick("reyes", /Carla Reyes/);
    await userEvent.click(linkButton());

    expect((await within(linkDialog()).findByRole("alert")).textContent).toBe("That POS account is already linked to an employee.");
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Link POS cashier" })).toBeTruthy();
  });

  it("closes after linking and reads the list again, so the account leaves Needs linking", async () => {
    actions.loadPosLinks.mockResolvedValueOnce({ ok: true, accounts: [ROBERTO, NAMELESS], candidates: CANDIDATES }).mockResolvedValueOnce({ ok: true, accounts: [NAMELESS], candidates: CANDIDATES });
    await openList();
    await openLink("Roberto Dela Cruz");
    await pick("reyes", /Carla Reyes/);
    await userEvent.click(linkButton());

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Link POS cashier" })).toBeNull());
    await waitFor(() => expect(screen.queryByText("Roberto Dela Cruz")).toBeNull());
    expect(actions.loadPosLinks).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("tab", { name: "Needs linking 1" })).toBeTruthy();
  });

  it("links nothing on Cancel", async () => {
    await openList();
    await openLink("Roberto Dela Cruz");
    await pick("reyes", /Carla Reyes/);
    await userEvent.click(within(linkDialog()).getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("heading", { name: "Link POS cashier" })).toBeNull());
    expect(actions.linkPosCashier).not.toHaveBeenCalled();
  });
});
