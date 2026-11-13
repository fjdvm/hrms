// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("@/app/(hrms)/employee-onboarding/actions", () => ({ loadAccountRequestStatus: mocks.load }));

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
  overdue: true, daysSinceSeen: 1,
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
