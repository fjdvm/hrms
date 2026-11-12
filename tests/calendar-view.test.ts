import { expect, it } from "vitest";
import type { CalendarConflict, CalendarInterview } from "@/lib/applications";
import { calendarEvents, calendarFilters, calendarHref, calendarState, calendarSubtitle, calendarTitle, conflictMessage, shiftCalendar } from "@/lib/calendar-view";

const NOW = Date.parse("2026-11-12T01:00:00Z"); // Thu 12 Nov 2026, 9 AM Manila

it("defaults to this week in Manila and rejects bad input", () => {
  expect(calendarState({}, NOW)).toEqual({ mode: "week", date: "2026-11-12", interviewerId: undefined, jobPostingId: undefined });
  expect(calendarState({ mode: "year", date: "2026-02-31" }, NOW)).toMatchObject({ mode: "week", date: "2026-11-12" });
  expect(calendarState({ mode: "month", date: "2026-03-05", interviewer: "bea", job: "p1" }, NOW))
    .toEqual({ mode: "month", date: "2026-03-05", interviewerId: "bea", jobPostingId: "p1" });
});

it("moves a weekend Day view to Monday", () => {
  expect(calendarState({ mode: "day", date: "2026-11-14" }).date).toBe("2026-11-16");
  expect(calendarState({ mode: "day", date: "2026-11-15" }).date).toBe("2026-11-16");
});

it("asks for the whole visible range in Manila time", () => {
  expect(calendarFilters({ mode: "week", date: "2026-11-12" })).toEqual({ from: "2026-11-09T00:00:00+08:00", to: "2026-11-16T00:00:00+08:00" });
  expect(calendarFilters({ mode: "day", date: "2026-11-12", interviewerId: "bea" })).toEqual({ from: "2026-11-12T00:00:00+08:00", to: "2026-11-13T00:00:00+08:00", interviewerId: "bea" });
  expect(calendarFilters({ mode: "month", date: "2026-11-12", jobPostingId: "p" })).toMatchObject({ from: "2026-10-26T00:00:00+08:00", to: "2026-12-07T00:00:00+08:00", jobPostingId: "p" });
});

it("steps back and next by the visible unit, skipping weekends in Day", () => {
  expect(shiftCalendar({ mode: "week", date: "2026-11-12" }, 1)).toBe("2026-11-19");
  expect(shiftCalendar({ mode: "month", date: "2026-12-12" }, 1)).toBe("2027-01-01");
  expect(shiftCalendar({ mode: "month", date: "2026-01-12" }, -1)).toBe("2025-12-01");
  expect(shiftCalendar({ mode: "day", date: "2026-11-13" }, 1)).toBe("2026-11-16");
  expect(shiftCalendar({ mode: "day", date: "2026-11-16" }, -1)).toBe("2026-11-13");
});

it("titles and subtitles each view", () => {
  expect(calendarTitle({ mode: "week", date: "2026-11-12" })).toBe("9 – 13 November 2026");
  expect(calendarTitle({ mode: "week", date: "2026-11-02" })).toBe("2 – 6 November 2026");
  expect(calendarTitle({ mode: "week", date: "2026-12-02" })).toBe("30 Nov – 4 Dec 2026");
  expect(calendarTitle({ mode: "day", date: "2026-11-12" })).toBe("Thu, 12 Nov 2026");
  expect(calendarTitle({ mode: "month", date: "2026-11-12" })).toBe("November 2026");
  expect(calendarSubtitle({ mode: "week", date: "2026-11-12" }, 13, 1)).toBe("Week of 9 – 13 November 2026 · 13 interviews · 1 conflict");
  expect(calendarSubtitle({ mode: "week", date: "2026-11-12" }, 1, 0)).toBe("Week of 9 – 13 November 2026 · 1 interview");
});

it("builds short Calendar links", () => {
  expect(calendarHref({ mode: "week", date: "2026-11-12" }, NOW)).toBe("/interviews?view=calendar");
  expect(calendarHref({ mode: "month", date: "2026-12-01", interviewerId: "bea" }, NOW)).toBe("/interviews?view=calendar&mode=month&date=2026-12-01&interviewer=bea");
});

const interview = (id: number, name: string, startsAt: string, endsAt: string) => ({ id, applicantName: name, startsAt: new Date(startsAt), endsAt: new Date(endsAt) }) as CalendarInterview;

it("names a double-booking and marks both Interviews", () => {
  const a = interview(1, "Ella Rivera", "2026-11-12T06:00:00Z", "2026-11-12T07:00:00Z");
  const b = interview(2, "Ben Torres", "2026-11-12T06:30:00Z", "2026-11-12T07:30:00Z");
  const side = (i: CalendarInterview) => ({ interviewId: i.id, applicantName: i.applicantName, startsAt: i.startsAt, endsAt: i.endsAt });
  const conflict: CalendarConflict = { interviewerId: "l", interviewerName: "Liza Bautista", first: side(a), second: side(b) };
  expect(conflictMessage(conflict)).toBe("Liza Bautista is booked twice on Thu, 12 Nov at 2:30 PM (Ella Rivera and Ben Torres).");
  expect(calendarEvents([a, b, interview(3, "Solo", "2026-11-12T02:00:00Z", "2026-11-12T03:00:00Z")], [conflict]).map((e) => e.extendedProps.conflicted)).toEqual([true, true, false]);
  expect(calendarEvents([a], [])[0]).toMatchObject({ start: "2026-11-12T14:00:00.000Z", end: "2026-11-12T15:00:00.000Z" });
});
