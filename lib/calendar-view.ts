import type { CalendarConflict, CalendarFilters, CalendarInterview } from "./applications";
import { manilaToday } from "./interview-form";

/** The Interviews Calendar's URL state. Days are "YYYY-MM-DD" in Manila; the Calendar only ever shows Monday to Friday. */
export type CalendarMode = "day" | "week" | "month";
export type CalendarState = { mode: CalendarMode; date: string; interviewerId?: string; jobPostingId?: string };
export type InterviewsView = "by-job" | "calendar";

const MODES: CalendarMode[] = ["day", "week", "month"];
const DAY_MS = 86400000;
/** The Manila wall-clock of an instant, read as UTC. */
const manilaWall = (instant: Date) => new Date(instant.getTime() + 8 * 3600000);
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const parse = (day: string) => new Date(`${day}T00:00:00Z`);
const format = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, days: number) => format(new Date(parse(day).getTime() + days * DAY_MS));
const weekday = (day: string) => parse(day).getUTCDay();
const mondayOf = (day: string) => addDays(day, -((weekday(day) + 6) % 7));
const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && format(parse(value)) === value;

export const viewFromParam = (value: string | string[] | undefined): InterviewsView => (value === "calendar" ? "calendar" : "by-job");

/** Reads `mode`, `date`, `interviewer` and `job`; anything unusable falls back to this week. */
export function calendarState(params: Record<string, string | string[] | undefined>, now = Date.now()): CalendarState {
  const one = (key: string) => { const value = params[key]; return typeof value === "string" && value.trim() !== "" ? value : undefined; };
  const mode = MODES.find((candidate) => candidate === one("mode")) ?? "week";
  let date = validDay(one("date")) ? one("date")! : manilaToday(now);
  if (mode === "day") date = weekday(date) === 6 ? addDays(date, 2) : weekday(date) === 0 ? addDays(date, 1) : date;
  return { mode, date, interviewerId: one("interviewer"), jobPostingId: one("job") };
}

/** The Manila days [first, end) the visible grid covers. */
function span({ mode, date }: CalendarState): { first: string; end: string } {
  if (mode === "day") return { first: date, end: addDays(date, 1) };
  if (mode === "week") { const first = mondayOf(date); return { first, end: addDays(first, 7) }; }
  const month = `${date.slice(0, 7)}-01`;
  const last = format(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)));
  return { first: mondayOf(month), end: addDays(mondayOf(last), 7) };
}

export function calendarFilters(state: CalendarState): CalendarFilters {
  const { first, end } = span(state);
  return { from: `${first}T00:00:00+08:00`, to: `${end}T00:00:00+08:00`,
    ...(state.interviewerId && { interviewerId: state.interviewerId }), ...(state.jobPostingId && { jobPostingId: state.jobPostingId }) };
}

/** The date a back (-1) or next (1) press lands on; Day skips weekends and Month lands on the 1st. */
export function shiftCalendar({ mode, date }: CalendarState, direction: -1 | 1): string {
  if (mode === "week") return addDays(date, 7 * direction);
  if (mode === "month") return format(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + direction, 1)));
  let next = addDays(date, direction);
  while ([0, 6].includes(weekday(next))) next = addDays(next, direction);
  return next;
}

const dayLabel = (day: string) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1].slice(0, 3)}`;

/** "9 – 13 November 2026", "Thu, 12 Nov 2026" or "November 2026". */
export function calendarTitle(state: CalendarState): string {
  const { date } = state;
  const year = date.slice(0, 4);
  if (state.mode === "month") return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${year}`;
  if (state.mode === "day") return `${WEEKDAYS[weekday(date)]}, ${dayLabel(date)} ${year}`;
  const first = mondayOf(date), last = addDays(first, 4);
  const month = (day: string) => MONTHS[Number(day.slice(5, 7)) - 1];
  return first.slice(5, 7) === last.slice(5, 7)
    ? `${Number(first.slice(8))} – ${Number(last.slice(8))} ${month(last)} ${last.slice(0, 4)}`
    : `${dayLabel(first)} – ${dayLabel(last)} ${last.slice(0, 4)}`;
}

export function calendarSubtitle(state: CalendarState, interviews: number, conflicts: number): string {
  const scope = state.mode === "week" ? `Week of ${calendarTitle(state)}` : state.mode === "day" ? calendarTitle(state) : `Month of ${calendarTitle(state)}`;
  const count = `${interviews} ${interviews === 1 ? "interview" : "interviews"}`;
  return [scope, count, ...(conflicts > 0 ? [`${conflicts} ${conflicts === 1 ? "conflict" : "conflicts"}`] : [])].join(" · ");
}

/** The Calendar URL for a state; defaults are left out so links stay short. */
export function calendarHref(state: CalendarState, now = Date.now()): string {
  const query = new URLSearchParams({ view: "calendar" });
  if (state.mode !== "week") query.set("mode", state.mode);
  if (state.date !== manilaToday(now)) query.set("date", state.date);
  if (state.interviewerId) query.set("interviewer", state.interviewerId);
  if (state.jobPostingId) query.set("job", state.jobPostingId);
  return `/interviews?${query}`;
}

const time = (instant: Date) => {
  const manila = manilaWall(instant);
  const hours = manila.getUTCHours(), minutes = manila.getUTCMinutes();
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours < 12 ? "AM" : "PM"}`;
};
export { time as interviewTime };
export const interviewRange = (start: Date, end: Date) => `${time(start)} – ${time(end)}`;

/** "Liza Bautista is booked twice on Thu, 12 Nov at 2 PM (Ella Rivera and Ben Torres)." */
export function conflictMessage({ interviewerName, first, second }: CalendarConflict): string {
  const start = first.startsAt < second.startsAt ? second.startsAt : first.startsAt;
  const manila = manilaWall(start);
  const day = `${WEEKDAYS[manila.getUTCDay()]}, ${Number(format(manila).slice(8))} ${MONTHS[manila.getUTCMonth()].slice(0, 3)}`;
  return `${interviewerName} is booked twice on ${day} at ${time(start)} (${first.applicantName} and ${second.applicantName}).`;
}

/** Interview ids that sit in a double-booking, for the dashed red outline. */
export const conflictedIds = (conflicts: CalendarConflict[]) => new Set(conflicts.flatMap(({ first, second }) => [first.interviewId, second.interviewId]));

export type CalendarEvent = { id: string; start: string; end: string; title: string; extendedProps: { interview: CalendarInterview; conflicted: boolean } };

/** FullCalendar runs in UTC, so Manila wall-clock times are shifted by +8h and read back as UTC: no time-zone plugin needed. */
export function calendarEvents(interviews: CalendarInterview[], conflicts: CalendarConflict[]): CalendarEvent[] {
  const conflicted = conflictedIds(conflicts);
  const wall = (instant: Date) => manilaWall(instant).toISOString();
  return interviews.map((interview) => ({
    id: String(interview.id), start: wall(interview.startsAt), end: wall(interview.endsAt), title: interview.applicantName,
    extendedProps: { interview, conflicted: conflicted.has(interview.id) },
  }));
}

/** Manila "now" as FullCalendar's UTC clock reads it. */
export const calendarNow = () => manilaWall(new Date());
