// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InterviewsCalendar } from "@/components/hiring/interviews-calendar";
import { InterviewsViewSwitch } from "@/components/hiring/interviews-view-switch";
import type { CalendarConflict, CalendarInterview } from "@/lib/applications";

const push = vi.fn();
vi.mock("@/app/(hrms)/applicants/[id]/actions", () => ({ saveInterview: vi.fn(), recordInterviewResult: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push }) }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} }));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-12T04:00:00Z") }); // Thu 12 Nov, noon in Manila
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); push.mockClear(); });

const state = { mode: "week" as const, date: "2026-11-12" };
const interviewers = [{ id: "liza", name: "Liza Bautista", colour: "#2563eb" }, { id: "carlo", name: "Carlo Mendoza", colour: "#ea580c" }];
const make = (id: number, name: string, startsAt: string, endsAt: string, over: Partial<CalendarInterview> = {}): CalendarInterview => ({
  id, applicationId: id * 10, applicantName: name, jobPostingId: "p1", jobPostingTitle: "Production Staff", interviewerId: "liza", interviewerName: "Liza Bautista",
  colour: "#2563eb", type: "Online", startsAt: new Date(startsAt), endsAt: new Date(endsAt), meetingLink: "https://meet.example/abc", mapLink: null, place: "",
  applicantEmail: `${id}@example.test`, jobLocation: "Main kitchen", province: null, city: null, address: null, location: "https://meet.example/abc", status: "Scheduled", ...over,
});
const started = make(1, "Joel Santos", "2026-11-12T02:00:00Z", "2026-11-12T02:30:00Z", { interviewerId: "carlo", interviewerName: "Carlo Mendoza", colour: "#ea580c" });
const later = make(2, "Ella Rivera", "2026-11-12T06:00:00Z", "2026-11-12T07:00:00Z", { type: "In person", place: "Main kitchen, Antipolo", mapLink: "https://maps.example/x" });
const clash = make(3, "Ben Torres", "2026-11-12T06:30:00Z", "2026-11-12T07:30:00Z");
const done = make(4, "Ivy Reyes", "2026-11-13T01:00:00Z", "2026-11-13T02:00:00Z", { status: "Passed" });
const side = (i: CalendarInterview) => ({ interviewId: i.id, applicantName: i.applicantName, startsAt: i.startsAt, endsAt: i.endsAt });
const conflict: CalendarConflict = { interviewerId: "liza", interviewerName: "Liza Bautista", first: side(later), second: side(clash) };

function show(interviews = [started, later, clash, done], conflicts = [conflict]) {
  render(<InterviewsCalendar state={state} title="9 – 13 November 2026" interviews={interviews} conflicts={conflicts} interviewers={interviewers} jobs={[{ id: "p1", title: "Production Staff" }]} />);
}
const eventOf = (name: string) => screen.getByText(name).closest(".fc-event") as HTMLElement;

it("shows Monday to Friday only, with back, next, Today and the three views", () => {
  show();
  expect(screen.getAllByRole("columnheader")).toHaveLength(5);
  expect(screen.queryByText("SAT")).toBeNull();
  expect(screen.getByRole("link", { name: "Back" }).getAttribute("href")).toBe("/interviews?view=calendar&date=2026-11-05");
  expect(screen.getByRole("link", { name: "Next" }).getAttribute("href")).toBe("/interviews?view=calendar&date=2026-11-19");
  expect(screen.getByRole("link", { name: "Today" }).getAttribute("href")).toBe("/interviews?view=calendar");
  expect(screen.getByRole("link", { name: "Month" }).getAttribute("href")).toContain("mode=month");
  expect(screen.getByRole("link", { name: "Day" }).getAttribute("href")).toContain("mode=day");
  expect(screen.getByLabelText("Interviewer")).toBeTruthy();
  expect(screen.getByLabelText("Job Posting")).toBeTruthy();
});

it("colours by Interviewer, marks finished ones and outlines double-bookings", () => {
  show();
  expect(eventOf("Joel Santos").querySelector("[style*='border-color']")).not.toBeNull();
  expect(within(eventOf("Ivy Reyes")).getByText(/Passed/)).toBeTruthy();
  expect(within(eventOf("Joel Santos")).getByLabelText("Online")).toBeTruthy();
  expect(within(eventOf("Ella Rivera")).getByLabelText("In person")).toBeTruthy();
  for (const name of ["Ella Rivera", "Ben Torres"]) expect(within(eventOf(name)).getByLabelText("Double-booked")).toBeTruthy();
  expect(within(eventOf("Joel Santos")).queryByLabelText("Double-booked")).toBeNull();
});

it("names the double-booking in a red banner offering Reschedule", async () => {
  show();
  const banner = screen.getByRole("alert");
  expect(banner.textContent).toContain("Liza Bautista is booked twice on Thu, 12 Nov at 2:30 PM (Ella Rivera and Ben Torres).");
  await userEvent.click(within(banner).getByRole("button", { name: "Reschedule Ben" }));
  expect(screen.getByText("Reschedule interview")).toBeTruthy();
});

it("pops up the details with Open profile, Reschedule and an enabled Record result once started", async () => {
  show();
  await userEvent.click(eventOf("Joel Santos"));
  const popup = screen.getByRole("dialog", { name: /Joel Santos/ });
  expect(popup.textContent).toContain("10 AM – 10:30 AM");
  expect(popup.textContent).toContain("Online");
  expect(within(popup).getByRole("link", { name: "meet.example/abc" })).toBeTruthy();
  expect(popup.textContent).toContain("Carlo Mendoza (interviewer)");
  expect(within(popup).getByRole("link", { name: "Open profile" }).getAttribute("href")).toBe("/applicants/10");
  expect(within(popup).getByRole("button", { name: "Reschedule" })).toBeTruthy();
  expect((within(popup).getByRole("button", { name: "Record result" }) as HTMLButtonElement).disabled).toBe(false);
});

it("disables Record result before the start and shows the place and map for in person", async () => {
  show();
  await userEvent.click(eventOf("Ella Rivera"));
  const popup = screen.getByRole("dialog", { name: /Ella Rivera/ });
  expect((within(popup).getByRole("button", { name: "Record result" }) as HTMLButtonElement).disabled).toBe(true);
  expect(popup.textContent).toContain("Main kitchen, Antipolo");
  expect(within(popup).getByRole("link", { name: "View map" })).toBeTruthy();
});

it("offers Open profile only for a finished Interview", async () => {
  show();
  await userEvent.click(eventOf("Ivy Reyes"));
  const popup = screen.getByRole("dialog", { name: /Ivy Reyes/ });
  expect(within(popup).getByRole("link", { name: "Open profile" })).toBeTruthy();
  expect(within(popup).queryByRole("button", { name: "Reschedule" })).toBeNull();
  expect(within(popup).queryByRole("button", { name: "Record result" })).toBeNull();
});

it("shows the By job | Calendar switch", () => {
  render(<InterviewsViewSwitch current="calendar" />);
  expect(screen.getByRole("link", { name: "By job" }).getAttribute("href")).toBe("/interviews");
  expect(screen.getByRole("link", { name: "Calendar" }).getAttribute("aria-current")).toBe("page");
});
