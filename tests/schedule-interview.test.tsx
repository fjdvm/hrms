// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduleInterview } from "@/components/hiring/schedule-interview";

vi.mock("@/app/(hrms)/applicants/[id]/actions", () => ({ saveInterview: vi.fn() }));

// Wed 28 Oct 2026, 10:00 in Manila. Only Date is faked so user events keep their timers.
const NOW = new Date("2026-10-28T02:00:00Z");
const interviewers = [{ id: "staff-1", name: "Paolo Garcia", colour: "#2563eb" }, { id: "staff-2", name: "Ara Saldo", colour: "#7c3aed" }];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: true, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function openDatePicker() {
  render(<ScheduleInterview applicationId={7} applicantName="Ellaine Torres" jobTitle="Branch Cashier" location="Cainta" label="Schedule interview" interviewers={interviewers} />);
  await userEvent.click(screen.getByRole("button", { name: "Schedule interview" }));
  await userEvent.click(dateField());
}
// The visible "Date" label names the button, so find it by label.
const dateField = () => screen.getByLabelText(/^Date/);
const day = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;

it("cannot pick a past day", async () => {
  await openDatePicker();
  expect(day(/October 27th, 2026/).disabled).toBe(true);
  expect(day(/October 1st, 2026/).disabled).toBe(true);
});

it("cannot pick a weekend", async () => {
  await openDatePicker();
  expect(day(/October 31st, 2026/).disabled).toBe(true); // Saturday
  await userEvent.click(screen.getByRole("button", { name: /next month/i }));
  expect(day(/November 7th, 2026/).disabled).toBe(true); // Saturday
  expect(day(/November 8th, 2026/).disabled).toBe(true); // Sunday
  expect(day(/November 9th, 2026/).disabled).toBe(false); // Monday
});

it("can pick today and later weekdays", async () => {
  await openDatePicker();
  expect(day(/October 28th, 2026/).disabled).toBe(false);
  expect(day(/October 30th, 2026/).disabled).toBe(false);
  await userEvent.click(day(/October 30th, 2026/));
  expect(dateField().textContent).toContain("Fri, 30 Oct 2026");
});

it("shows a read-only invite preview that cannot be edited", async () => {
  render(<ScheduleInterview applicationId={7} applicantName="Ellaine Torres" jobTitle="Branch Cashier" location="Cainta" label="Schedule interview" interviewers={interviewers} />);
  await userEvent.click(screen.getByRole("button", { name: "Schedule interview" }));
  const preview = screen.getByRole("note", { name: "Invite email preview" });
  expect(preview.textContent).toContain("Your interview for Branch Cashier");
  expect(preview.querySelector("input, textarea, [contenteditable]")).toBeNull();
});
