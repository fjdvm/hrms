// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ScheduleInterview } from "@/components/hiring/schedule-interview";

vi.mock("@/app/(hrms)/applicants/[id]/actions", () => ({ saveInterview: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

// Thursday 12 Nov 2026 in Manila.
const TODAY = "2026-11-12";
const interviewers = [{ id: "s1", name: "Liza Bautista", colour: "#2563eb" }];

async function openDatePicker() {
  render(<ScheduleInterview applicationId={1} stage="Interview" applicantName="Ben Torres" applicantEmail="ben@example.com" jobTitle="Production Staff" location="Main kitchen" interviewers={interviewers} label="Schedule interview" today={TODAY} />);
  await userEvent.click(screen.getByRole("button", { name: "Schedule interview" }));
  await userEvent.click(screen.getByRole("button", { name: /^Date/ }));
}
const day = (name: RegExp) => screen.getByRole("button", { name });

it("cannot pick a past day or a weekend, but can pick today and later weekdays", async () => {
  await openDatePicker();
  expect((day(/Tuesday, November 10th/) as HTMLButtonElement).disabled).toBe(true);
  expect((day(/Wednesday, November 11th/) as HTMLButtonElement).disabled).toBe(true);
  expect((day(/Saturday, November 14th/) as HTMLButtonElement).disabled).toBe(true);
  expect((day(/Sunday, November 15th/) as HTMLButtonElement).disabled).toBe(true);
  expect((day(/Thursday, November 12th/) as HTMLButtonElement).disabled).toBe(false);
  expect((day(/Friday, November 13th/) as HTMLButtonElement).disabled).toBe(false);
  expect((day(/Monday, November 16th/) as HTMLButtonElement).disabled).toBe(false);
});

it("turns the Time field red on an overlap, names who is booked, and keeps Schedule disabled until a free time is picked", async () => {
  const { saveInterview } = await import("@/app/(hrms)/applicants/[id]/actions");
  // Tuesday 15 Jan 2030, 2:15–2:45 PM Manila; the Interviewer and link are already on the Interview being moved.
  const booked = { id: 7, startsAt: new Date("2030-01-15T06:15:00Z"), endsAt: new Date("2030-01-15T06:45:00Z"), type: "Online" as const, interviewerName: "Liza Bautista", location: "", interviewerId: "s1", meetingLink: "https://meet.google.com/xqp-rtke-vbn", mapLink: null, province: null, city: null, address: null, privateNotes: null, score: null, result: null, resultEmailAt: null };
  vi.mocked(saveInterview).mockResolvedValueOnce({
    error: "Liza Bautista is already meeting Ella Mae Rivera.",
    conflicts: [{ applicantName: "Ella Mae Rivera", startsAt: "2030-01-15T06:00:00Z", endsAt: "2030-01-15T06:45:00Z" }],
    freeSlots: [{ startsAt: "2030-01-15T07:00:00Z", endsAt: "2030-01-15T07:30:00Z" }],
  });
  render(<ScheduleInterview applicationId={1} stage="Interview" interview={booked} applicantName="Ben Torres" applicantEmail="ben@example.com" jobTitle="Production Staff" location="Main kitchen" interviewers={interviewers} label="Reschedule interview" today={TODAY} />);
  await userEvent.click(screen.getByRole("button", { name: "Reschedule interview" }));
  const submit = () => screen.getByRole("button", { name: "Schedule & send invite" }) as HTMLButtonElement;
  await userEvent.click(submit());

  expect((await screen.findByRole("alert")).textContent).toContain("Liza Bautista is already meeting Ella Mae Rivera.");
  expect(screen.getByLabelText("Start time").parentElement?.className).toContain("border-[#dc2626]");
  expect((await screen.findByRole("button", { name: "Schedule & send invite" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("link", { name: /Liza’s week in Calendar/ }).getAttribute("href")).toContain("interviewer=s1");

  await userEvent.click(screen.getByRole("button", { name: "Tue 15 · 3:00 PM" }));
  expect((screen.getByLabelText("Start time") as HTMLInputElement).value).toBe("15:00");
  expect(submit().disabled).toBe(false);
});

it("shows a fixed, read-only invite email preview", async () => {
  await openDatePicker();
  await userEvent.keyboard("{Escape}");
  const preview = screen.getByLabelText("Invite email preview");
  expect(preview.querySelector("input, textarea, [contenteditable]")).toBeNull();
  expect(preview.textContent).toContain("Your online interview for Production Staff");
  expect(preview.textContent).toContain("Hi Ben, you’re invited to an online interview");
});
