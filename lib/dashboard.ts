import { MANUAL_SOURCES, type ApplicationSource } from "@/lib/application-sources";
import { applicantsHref } from "@/lib/application-view";
import type { Module } from "@/lib/modules";

/** Data each owning Module supplies for its Key Summary Cards. Absent until the Module has data. */
export interface DashboardSummary {
  totalEmployee?: { regular: number; probationary: number; ojt: number };
  /** Open Job Postings: how many, the openings they list in total (postings that give no number add none) and their distinct locations. */
  openJobs?: { count: number; openings: number; locations: number };
  /** Applications received in the Dashboard Range and in its Previous period. */
  applicants?: { current: number; previous: number };
  /** Interviews starting in the current Manila week (finished ones included) and the ones starting today. */
  interviews?: { thisWeek: number; today: number };
  /** Interviews that start after now and before the end of the current Manila week, any order. Every one is needed for the widget's headline; it lists the first five. */
  upcomingInterviews?: UpcomingInterview[];
  /** Applications received in the Dashboard Range: the total and the five Job Postings with the most (ties by title), closed and filled ones included. */
  applicantsByJob?: { total: number; jobs: { id: string; title: string; count: number }[] };
  /** Applications received in the Dashboard Range, and how many of them have ever reached each later Stage (from stage history, so a later Rejected still counts). */
  hiringPipeline?: HiringPipelineCounts;
  /** What Staff should act on now (not range-based): Applications at New, at Interview with no Interview booked, and Interviews that ended with no result. */
  needsAttention?: NeedsAttentionCounts;
  /** Applications received in the Dashboard Range per Source, with how many of them have ever reached Hired. Only Sources that have Applications need appear. */
  applicantSources?: { source: ApplicationSource; count: number; hired: number }[];
  /** Decided offers (accepted of decided) with a decision date in the range and in its Previous period. */
  offers?: { current: OfferOutcomes; previous: OfferOutcomes };
  /** Applications Hired in the range and in its Previous period, with the mean whole days from applying to being Hired (null with no hires). */
  timeToHire?: { current: HireTimes; previous: HireTimes };
  attendanceRate?: { present: number; expected: number };
  /** Month-end Total Employee figures, `month` as "YYYY-MM". The current month is taken from `totalEmployee`. */
  headcountHistory?: { month: string; total: number }[];
  /** Employee count per department; a null department means the employee has none. */
  departmentCounts?: { department: string | null; count: number }[];
  recentActivity?: ActivityEvent[];
  /** Company holidays and approved leave not yet started. */
  upcomingEvents?: UpcomingEvent[];
}

export interface UpcomingInterview {
  id: number;
  applicantName: string;
  jobPostingTitle: string;
  type: "Online" | "In person";
  /** ISO timestamp. */
  startsAt: string;
}

export interface OfferOutcomes {
  accepted: number;
  decided: number;
}

export interface HireTimes {
  hires: number;
  averageDays: number | null;
}

export interface ActivityEvent {
  id: string;
  kind: "hire" | "transfer" | "status-change" | "separation";
  employeeName: string;
  photoUrl?: string;
  title: string;
  description: string;
  /** ISO timestamp. */
  at: string;
}

export type UpcomingEvent = {
  id: string;
  title: string;
  /** "YYYY-MM-DD"; the start date for multi-day leave. */
  date: string;
  description: string;
} & ({ kind: "holiday" } | { kind: "leave"; status: "approved" | "pending" });

export interface KeySummaryCard {
  label: string;
  module: Module["name"];
  /** The headline figure, or null when the owning Module has no data to show yet. */
  figure: string | null;
  /** The line under the figure, or null when there is none. */
  caption: string | null;
  /** The comparison the caption states, for its colour and arrow; null when the card makes none. */
  comparison: Comparison | null;
  /** True when the Dashboard Range changes the card, so it shows a skeleton while the range reloads. */
  rangeDependent: boolean;
}

export interface Comparison {
  /** E.g. "12% vs last month" or "No change vs last month". */
  text: string;
  /** Green for improvement, red for adverse, grey for none. */
  tone: "good" | "bad" | "none";
  /** The direction the number moved; none when there was no change. */
  arrow: "up" | "down" | "none";
}

/** Percent change from the Previous period, whole numbers. Left out (null) when either period has no data: a null figure, or a Previous period of zero to divide by. A counted zero is data. */
export function compare(
  current: number | null,
  previous: number | null,
  wording: string,
  better: "higher" | "lower" = "higher",
): Comparison | null {
  if (current === null || !previous) return null;
  const change = ((current - previous) / previous) * 100;
  if (Math.abs(change) < 0.5) return { text: `No change ${wording}`, tone: "none", arrow: "none" };
  const up = change > 0;
  return {
    text: `${Math.round(Math.abs(change))}% ${wording}`,
    tone: up === (better === "higher") ? "good" : "bad",
    arrow: up ? "up" : "down",
  };
}

export const RANGE_IDS = ["this-month", "last-month", "last-30-days", "last-90-days", "year-to-date"] as const;
export type PresetRangeId = (typeof RANGE_IDS)[number];
export type RangeId = PresetRangeId | "custom";

/** The widest Custom range, in days from the first date to the last. */
export const MAX_CUSTOM_RANGE_DAYS = 366;

/** The two dates of a Custom range as they appear in the URL, "YYYY-MM-DD". */
export interface CustomRangeDates {
  from: string;
  to: string;
}

export interface RangePeriod {
  /** First and last day, "YYYY-MM-DD" in Manila time. */
  start: string;
  end: string;
}

/** The Dashboard Range: the period the range-dependent cards cover, and the Previous period they compare with. */
export interface DashboardRange extends RangePeriod {
  id: RangeId;
  name: string;
  /** "This month · 1–28 Oct 2026". */
  label: string;
  /** The range in a sentence: "this month", "in the last 30 days". */
  phrase: string;
  /** Manila midnight starting the first day, and starting the day after the last: query `>= from AND < to`. */
  from: Date;
  to: Date;
  previous: RangePeriod & { wording: string; from: Date; to: Date };
}

export const RANGE_OPTIONS: readonly { id: PresetRangeId; name: string }[] = [
  { id: "this-month", name: "This month" },
  { id: "last-month", name: "Last month" },
  { id: "last-30-days", name: "Last 30 days" },
  { id: "last-90-days", name: "Last 90 days" },
  { id: "year-to-date", name: "Year to date" },
];

/** A known preset from the URL, otherwise This month. */
export function parseRangeId(value: unknown): PresetRangeId {
  return RANGE_IDS.find((id) => id === value) ?? "this-month";
}

// Manila has no daylight saving, so a fixed +08:00 offset is exact. Days are handled as UTC dates standing for Manila calendar days.
const MANILA_OFFSET_MS = 8 * 3_600_000;
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * MS_PER_DAY);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysInMonth = (y: number, m: number) => day(y, m + 1, 0).getUTCDate();
const manilaMidnight = (d: Date) => new Date(`${iso(d)}T00:00:00+08:00`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function periodLabel(start: Date, end: Date): string {
  const [sd, sm, sy] = [start.getUTCDate(), MONTHS[start.getUTCMonth()], start.getUTCFullYear()];
  const [ed, em, ey] = [end.getUTCDate(), MONTHS[end.getUTCMonth()], end.getUTCFullYear()];
  if (sy !== ey) return `${sd} ${sm} ${sy} – ${ed} ${em} ${ey}`;
  if (sm !== em) return `${sd} ${sm} – ${ed} ${em} ${ey}`;
  return sd === ed ? `${sd} ${sm} ${sy}` : `${sd}–${ed} ${sm} ${sy}`;
}

/** The same day-of-month `months` earlier, held at the end of a shorter month (31 Mar -> 28 Feb). */
function monthsBack(d: Date, months: number): Date {
  const first = day(d.getUTCFullYear(), d.getUTCMonth() - months, 1);
  const y = first.getUTCFullYear();
  const m = first.getUTCMonth();
  return day(y, m, Math.min(d.getUTCDate(), daysInMonth(y, m)));
}

/** A real calendar date written "YYYY-MM-DD", as a UTC date standing for that day; null for anything else. */
function parseDay(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || iso(parsed) !== value ? null : parsed;
}

/** Today's date in Manila, "YYYY-MM-DD". */
export function manilaToday(now: Date): string {
  return iso(new Date(now.getTime() + MANILA_OFFSET_MS));
}

/** Why two dates cannot be a Custom range, or null when they can. Strict: real dates, in order, not after today, at most a year apart. */
export function customRangeProblem(from: unknown, to: unknown, now: Date): "invalid" | "future" | "order" | "too-long" | null {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start || !end) return "invalid";
  if (end > parseDay(manilaToday(now))!) return "future";
  if (start > end) return "order";
  if ((end.getTime() - start.getTime()) / MS_PER_DAY > MAX_CUSTOM_RANGE_DAYS) return "too-long";
  return null;
}

/** The Dashboard Range for a preset or a Custom range, with `now` read as a Manila date. A Custom range that fails `customRangeProblem` is This month. Pure: `now` is passed in. */
export function dashboardRange(id: unknown, now: Date, custom?: { from: unknown; to: unknown }): DashboardRange {
  const customRange = id === "custom" && custom && customRangeProblem(custom.from, custom.to, now) === null ? custom : null;
  const rangeId: RangeId = customRange ? "custom" : parseRangeId(id);
  const m = new Date(now.getTime() + MANILA_OFFSET_MS);
  const [y, mo] = [m.getUTCFullYear(), m.getUTCMonth()];
  const today = day(y, mo, m.getUTCDate());

  let start: Date, end: Date, previousStart: Date, previousEnd: Date, wording: string, phrase: string;
  if (customRange) {
    start = parseDay(customRange.from)!;
    end = parseDay(customRange.to)!;
    const length = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
    previousEnd = addDays(start, -1);
    previousStart = addDays(previousEnd, 1 - length);
    wording = "vs previous period";
    phrase = "in this period";
  } else if (rangeId === "this-month") {
    start = day(y, mo, 1);
    end = today;
    previousStart = day(y, mo - 1, 1);
    previousEnd = monthsBack(today, 1);
    wording = "vs last month";
    phrase = "this month";
  } else if (rangeId === "last-month") {
    start = day(y, mo - 1, 1);
    end = day(y, mo, 0);
    previousStart = day(y, mo - 2, 1);
    previousEnd = day(y, mo - 1, 0);
    wording = "vs month before";
    phrase = "last month";
  } else if (rangeId === "year-to-date") {
    start = day(y, 0, 1);
    end = today;
    previousStart = day(y - 1, 0, 1);
    previousEnd = monthsBack(today, 12);
    wording = "vs last year";
    phrase = "so far this year";
  } else {
    const days = rangeId === "last-30-days" ? 30 : 90;
    start = addDays(today, 1 - days);
    end = today;
    previousStart = addDays(start, -days);
    previousEnd = addDays(start, -1);
    wording = `vs previous ${days} days`;
    phrase = `in the last ${days} days`;
  }

  const name = rangeId === "custom" ? "Custom" : RANGE_OPTIONS.find((o) => o.id === rangeId)!.name;
  return {
    id: rangeId,
    name,
    label: `${name} · ${periodLabel(start, end)}`,
    phrase,
    start: iso(start),
    end: iso(end),
    from: manilaMidnight(start),
    to: manilaMidnight(addDays(end, 1)),
    previous: {
      start: iso(previousStart),
      end: iso(previousEnd),
      wording,
      from: manilaMidnight(previousStart),
      to: manilaMidnight(addDays(previousEnd, 1)),
    },
  };
}

/** The URL query that selects a range: the page and the Export route read the same one. */
export function rangeSearch(range: DashboardRange): string {
  return range.id === "custom" ? `range=custom&from=${range.start}&to=${range.end}` : `range=${range.id}`;
}

/** The hiring cards sit in a row of their own above the rest. */
type CardRow = "hiring" | "people";

interface CardSpec {
  label: string;
  module: Module["name"];
  href: Module["href"];
  row: CardRow;
  figure: (summary: DashboardSummary) => string | null;
  caption?: (summary: DashboardSummary) => string | null;
  /** The comparison with the Previous period, shown under the caption. */
  comparison?: (summary: DashboardSummary, range: DashboardRange) => Comparison | null;
  /** Set when the Dashboard Range changes the card. */
  rangeDependent?: true;
}

/** "vs last month" as the tail of "4 days faster than last month". */
const than = (wording: string) => wording.replace(/^vs /, "");

const wholePercent = ({ accepted, decided }: OfferOutcomes) => Math.round((accepted / decided) * 100);

/** Offer acceptance moved, in percentage points of the whole percents the card shows. Left out unless both periods have decided offers. */
function compareOffers({ current, previous }: { current: OfferOutcomes; previous: OfferOutcomes }, wording: string): Comparison | null {
  if (current.decided === 0 || previous.decided === 0) return null;
  const points = wholePercent(current) - wholePercent(previous);
  if (points === 0) return { text: `No change ${wording}`, tone: "none", arrow: "none" };
  return { text: `${Math.abs(points)} ${Math.abs(points) === 1 ? "pt" : "pts"} ${wording}`, tone: points > 0 ? "good" : "bad", arrow: points > 0 ? "up" : "down" };
}

/** Time to hire moved, in the whole days the card shows: faster is good. Left out unless both periods have hires. */
function compareHireTimes({ current, previous }: { current: HireTimes; previous: HireTimes }, wording: string): Comparison | null {
  if (current.averageDays === null || previous.averageDays === null) return null;
  const days = Math.round(previous.averageDays) - Math.round(current.averageDays);
  if (days === 0) return { text: `No change ${wording}`, tone: "none", arrow: "none" };
  const n = Math.abs(days);
  return {
    text: `${n} ${n === 1 ? "day" : "days"} ${days > 0 ? "faster" : "slower"} than ${than(wording)}`,
    tone: days > 0 ? "good" : "bad",
    arrow: days > 0 ? "down" : "up",
  };
}

const MS_PER_DAY = 86_400_000;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const CARDS: readonly CardSpec[] = [
  {
    label: "Open jobs",
    module: "Recruitment and Hiring",
    href: "/job-postings",
    row: "hiring",
    figure: ({ openJobs: d }) => (d && d.count > 0 ? String(d.count) : null),
    caption: ({ openJobs: d }) =>
      d && d.count > 0
        ? [d.openings > 0 ? plural(d.openings, "opening") : "", plural(d.locations, "location")].filter(Boolean).join(" · ")
        : null,
  },
  {
    label: "Applicants",
    module: "Recruitment and Hiring",
    href: "/job-postings",
    row: "hiring",
    figure: ({ applicants: d }) => (d ? String(d.current) : null),
    comparison: ({ applicants: d }, range) => (d ? compare(d.current, d.previous, range.previous.wording) : null),
    rangeDependent: true,
  },
  {
    label: "Interviews this week",
    module: "Recruitment and Hiring",
    href: "/job-postings",
    row: "hiring",
    // Zero is a figure: the card shows 0, not "Nothing to show yet", until interviews are stored.
    figure: ({ interviews: d }) => (d ? String(d.thisWeek) : null),
    caption: ({ interviews: d }) => (d ? (d.today > 0 ? `${d.today} today` : "None today") : null),
  },
  {
    label: "Offer acceptance",
    module: "Recruitment and Hiring",
    href: "/job-postings",
    row: "hiring",
    figure: ({ offers: d }) => (d && d.current.decided > 0 ? `${wholePercent(d.current)}%` : null),
    caption: ({ offers: d }) =>
      d && d.current.decided > 0 ? `${d.current.accepted} of ${plural(d.current.decided, "offer")} accepted` : null,
    comparison: ({ offers: d }, range) => (d ? compareOffers(d, range.previous.wording) : null),
    rangeDependent: true,
  },
  {
    label: "Average time to hire",
    module: "Recruitment and Hiring",
    href: "/job-postings",
    row: "hiring",
    figure: ({ timeToHire: d }) => (d && d.current.averageDays !== null ? plural(Math.round(d.current.averageDays), "day") : null),
    comparison: ({ timeToHire: d }, range) => (d ? compareHireTimes(d, range.previous.wording) : null),
    rangeDependent: true,
  },
  {
    label: "Total Employee",
    module: "Employee Information",
    href: "/employee-information",
    row: "people",
    figure: ({ totalEmployee: d }) =>
      d ? String(d.regular + d.probationary + d.ojt) : null,
  },
  {
    label: "Attendance Rate",
    module: "Attendance",
    href: "/attendance",
    row: "people",
    figure: ({ attendanceRate: d }) =>
      d && d.expected > 0 ? `${Math.round((d.present / d.expected) * 100)}%` : null,
  },
];

const CARD_ROWS: readonly CardRow[] = ["hiring", "people"];

/**
 * The Key Summary Cards a Staff member sees, as the Dashboard rows (hiring first, then the rest), each
 * in fixed order: one card per card whose owning Module they hold. A row with no card is left out, and
 * unknown addresses are ignored, so only real Modules can produce a card.
 */
export function cardRowsFor(
  permittedPages: readonly string[],
  summary: DashboardSummary,
  range: DashboardRange,
): KeySummaryCard[][] {
  return CARD_ROWS.map((row) => cardsInRow(row, permittedPages, summary, range)).filter((cards) => cards.length > 0);
}

function cardsInRow(
  row: CardRow,
  permittedPages: readonly string[],
  summary: DashboardSummary,
  range: DashboardRange,
): KeySummaryCard[] {
  return CARDS.filter((c) => c.row === row && permittedPages.includes(c.href)).map((c) => ({
    label: c.label,
    module: c.module,
    figure: c.figure(summary),
    caption: c.caption?.(summary) ?? null,
    comparison: c.comparison?.(summary, range) ?? null,
    rangeDependent: c.rangeDependent ?? false,
  }));
}

/** The current Monday-to-Sunday week and today, as Manila days: query `starts_at >= from AND starts_at < to`. Pure: `now` is passed in. */
export function manilaWeek(now: Date): { week: { from: Date; to: Date }; today: { from: Date; to: Date } } {
  const today = parseDay(manilaToday(now))!;
  const monday = addDays(today, -((today.getUTCDay() + 6) % 7));
  return {
    week: { from: manilaMidnight(monday), to: manilaMidnight(addDays(monday, 7)) },
    today: { from: manilaMidnight(today), to: manilaMidnight(addDays(today, 1)) },
  };
}

const csvCell = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);

/** A comparison as written in the Export: the direction the number moved leads the figure the text starts with. */
const exportedComparison = ({ text, arrow }: Comparison) =>
  /^\d/.test(text) && arrow !== "none" ? `${arrow === "up" ? "+" : "-"}${text}` : text;

/** The Export file: one row per hiring card, from the same figures the page shows. Value is empty when a card has nothing to show. */
export function hiringCardsCsv(cards: readonly KeySummaryCard[]): string {
  const rows = cards.map((card) => [
    card.label,
    card.figure ?? "",
    card.caption ?? "",
    card.comparison ? exportedComparison(card.comparison) : "",
  ]);
  return `${[["Card", "Value", "Detail", "Comparison"], ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** The Export file name, carrying the range's first and last day. */
export function exportFileName(range: DashboardRange): string {
  return `dashboard-hiring-${range.start}_to_${range.end}.csv`;
}

export interface HeadcountPoint {
  month: string;
  total: number | null;
}

export interface DepartmentSlice {
  department: string;
  count: number;
}

export interface ActivityItem extends ActivityEvent {
  ago: string;
}

export interface UpcomingInterviewItem {
  id: number;
  applicantName: string;
  jobPostingTitle: string;
  type: UpcomingInterview["type"];
  /** "Today, 4:00 PM" or "Thu, Oct 29, 10:00 AM", in Manila time. */
  when: string;
}

export interface UpcomingInterviewsData {
  /** "2 today, 3 more this week." */
  headline: string;
  /** At most five, soonest first. */
  items: UpcomingInterviewItem[];
}

/** Applications received in the range (`applied`, counted as in the Applicants card) and those that ever reached each later Stage. */
export interface HiringPipelineCounts {
  applied: number;
  screening: number;
  interview: number;
  offer: number;
  hired: number;
}

export interface NeedsAttentionCounts {
  /** Applications at New, and when the oldest of them was received (null with none). */
  toReview: { count: number; oldestAppliedAt: string | null };
  /** Applications at Interview with no Interview booked, and the Job Posting with the most of them (ties by title; null with none). */
  toSchedule: { count: number; topJob: { title: string; count: number } | null };
  /** Interviews that ended with no result recorded. */
  resultsToRecord: number;
}

export interface NeedsAttentionRow {
  id: "review" | "schedule" | "results";
  title: string;
  /** Supporting line; null when there is nothing to say. */
  detail: string | null;
  count: number;
  /** Where Staff act on it. */
  href: string;
  /** True for a zero count: the row stays, muted. */
  muted: boolean;
}

export interface NeedsAttentionData {
  /** "3 things to do today", or "Nothing needs your attention." */
  headline: string;
  /** Always the same three rows, in this order. */
  rows: NeedsAttentionRow[];
}

export interface ApplicantSourceRow {
  source: ApplicationSource;
  count: number;
  /** Whole percent of every Application received in the range; the rows shown add up to 100 (largest remainder), or all 0 with none. */
  percent: number;
  /** Whole percent of this Source's Applications that have reached Hired; null with none from it. */
  hireRate: number | null;
  /** Bar length as a whole percent of the largest count. */
  bar: number;
}

export interface ApplicantSourcesData {
  /** "Facebook brings the most applicants. Referral applicants are hired most often." */
  headline: string;
  /** Largest first; the five Sources always, "Unspecified" only when it has Applications. */
  rows: ApplicantSourceRow[];
}

export interface HiringPipelineBar {
  stage: "Applied" | "Screening" | "Interview" | "Offer" | "Hired";
  count: number;
  /** Whole percent of every Application received in the range. */
  percent: number;
}

export interface HiringPipelineData {
  /** "About 1 in 8 applicants gets hired. Most drop off at Interview." */
  headline: string;
  /** Applied, Screening, Interview, Offer, Hired, in that order. */
  bars: HiringPipelineBar[];
}

export interface ApplicantsByJobRow {
  id: string;
  title: string;
  count: number;
  /** Whole percent of every Application received in the range, not of the top five. */
  percent: number;
  /** Bar length as a whole percent of the largest count. */
  bar: number;
}

export interface ApplicantsByJobData {
  /** "Cashier draws the most applicants this month." */
  headline: string;
  /** At most five, largest first. */
  rows: ApplicantsByJobRow[];
}

/** A Detail Widget and the data it shows; `data` is null when its owning Module has none yet. */
export type DetailWidget = {
  label: string;
  module: Module["name"];
  /** True when the Dashboard Range changes the widget, so it shows a skeleton while the range reloads. */
  rangeDependent?: boolean;
} & (
  | { id: "hiring-pipeline"; data: HiringPipelineData | null }
  | { id: "needs-attention"; data: NeedsAttentionData | null }
  | { id: "applicant-sources"; data: ApplicantSourcesData | null }
  | { id: "applicants-by-job"; data: ApplicantsByJobData | null }
  | { id: "headcount-trend"; data: HeadcountPoint[] | null }
  | { id: "department-distribution"; data: DepartmentSlice[] | null }
  | { id: "recent-activity"; data: ActivityItem[] | null }
  | { id: "upcoming-events"; data: UpcomingEvent[] | null }
  | { id: "upcoming-interviews"; data: UpcomingInterviewsData | null }
);

const TREND_MONTHS = 12;
/** About five items, so the left People block ends level with Headcount Trend. */
const ACTIVITY_LIMIT = 5;
const EVENT_LIMIT = 10;
const INTERVIEW_LIMIT = 5;
const EVENT_WINDOW_DAYS = 30;
const UNASSIGNED = "Unassigned";

/** "YYYY-MM" of the month `offset` months from `now`'s; the Date constructor rolls the year over. */
const monthKey = (now: Date, offset: number) => {
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// Whole local days, so DST shifts cannot move an event across a day boundary.
const dayNumber = (d: Date) => Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_PER_DAY);

function headcountTrend(summary: DashboardSummary, now: Date): HeadcountPoint[] | null {
  const t = summary.totalEmployee;
  const current = t ? t.regular + t.probationary + t.ojt : null;
  const history = new Map((summary.headcountHistory ?? []).map((h) => [h.month, h.total]));
  const points = Array.from({ length: TREND_MONTHS }, (_, i) => {
    const month = monthKey(now, i - (TREND_MONTHS - 1));
    const isCurrent = i === TREND_MONTHS - 1;
    return { month, total: isCurrent ? current : (history.get(month) ?? null) };
  });
  return points.some((p) => p.total !== null) ? points : null;
}

function departmentDistribution(summary: DashboardSummary): DepartmentSlice[] | null {
  const byName = new Map<string, number>();
  for (const { department, count } of summary.departmentCounts ?? []) {
    if (count <= 0) continue;
    const name = department ?? UNASSIGNED;
    byName.set(name, (byName.get(name) ?? 0) + count);
  }
  // Slices must sum to Total Employee: anyone the counts miss has no department on record.
  const t = summary.totalEmployee;
  if (t && byName.size > 0) {
    const counted = [...byName.values()].reduce((sum, c) => sum + c, 0);
    const missing = t.regular + t.probationary + t.ojt - counted;
    if (missing > 0) byName.set(UNASSIGNED, (byName.get(UNASSIGNED) ?? 0) + missing);
  }
  return byName.size > 0
    ? [...byName].map(([department, count]) => ({ department, count }))
    : null;
}

function relativeTime(at: Date, now: Date): string {
  const days = Math.max(0, dayNumber(now) - dayNumber(at));
  return days === 0 ? "Today" : `${days}d ago`;
}

function recentActivity(summary: DashboardSummary, now: Date): ActivityItem[] | null {
  const items = [...(summary.recentActivity ?? [])]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, ACTIVITY_LIMIT)
    .map((e) => ({ ...e, ago: relativeTime(new Date(e.at), now) }));
  return items.length > 0 ? items : null;
}

function upcomingEvents(summary: DashboardSummary, now: Date): UpcomingEvent[] | null {
  const from = dayNumber(now);
  const day = (e: UpcomingEvent) => dayNumber(new Date(`${e.date}T00:00`));
  const items = (summary.upcomingEvents ?? [])
    .filter((e) => e.kind === "holiday" || e.status === "approved")
    .filter((e) => day(e) >= from && day(e) <= from + EVENT_WINDOW_DAYS)
    .sort((a, b) => day(a) - day(b))
    .slice(0, EVENT_LIMIT);
  return items.length > 0 ? items : null;
}

const manilaFormat = (options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", ...options });
const interviewTime = manilaFormat({ hour: "numeric", minute: "2-digit" });
const interviewDay = manilaFormat({ weekday: "short", month: "short", day: "numeric" });

/** The next five Interviews still to start this Manila week, with a headline counting today's and the rest of the week's. Null when none. */
function upcomingInterviews(summary: DashboardSummary, now: Date): UpcomingInterviewsData | null {
  const { week, today } = manilaWeek(now);
  const upcoming = (summary.upcomingInterviews ?? [])
    .map((i) => ({ ...i, at: Date.parse(i.startsAt) }))
    .filter((i) => i.at > now.getTime() && i.at < week.to.getTime())
    .sort((a, b) => a.at - b.at || a.id - b.id);
  if (upcoming.length === 0) return null;
  const todayCount = upcoming.filter((i) => i.at < today.to.getTime()).length;
  const rest = upcoming.length - todayCount;
  const headline =
    rest === 0 ? `${todayCount} today.` : todayCount === 0 ? `None today, ${rest} this week.` : `${todayCount} today, ${rest} more this week.`;
  return {
    headline,
    items: upcoming.slice(0, INTERVIEW_LIMIT).map((i) => {
      const at = new Date(i.at);
      const isToday = i.at < today.to.getTime();
      return {
        id: i.id,
        applicantName: i.applicantName,
        jobPostingTitle: i.jobPostingTitle,
        type: i.type,
        when: `${isToday ? "Today" : interviewDay.format(at)}, ${interviewTime.format(at)}`,
      };
    }),
  };
}

const PIPELINE_STAGES = [
  ["Applied", "applied"],
  ["Screening", "screening"],
  ["Interview", "interview"],
  ["Offer", "offer"],
  ["Hired", "hired"],
] as const;

/**
 * The five pipeline bars with each one's percent of all Applications received, and a headline naming the odds of a
 * hire and the Stage where the most Applications stop (the largest loss to the next bar; the earliest wins a tie).
 * Null when no Application was received.
 */
function hiringPipeline(summary: DashboardSummary, range: DashboardRange): HiringPipelineData | null {
  const counts = summary.hiringPipeline;
  if (!counts || counts.applied === 0) return null;
  const bars = PIPELINE_STAGES.map(([stage, key]) => ({
    stage,
    count: counts[key],
    percent: Math.round((counts[key] / counts.applied) * 100),
  }));
  if (counts.hired === 0) return { headline: `No one has been hired ${range.phrase} yet.`, bars };
  let dropOff = bars[0];
  let largest = -1;
  for (let i = 0; i < bars.length - 1; i++) {
    const loss = Math.max(bars[i].count - bars[i + 1].count, 0);
    if (loss > largest) {
      largest = loss;
      dropOff = bars[i];
    }
  }
  return {
    headline: `About 1 in ${Math.max(Math.round(counts.applied / counts.hired), 1)} applicants gets hired. Most drop off at ${dropOff.stage}.`,
    bars,
  };
}

/** Whole Manila days from `from` to `now`, never below zero. */
function manilaDaysSince(from: string, now: Date): number {
  const OFFSET = 8 * 3600_000;
  const DAY = 86400_000;
  return Math.max(Math.floor((now.getTime() + OFFSET) / DAY) - Math.floor((Date.parse(from) + OFFSET) / DAY), 0);
}

/**
 * The three things Staff should act on now, always in the same order, a zero count muted. The headline sums the counts.
 * Null only when the Module has not been read at all.
 */
function needsAttention(summary: DashboardSummary, now: Date): NeedsAttentionData | null {
  const data = summary.needsAttention;
  if (!data) return null;
  const { toReview, toSchedule, resultsToRecord } = data;
  const ago = toReview.oldestAppliedAt === null ? 0 : manilaDaysSince(toReview.oldestAppliedAt, now);
  const rows: NeedsAttentionRow[] = [
    {
      id: "review",
      title: "Applications to review",
      detail: toReview.count === 0 || toReview.oldestAppliedAt === null ? null : `Oldest applied ${ago === 0 ? "today" : `${plural(ago, "day")} ago`}`,
      count: toReview.count,
      href: applicantsHref({ stage: "New" }),
      muted: toReview.count === 0,
    },
    {
      id: "schedule",
      title: "Interviews to schedule",
      detail: toSchedule.topJob ? `Most waiting: ${toSchedule.topJob.title}` : null,
      count: toSchedule.count,
      href: applicantsHref({ stage: "Interview" }),
      muted: toSchedule.count === 0,
    },
    {
      id: "results",
      title: "Results to record",
      detail: resultsToRecord === 0 ? null : "Interviews that ended with no result",
      count: resultsToRecord,
      href: "/interviews",
      muted: resultsToRecord === 0,
    },
  ];
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return { headline: total === 0 ? "Nothing needs your attention." : `${plural(total, "thing")} to do today`, rows };
}

/** The Sources in the order that breaks ties; "Unspecified" comes last and never wins a headline. */
const SOURCE_ORDER: ApplicationSource[] = [...MANUAL_SOURCES, "Careers page"];
const ALL_SOURCES: ApplicationSource[] = [...SOURCE_ORDER, "Unspecified"];

/** Whole percents of `counts` that add up to exactly 100 (largest remainder, ties to the earlier entry); all 0 when nothing was counted. */
function sharesOf(counts: number[]): number[] {
  const total = counts.reduce((sum, n) => sum + n, 0);
  if (total === 0) return counts.map(() => 0);
  const exact = counts.map((n) => (n / total) * 100);
  const shares = exact.map(Math.floor);
  const order = exact.map((e, i) => ({ i, rest: e - Math.floor(e) })).sort((a, b) => b.rest - a.rest || a.i - b.i);
  for (let k = 0; k < 100 - shares.reduce((sum, n) => sum + n, 0); k++) shares[order[k].i] += 1;
  return shares;
}

/**
 * One row per Source, largest first (ties in Source order): its share of the Applications received in the range, its
 * hire rate and a bar. "Unspecified" is a row only when it has Applications and never wins a headline sentence.
 */
function applicantSources(summary: DashboardSummary): ApplicantSourcesData | null {
  const data = summary.applicantSources;
  if (!data) return null;
  const byName = new Map(data.map((d) => [d.source, d]));
  const present = ALL_SOURCES.filter((source) => SOURCE_ORDER.includes(source) || (byName.get(source)?.count ?? 0) > 0).map((source) => ({
    source,
    count: byName.get(source)?.count ?? 0,
    hired: byName.get(source)?.hired ?? 0,
  }));
  const ranked = [...present].sort((a, b) => b.count - a.count || ALL_SOURCES.indexOf(a.source) - ALL_SOURCES.indexOf(b.source));
  const shares = sharesOf(ranked.map((r) => r.count));
  const largest = ranked[0].count;
  const rows = ranked.map((r, i) => ({
    source: r.source,
    count: r.count,
    percent: shares[i],
    hireRate: r.count === 0 ? null : Math.round((r.hired / r.count) * 100),
    bar: largest === 0 ? 0 : Math.round((r.count / largest) * 100),
  }));

  const named = present.filter((r) => r.source !== "Unspecified");
  const most = named.reduce((best, r) => (r.count > best.count ? r : best), named[0]);
  // Compare hire rates as fractions, so two close rates never tie by rounding; the earlier Source wins a tie.
  const hiring = named
    .filter((r) => r.hired > 0)
    .reduce<(typeof named)[number] | null>((best, r) => (best === null || r.hired * best.count > best.hired * r.count ? r : best), null);
  const first = `${most.count === 0 ? "Careers page" : most.source} brings the most applicants.`;
  return { headline: hiring ? `${first} ${hiring.source} applicants are hired most often.` : first, rows };
}

const BY_JOB_LIMIT = 5;

/** The top Job Postings by Applications received in the range, with percent of all received and bars scaled to the largest. Null when none were received. */
function applicantsByJob(summary: DashboardSummary, range: DashboardRange): ApplicantsByJobData | null {
  const data = summary.applicantsByJob;
  if (!data || data.total === 0 || data.jobs.length === 0) return null;
  const jobs = [...data.jobs].sort((a, b) => b.count - a.count || a.title.localeCompare(b.title) || a.id.localeCompare(b.id)).slice(0, BY_JOB_LIMIT);
  const largest = jobs[0].count;
  return {
    headline: `${jobs[0].title} draws the most applicants ${range.phrase}.`,
    rows: jobs.map((j) => ({
      id: j.id,
      title: j.title,
      count: j.count,
      percent: Math.round((j.count / data.total) * 100),
      bar: Math.round((j.count / largest) * 100),
    })),
  };
}

interface DetailWidgetSpec {
  href: Module["href"];
  build: (summary: DashboardSummary, now: Date) => DetailWidget;
}

const DETAIL_WIDGETS: readonly DetailWidgetSpec[] = [
  {
    href: "/employee-information",
    build: (s, now) => ({
      id: "headcount-trend",
      label: "Headcount Trend",
      module: "Employee Information",
      data: headcountTrend(s, now),
    }),
  },
  {
    href: "/employee-information",
    build: (s) => ({
      id: "department-distribution",
      label: "Department Distribution",
      module: "Employee Information",
      data: departmentDistribution(s),
    }),
  },
  {
    href: "/employee-information",
    build: (s, now) => ({
      id: "recent-activity",
      label: "Recent Activity",
      module: "Employee Information",
      data: recentActivity(s, now),
    }),
  },
  {
    href: "/attendance",
    build: (s, now) => ({
      id: "upcoming-events",
      label: "Upcoming Events",
      module: "Attendance",
      data: upcomingEvents(s, now),
    }),
  },
];

const widgetFor = (
  id: DetailWidget["id"],
  permittedPages: readonly string[],
  summary: DashboardSummary,
  now: Date,
): DetailWidget | null => {
  const spec = DETAIL_WIDGETS.find((w) => w.build({}, now).id === id)!;
  return permittedPages.includes(spec.href) ? spec.build(summary, now) : null;
};

/** The left half of the People block: its cards side by side, Recent Activity below. */
export interface PeopleLeft {
  /** Total Employee and Attendance Rate; a lone card spans both columns. */
  cards: KeySummaryCard[];
  activity: DetailWidget | null;
}

/** Where everything sits on the Dashboard for one Staff member. Absent pieces are left out, never rendered empty. */
export interface DashboardLayout {
  /** Row 1: the hiring cards. */
  hiringCards: KeySummaryCard[];
  /** The People block: `left` and `trend` side by side (2 and 3 of five columns) from `xl`; whichever is alone takes the full width. Null when both are absent. */
  people: { left: PeopleLeft | null; trend: DetailWidget | null } | null;
  /** Rows of hiring Detail Widgets under the People block; none when the Staff member lacks Recruitment and Hiring. */
  hiringRows: DetailWidget[][];
  /** Rows of Detail Widgets below: Department Distribution | Upcoming Events, half and half, a lone one full width. */
  rows: DetailWidget[][];
}

/**
 * The Dashboard layout from the Modules a Staff member holds: hiring cards, the People block, then the
 * Detail Widget rows. Pure: every Module combination is decided here, so the page only draws it.
 */
export function dashboardLayoutFor(
  permittedPages: readonly string[],
  summary: DashboardSummary,
  range: DashboardRange,
  now: Date,
): DashboardLayout {
  const peopleCards = cardsInRow("people", permittedPages, summary, range);
  const activity = widgetFor("recent-activity", permittedPages, summary, now);
  const trend = widgetFor("headcount-trend", permittedPages, summary, now);
  const left = peopleCards.length > 0 || activity ? { cards: peopleCards, activity } : null;
  const bottom = [
    widgetFor("department-distribution", permittedPages, summary, now),
    widgetFor("upcoming-events", permittedPages, summary, now),
  ].filter((w): w is DetailWidget => w !== null);

  const hiringRows: DetailWidget[][] = permittedPages.includes("/job-postings")
    ? [
        [
          { id: "hiring-pipeline", label: "Hiring pipeline", module: "Recruitment and Hiring", rangeDependent: true, data: hiringPipeline(summary, range) },
          { id: "needs-attention", label: "Needs attention", module: "Recruitment and Hiring", data: needsAttention(summary, now) },
        ],
        [
          { id: "applicants-by-job", label: "Applicants by job", module: "Recruitment and Hiring", rangeDependent: true, data: applicantsByJob(summary, range) },
          { id: "applicant-sources", label: "Where applicants come from", module: "Recruitment and Hiring", rangeDependent: true, data: applicantSources(summary) },
          { id: "upcoming-interviews", label: "Upcoming interviews", module: "Recruitment and Hiring", data: upcomingInterviews(summary, now) },
        ],
      ]
    : [];

  return {
    hiringCards: cardsInRow("hiring", permittedPages, summary, range),
    hiringRows,
    people: left || trend ? { left, trend } : null,
    rows: bottom.length > 0 ? [bottom] : [],
  };
}
