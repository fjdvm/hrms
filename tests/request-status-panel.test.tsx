// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ load: vi.fn(), remind: vi.fn(), cancel: vi.fn(), refresh: vi.fn(), success: vi.fn() }));
vi.mock("@/app/(hrms)/employee-onboarding/actions", () => ({ loadAccountRequestStatus: mocks.load, remindAdmin: mocks.remind, cancelRequest: mocks.cancel }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));

import { RequestStatusPanel } from "@/components/employees/request-status-panel";
import { LIVE_EVENT } from "@/lib/live-events";

const employee = { id: 3, name: "Rafael Santiago", requestReference: "RQ-0033" };
const base = {
  reference: "RQ-0033", status: "seen", employee: { name: "Rafael Santiago", employeeNumber: "BR-EMP-0057" }, workEmail: "rafael.santiago@brenraphaels.ph",
  role: "Delivery Coordinator", neededFrom: "2026-11-03", requestedBy: "Jude Nitram", requestedAt: "2026-11-12T02:02:00Z", startDate: "2026-11-03",
  modules: [{ system: "HRMS", names: ["Applications", "Offers"] }, { system: "POS", names: ["Sales"] }],
  steps: [
    { key: "requested", label: "Sent to admin portal", done: true, at: "2026-11-12T02:02:00Z", actor: "Jude Nitram" },
    { key: "seen", label: "Seen by admin", done: true, at: "2026-11-12T06:40:00Z", actor: "IT Admin" },
    { key: "account_created", label: "Account created", done: false, at: null, actor: null },
    { key: "login_sent", label: "Login details sent to Rafael", done: false, at: null, actor: null },
  ],
  overdue: true, daysSinceSeen: 1, lastReminderAt: null,
};
const status = (over: Record<string, unknown> = {}) => ({ ...base, ...over });

beforeEach(() => { mocks.load.mockResolvedValue({ ok: true, status: status() }); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const open = async () => {
  render(<RequestStatusPanel employee={employee} />);
  await userEvent.click(screen.getByRole("button", { name: "View request" }));
  await screen.findByText("Modules requested");
};

it("shows the request: employee, work email, Role, needs access from, requested by and the Modules by system", async () => {
  await open();
  expect(screen.getByText("User account request")).toBeTruthy();
  expect(screen.getByText(/RQ-0033 · Rafael Santiago/)).toBeTruthy();
  expect(screen.getByText("Rafael Santiago · BR-EMP-0057")).toBeTruthy();
  expect(screen.getByText("rafael.santiago@brenraphaels.ph")).toBeTruthy();
  expect(screen.getByText("Delivery Coordinator")).toBeTruthy();
  expect(screen.getByText("3 Nov 2026")).toBeTruthy();
  expect(screen.getByText("Jude Nitram · 12 Nov, 10:02 AM")).toBeTruthy();
  expect(screen.getByText(/Applications, Offers/)).toBeTruthy();
  expect(screen.getByText(/Sales/)).toBeTruthy();
  expect(screen.queryByText(/Branch access/)).toBeNull();
  expect(mocks.load).toHaveBeenCalledWith(3);
});

it("lists the four progress steps with time and actor, and marks the next one as current", async () => {
  await open();
  const steps = within(screen.getByRole("list", { name: "Progress" })).getAllByRole("listitem");
  expect(steps.map((s) => s.getAttribute("data-state"))).toEqual(["done", "done", "current", "waiting"]);
  expect(steps[0].textContent).toContain("12 Nov, 10:02 AM · by Jude Nitram");
  expect(steps[1].textContent).toContain("12 Nov, 2:40 PM · IT Admin");
  expect(steps[2].textContent).toContain("Waiting for admin");
  expect(steps[3].textContent).toContain("Login details sent to Rafael");
});

it("shows the amber warning only when the start date has passed with no account", async () => {
  await open();
  expect(screen.getByRole("alert").textContent).toContain("Rafael started on 3 Nov and still has no login. It’s been 1 day since the request was seen.");
  cleanup();
  mocks.load.mockResolvedValue({ ok: true, status: status({ overdue: false }) });
  await open();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("re-reads on a live notification only while open, never on a timer", async () => {
  render(<RequestStatusPanel employee={employee} />);
  act(() => { window.dispatchEvent(new Event(LIVE_EVENT)); });
  expect(mocks.load).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "View request" }));
  await screen.findByText("Modules requested");
  expect(mocks.load).toHaveBeenCalledTimes(1);
  const created = base.steps.map((s) => (s.key === "account_created" ? { ...s, done: true, at: "2026-11-13T01:00:00Z", actor: "IT Admin" } : s));
  mocks.load.mockResolvedValue({ ok: true, status: status({ status: "account_created", overdue: false, steps: created }) });
  await act(async () => { window.dispatchEvent(new Event(LIVE_EVENT)); });
  await screen.findByText(/13 Nov, 9:00 AM · IT Admin/);
  expect(mocks.load).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});

it("says so when the request cannot be loaded", async () => {
  mocks.load.mockResolvedValue({ ok: false, error: "The request could not be loaded. Please try again in a moment." });
  render(<RequestStatusPanel employee={employee} />);
  await userEvent.click(screen.getByRole("button", { name: "View request" }));
  expect((await screen.findByRole("alert")).textContent).toContain("could not be loaded");
});

const createdSteps = base.steps.map((s) => (s.key === "account_created" ? { ...s, done: true, at: "2026-11-13T01:00:00Z", actor: "IT Admin" } : s));

it("offers Remind admin and Cancel request while the request is Requested or Seen, and neither once the account exists", async () => {
  await open();
  expect(screen.getByRole("button", { name: "Remind admin" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel request" })).toBeTruthy();
  cleanup();
  mocks.load.mockResolvedValue({ ok: true, status: status({ status: "requested" }) });
  await open();
  expect(screen.getByRole("button", { name: "Remind admin" })).toBeTruthy();
  cleanup();
  for (const done of ["account_created", "login_sent"]) {
    mocks.load.mockResolvedValue({ ok: true, status: status({ status: done, steps: createdSteps, overdue: false }) });
    await open();
    expect(screen.queryByRole("button", { name: "Remind admin" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel request" })).toBeNull();
    cleanup();
  }
});

it("removes both actions when a live update brings the account", async () => {
  await open();
  mocks.load.mockResolvedValue({ ok: true, status: status({ status: "account_created", steps: createdSteps, overdue: false }) });
  await act(async () => { window.dispatchEvent(new Event(LIVE_EVENT)); });
  await screen.findByText(/13 Nov, 9:00 AM · IT Admin/);
  expect(screen.queryByRole("button", { name: "Remind admin" })).toBeNull();
});

it("reminds the admin, confirms, then says when the next reminder is allowed and waits", async () => {
  mocks.remind.mockResolvedValue({ ok: true, remindedAt: new Date(Date.now() - 1000).toISOString() });
  await open();
  expect(screen.queryByText(/Reminder sent/)).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Remind admin" }));
  expect(mocks.remind).toHaveBeenCalledWith("RQ-0033");
  expect(await screen.findByText(/Reminder sent .*You can remind the admin again after /)).toBeTruthy();
  expect(mocks.success).toHaveBeenCalledWith("Reminder sent to the admin");
  expect((screen.getByRole("button", { name: "Remind admin" }) as HTMLButtonElement).disabled).toBe(true);
});

it("shows the last reminder on open, waiting inside 24 hours and allowed again after", async () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
  mocks.load.mockResolvedValue({ ok: true, status: status({ lastReminderAt: hoursAgo(2) }) });
  await open();
  expect(screen.getByText(/You can remind the admin again after /)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Remind admin" }) as HTMLButtonElement).disabled).toBe(true);
  cleanup();
  mocks.load.mockResolvedValue({ ok: true, status: status({ lastReminderAt: hoursAgo(25) }) });
  await open();
  expect(screen.queryByText(/You can remind the admin again/)).toBeNull();
  expect((screen.getByRole("button", { name: "Remind admin" }) as HTMLButtonElement).disabled).toBe(false);
});

it("a reminder refused as too soon shows the reason and when the next is allowed", async () => {
  mocks.remind.mockResolvedValue({ ok: false, error: "The admin was reminded recently.", retryAt: new Date(Date.now() + 3600_000).toISOString() });
  await open();
  await userEvent.click(screen.getByRole("button", { name: "Remind admin" }));
  expect((await screen.findByText("The admin was reminded recently.")).getAttribute("role")).toBe("alert");
  expect(screen.getByText(/You can remind the admin again after /)).toBeTruthy();
  expect(mocks.success).not.toHaveBeenCalled();
});

it("asks before cancelling and sends nothing on Keep request", async () => {
  await open();
  await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  expect(screen.getByText("Cancel the account request for Rafael Santiago?")).toBeTruthy();
  expect(screen.getByText(/withdraw RQ-0033, and Rafael goes back to Not requested/)).toBeTruthy();
  await userEvent.click(screen.getByRole("button", { name: "Keep request" }));
  expect(mocks.cancel).not.toHaveBeenCalled();
  expect(screen.queryByText("Cancel the account request for Rafael Santiago?")).toBeNull();
});

it("cancels on confirm: toasts, closes the panel and re-reads the list so the row is Not requested", async () => {
  mocks.cancel.mockResolvedValue({ ok: true });
  await open();
  await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel request" }));
  expect(mocks.cancel).toHaveBeenCalledWith("RQ-0033");
  await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
  expect(mocks.success).toHaveBeenCalledWith("Account request for Rafael Santiago cancelled");
  expect(screen.queryByText("User account request")).toBeNull();
});

it("a cancel refused because the account just appeared says so and re-reads the request", async () => {
  mocks.cancel.mockResolvedValue({ ok: false, error: "The account has just been created, so this request can no longer be changed.", status: "account_created" });
  await open();
  await userEvent.click(screen.getByRole("button", { name: "Cancel request" }));
  mocks.load.mockResolvedValue({ ok: true, status: status({ status: "account_created", steps: createdSteps, overdue: false }) });
  await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Cancel request" }));
  expect((await screen.findByText(/account has just been created/)).getAttribute("role")).toBe("alert");
  await vi.waitFor(() => expect(screen.queryByRole("button", { name: "Remind admin" })).toBeNull());
  expect(mocks.refresh).not.toHaveBeenCalled();
});
