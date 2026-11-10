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

  let start: Date, end: Date, previousStart: Date, previousEnd: Date, wording: string;
  if (customRange) {
    start = parseDay(customRange.from)!;
    end = parseDay(customRange.to)!;
    const length = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1;
    previousEnd = addDays(start, -1);
    previousStart = addDays(previousEnd, 1 - length);
    wording = "vs previous period";
  } else if (rangeId === "this-month") {
    start = day(y, mo, 1);
    end = today;
    previousStart = day(y, mo - 1, 1);
    previousEnd = monthsBack(today, 1);
    wording = "vs last month";
  } else if (rangeId === "last-month") {
    start = day(y, mo - 1, 1);
    end = day(y, mo, 0);
    previousStart = day(y, mo - 2, 1);
    previousEnd = day(y, mo - 1, 0);
    wording = "vs month before";
  } else if (rangeId === "year-to-date") {
    start = day(y, 0, 1);
    end = today;
    previousStart = day(y - 1, 0, 1);
    previousEnd = monthsBack(today, 12);
    wording = "vs last year";
  } else {
    const days = rangeId === "last-30-days" ? 30 : 90;
    start = addDays(today, 1 - days);
    end = today;
    previousStart = addDays(start, -days);
    previousEnd = addDays(start, -1);
    wording = `vs previous ${days} days`;
  }

  const name = rangeId === "custom" ? "Custom" : RANGE_OPTIONS.find((o) => o.id === rangeId)!.name;
  return {
    id: rangeId,
    name,
    label: `${name} · ${periodLabel(start, end)}`,
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

/** A Detail Widget and the data it shows; `data` is null when its owning Module has none yet. */
export type DetailWidget = {
  label: string;
  module: Module["name"];
} & (
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
  /** Rows of hiring Detail Widgets under the hiring cards; none when the Staff member lacks Recruitment and Hiring. */
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
    ? [[{ id: "upcoming-interviews", label: "Upcoming interviews", module: "Recruitment and Hiring", data: upcomingInterviews(summary, now) }]]
    : [];

  return {
    hiringCards: cardsInRow("hiring", permittedPages, summary, range),
    hiringRows,
    people: left || trend ? { left, trend } : null,
    rows: bottom.length > 0 ? [bottom] : [],
  };
}
