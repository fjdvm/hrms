import { describe, expect, it } from "vitest";
import { NEW_ACCOUNT_REASON } from "@/lib/performance";
import type { LinkCandidate, PosAccountNeedingLink } from "@/lib/performance-pos-accounts";
import { PICKER_LIMIT, accountsTag, canChoose, checkAddForm, checkLinkForm, disabledReason, filterAccounts, filterCandidates, monthsCovered } from "@/lib/performance-pos-links-form";

const person = (id: number, name: string, extra: Partial<LinkCandidate> = {}): LinkCandidate => ({ id, employeeNumber: `BR-EMP-00${id}`, name, position: "Branch Cashier", branch: "Cainta branch", cashier: true, accounts: 0, ...extra });
const CARLA = person(17, "Carla Mendoza", { accounts: 1 });
const REYES = person(52, "Carla Reyes", { branch: "Taytay branch" });
const CARLOS = person(19, "Carlos Mendoza", { position: "Production Staff", branch: "Main kitchen Antipolo", cashier: false });
const ALL = [CARLA, REYES, CARLOS];

describe("the employee picker", () => {
  it("finds Employees by name, number, position or branch, ignoring case and extra spaces", () => {
    expect(filterCandidates(ALL, "carla").map((c) => c.name)).toEqual(["Carla Mendoza", "Carla Reyes"]);
    expect(filterCandidates(ALL, "  BR-EMP-0019 ").map((c) => c.name)).toEqual(["Carlos Mendoza"]);
    expect(filterCandidates(ALL, "production   staff").map((c) => c.name)).toEqual(["Carlos Mendoza"]);
    expect(filterCandidates(ALL, "taytay").map((c) => c.name)).toEqual(["Carla Reyes"]);
    expect(filterCandidates(ALL, "zzz")).toEqual([]);
    expect(filterCandidates(ALL, "")).toEqual(ALL);
  });

  it("lists at most a handful at once, in the order given", () => {
    const many = Array.from({ length: 20 }, (_, i) => person(i + 1, `Employee ${i + 1}`));

    expect(filterCandidates(many, "")).toHaveLength(PICKER_LIMIT);
    expect(filterCandidates(many, "employee")[0].name).toBe("Employee 1");
  });

  it("shows a non-cashier but cannot choose them, and says why", () => {
    expect(canChoose(CARLA)).toBe(true);
    expect(canChoose(CARLOS)).toBe(false);
    expect(disabledReason(CARLOS)).toBe("Not a cashier position");
    expect(disabledReason(CARLA)).toBeNull();
  });

  it("tags an Employee who already has POS accounts", () => {
    expect(accountsTag(CARLA)).toBe("Has 1 POS account");
    expect(accountsTag({ ...CARLA, accounts: 2 })).toBe("Has 2 POS accounts");
    expect(accountsTag(REYES)).toBeNull();
  });
});

describe("the Link POS cashier form", () => {
  it("needs a cashier to be chosen", () => {
    expect(checkLinkForm(null, "")).toMatchObject({ reasonNeeded: false, canSubmit: false, reason: null });
    expect(checkLinkForm(CARLOS, "")).toMatchObject({ canSubmit: false });
    expect(checkLinkForm(REYES, "")).toEqual({ reasonNeeded: false, reasonError: null, canSubmit: true, reason: null });
  });

  it("asks for the reason only when the Employee already has an account, and needs it before linking", () => {
    expect(checkLinkForm(CARLA, "")).toEqual({ reasonNeeded: true, reasonError: "Choose the reason.", canSubmit: false, reason: null });
    expect(checkLinkForm(CARLA, "Whatever")).toMatchObject({ canSubmit: false, reason: null });
    expect(checkLinkForm(CARLA, NEW_ACCOUNT_REASON)).toEqual({ reasonNeeded: true, reasonError: null, canSubmit: true, reason: NEW_ACCOUNT_REASON });
  });

  it("sends no reason for a first account, even if one was picked for someone else earlier", () => {
    expect(checkLinkForm(REYES, NEW_ACCOUNT_REASON).reason).toBeNull();
  });
});

describe("the months an account's sales cover", () => {
  it("names one month, a span in a year, or a span across years", () => {
    expect(monthsCovered("2026-11-03", "2026-11-30")).toBe("November 2026");
    expect(monthsCovered("2026-10-03", "2026-11-30")).toBe("October – November 2026");
    expect(monthsCovered("2026-12-03", "2027-01-05")).toBe("December 2026 – January 2027");
  });
});

const account = (id: string, name: string | null, extra: Partial<PosAccountNeedingLink> = {}): PosAccountNeedingLink => ({ portalUserId: id, name, staffNumber: "1004", branch: "Cainta branch", orders: 10, netSales: 1000, from: "2026-11-03", to: "2026-11-28", ...extra });
const ROBERTO = account("u-rob", "Roberto Dela Cruz");
const NAMELESS = account("u-liz", null, { staffNumber: "1012", branch: "Taytay branch" });

describe("the Add account picker", () => {
  it("finds POS accounts by the Portal's name, staff number or branch, ignoring case", () => {
    const all = [ROBERTO, NAMELESS];

    expect(filterAccounts(all, "roberto").map((a) => a.portalUserId)).toEqual(["u-rob"]);
    expect(filterAccounts(all, " 1012 ").map((a) => a.portalUserId)).toEqual(["u-liz"]);
    expect(filterAccounts(all, "TAYTAY").map((a) => a.portalUserId)).toEqual(["u-liz"]);
    expect(filterAccounts(all, "zzz")).toEqual([]);
    expect(filterAccounts(all, "")).toEqual(all);
  });

  it("lists at most a handful at once", () => {
    const many = Array.from({ length: 20 }, (_, i) => account(`u-${i}`, `Account ${i}`));

    expect(filterAccounts(many, "")).toHaveLength(PICKER_LIMIT);
  });
});

describe("the Add account form", () => {
  it("needs a POS account and the reason, always, because the Employee already has an account", () => {
    expect(checkAddForm(null, "")).toEqual({ reasonError: "Choose the reason.", reason: null, canSubmit: false });
    expect(checkAddForm(ROBERTO, "")).toEqual({ reasonError: "Choose the reason.", reason: null, canSubmit: false });
    expect(checkAddForm(ROBERTO, "Whatever")).toMatchObject({ canSubmit: false, reason: null });
    expect(checkAddForm(null, NEW_ACCOUNT_REASON)).toMatchObject({ canSubmit: false });
    expect(checkAddForm(ROBERTO, NEW_ACCOUNT_REASON)).toEqual({ reasonError: null, reason: NEW_ACCOUNT_REASON, canSubmit: true });
  });
});
