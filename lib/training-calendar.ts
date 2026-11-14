// The Training Calendar's URL state and grid maths. No database or server imports, so the client Calendar can use it.
import { manilaToday } from "./training-terms";
import type { CalendarTraining } from "./trainings";

/** Days are "YYYY-MM-DD" in Manila. Unlike Interviews, Trainings can fall on any day, so all seven show. */
export type TrainingCalendarMode = "week" | "month";
export type TrainingCalendarState = { mode: TrainingCalendarMode; date: string };

const DAY_MS = 86400000;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const parse = (day: string) => new Date(`${day}T00:00:00Z`);
const format = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (day: string, days: number) => format(new Date(parse(day).getTime() + days * DAY_MS));
const mondayOf = (day: string) => addDays(day, -((parse(day).getUTCDay() + 6) % 7));
const validDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(parse(value).getTime()) && format(parse(value)) === value;
const dayLabel = (day: string) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1].slice(0, 3)}`;

/** Reads `mode` and `date`; anything unusable falls back to this month. */
export function trainingCalendarState(params: Record<string, string | string[] | undefined>, now: Date = new Date()): TrainingCalendarState {
  const one = (key: string) => { const value = params[key]; return typeof value === "string" ? value : undefined; };
  const mode: TrainingCalendarMode = one("mode") === "week" ? "week" : "month";
  return { mode, date: validDay(one("date")) ? one("date")! : manilaToday(now) };
}

/** The Manila days [from, to) the visible grid covers: whole weeks, Monday first. */
export function trainingCalendarRange({ mode, date }: TrainingCalendarState): { from: string; to: string } {
  if (mode === "week") { const from = mondayOf(date); return { from, to: addDays(from, 7) }; }
  const first = `${date.slice(0, 7)}-01`;
  const last = format(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0)));
  return { from: mondayOf(first), to: addDays(mondayOf(last), 7) };
}

/** The date a back (-1) or next (1) press lands on; Month lands on the 1st. */
export function shiftTrainingCalendar({ mode, date }: TrainingCalendarState, direction: -1 | 1): string {
  if (mode === "week") return addDays(date, 7 * direction);
  return format(new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1 + direction, 1)));
}

/** "9 – 15 November 2026" or "November 2026". */
export function trainingCalendarTitle({ mode, date }: TrainingCalendarState): string {
  if (mode === "month") return `${MONTHS[Number(date.slice(5, 7)) - 1]} ${date.slice(0, 4)}`;
  const first = mondayOf(date), last = addDays(first, 6);
  return first.slice(5, 7) === last.slice(5, 7)
    ? `${Number(first.slice(8))} – ${Number(last.slice(8))} ${MONTHS[Number(last.slice(5, 7)) - 1]} ${last.slice(0, 4)}`
    : `${dayLabel(first)} – ${dayLabel(last)} ${last.slice(0, 4)}`;
}

export function trainingCalendarSubtitle(state: TrainingCalendarState, count: number): string {
  const scope = state.mode === "week" ? `Week of ${trainingCalendarTitle(state)}` : `Month of ${trainingCalendarTitle(state)}`;
  return `${scope} · ${count} ${count === 1 ? "training" : "trainings"}`;
}

/** The Calendar URL for a state; defaults are left out so links stay short. */
export function trainingCalendarHref(state: TrainingCalendarState, now: Date = new Date()): string {
  const query = new URLSearchParams();
  if (state.mode !== "month") query.set("mode", state.mode);
  if (state.date !== manilaToday(now)) query.set("date", state.date);
  const text = query.toString();
  return text ? `/training/calendar?${text}` : "/training/calendar";
}

/** Colour per Mode, shared by the events and the legend. */
export const MODE_COLOUR = { Online: "#5B2A86", "In person": "#0F766E" } as const;

export type TrainingCalendarEvent = { id: string; start: string; end: string; title: string; extendedProps: { training: CalendarTraining } };

/** FullCalendar runs in UTC, so Manila wall-clock is passed as UTC: no time-zone plugin needed. */
export const trainingCalendarEvents = (trainings: CalendarTraining[]): TrainingCalendarEvent[] =>
  trainings.map((training) => ({
    id: String(training.id), title: training.title, extendedProps: { training },
    start: `${training.date}T${training.startTime}:00Z`, end: `${training.date}T${training.endTime}:00Z`,
  }));

/** Manila "now" as FullCalendar's UTC clock reads it. */
export const trainingCalendarNow = () => new Date(Date.now() + 8 * 3600000);
