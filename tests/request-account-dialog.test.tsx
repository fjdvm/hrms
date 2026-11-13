// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ load: vi.fn(), send: vi.fn(), refresh: vi.fn(), toast: vi.fn() }));
vi.mock("@/app/(hrms)/employee-onboarding/actions", () => ({ loadAccountRequestOptions: mocks.load, sendAccountRequest: mocks.send }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.toast } }));

import { RequestAccountDialog } from "@/components/employees/request-account-dialog";

const employee = { id: 7, name: "Ellaine Torres", initials: "ET", employeeNumber: "BR-EMP-0058", position: "Branch Cashier", branch: "Cainta branch", startDate: "2020-11-10", workEmail: "ellaine.torres@brenraphaels.ph" };
const options = {
  roles: [{ id: "r1", name: "Branch Cashier", moduleIds: ["m1", "m3"] }, { id: "r2", name: "HRMS Manager", moduleIds: ["m2"] }],
  systems: [
    { id: "s1", name: "HRMS", modules: [{ id: "m1", name: "Applications" }, { id: "m2", name: "Employee Information" }] },
    { id: "s2", name: "POS", modules: [{ id: "m3", name: "Sales" }] },
  ],
};

beforeEach(() => {
  mocks.load.mockResolvedValue({ ok: true, options });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

async function open() {
  render(<RequestAccountDialog employee={employee} />);
  await userEvent.click(screen.getByRole("button", { name: /Request user account/ }));
  await screen.findByLabelText(/Work email/);
}
const box = (name: string) => screen.getByRole("checkbox", { name }) as HTMLElement;

it("shows the employee summary, prefilled work email with hint, and the started note, with no Branch access field", async () => {
  await open();
  expect(screen.getByText(/BR-EMP-0058 · Branch Cashier · Cainta branch · starts 10 Nov 2020/)).toBeTruthy();
  expect((screen.getByLabelText(/Work email/) as HTMLInputElement).value).toBe("ellaine.torres@brenraphaels.ph");
  expect(screen.getByText(/login details will be sent here and to Ellaine’s personal email/)).toBeTruthy();
  expect((screen.getByLabelText(/Needs access from/) as HTMLInputElement).value).toBe("2020-11-10");
  expect(screen.getByText(/already started/)).toBeTruthy();
  expect(screen.queryByText(/Branch access/)).toBeNull();
});

it("groups Modules by system and prefills them from the chosen Role, still editable", async () => {
  await open();
  expect(within(screen.getByRole("group", { name: "HRMS" })).getByRole("checkbox", { name: "Applications" })).toBeTruthy();
  expect(within(screen.getByRole("group", { name: "POS" })).getByRole("checkbox", { name: "Sales" })).toBeTruthy();
  await userEvent.selectOptions(screen.getByLabelText(/^Role/), "r1");
  expect(box("Applications").getAttribute("aria-checked")).toBe("true");
  expect(box("Sales").getAttribute("aria-checked")).toBe("true");
  expect(box("Employee Information").getAttribute("aria-checked")).toBe("false");
  await userEvent.click(box("Sales"));
  await userEvent.click(box("Employee Information"));
  expect(box("Sales").getAttribute("aria-checked")).toBe("false");
  expect(box("Employee Information").getAttribute("aria-checked")).toBe("true");
});

it("sends the request, shows a toast, closes and refreshes the page so the row reads Requested", async () => {
  mocks.send.mockResolvedValue({ ok: true, reference: "RQ-0001" });
  await open();
  await userEvent.selectOptions(screen.getByLabelText(/^Role/), "r1");
  await userEvent.type(screen.getByLabelText(/Note to admin/), "Please prioritize.");
  await userEvent.click(screen.getByRole("button", { name: "Send to admin portal" }));
  expect(mocks.send).toHaveBeenCalledWith(7, { workEmail: "ellaine.torres@brenraphaels.ph", roleId: "r1", moduleIds: ["m1", "m3"], neededFrom: "2020-11-10", note: "Please prioritize." });
  expect(mocks.toast).toHaveBeenCalledWith("Account request for Ellaine Torres sent to the admin portal");
  expect(mocks.refresh).toHaveBeenCalled();
  expect(screen.queryByLabelText(/Work email/)).toBeNull();
});

it("shows validation problems inline and sends nothing when the Role and Modules are missing", async () => {
  await open();
  await userEvent.click(screen.getByRole("button", { name: "Send to admin portal" }));
  expect(screen.getByText("Choose a Portal Role.")).toBeTruthy();
  expect(screen.getByText("Choose at least one Module.")).toBeTruthy();
  expect(mocks.send).not.toHaveBeenCalled();
});

it("shows a taken work email on the field and keeps the dialog open", async () => {
  mocks.send.mockResolvedValue({ ok: false, error: "That work email is already in use.", problems: { workEmail: "This work email is already used by a Portal user or an active request." } });
  await open();
  await userEvent.selectOptions(screen.getByLabelText(/^Role/), "r2");
  await userEvent.click(screen.getByRole("button", { name: "Send to admin portal" }));
  expect((await screen.findAllByRole("alert")).map(a => a.textContent).join(" ")).toContain("already used by a Portal user");
  expect(screen.getByLabelText(/Work email/).getAttribute("aria-invalid")).toBe("true");
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("tells the requester when the Portal is unavailable and does not claim it was sent", async () => {
  mocks.send.mockResolvedValue({ ok: false, error: "HRMS could not reach the Portal. Nothing was sent. Please try again in a moment.", problems: {} });
  await open();
  await userEvent.selectOptions(screen.getByLabelText(/^Role/), "r2");
  await userEvent.click(screen.getByRole("button", { name: "Send to admin portal" }));
  expect((await screen.findByText(/Nothing was sent/)).getAttribute("role")).toBe("alert");
  expect(mocks.toast).not.toHaveBeenCalled();
});

it("explains when the Portal's Roles cannot be loaded", async () => {
  mocks.load.mockResolvedValue({ ok: false, error: "HRMS could not reach the Portal. Nothing was sent. Please try again in a moment." });
  render(<RequestAccountDialog employee={employee} />);
  await userEvent.click(screen.getByRole("button", { name: /Request user account/ }));
  expect((await screen.findByRole("alert")).textContent).toContain("could not reach the Portal");
});
