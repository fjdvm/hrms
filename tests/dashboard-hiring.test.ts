import { describe, expect, it } from "vitest";
import {
  cardRowsFor,
  dashboardLayoutFor,
  customRangeProblem,
  dashboardRange,
  exportFileName,
  hiringCardsCsv,
  manilaWeek,
  rangeSearch,
  type DashboardSummary,
  type ApplicantsByJobData,
  type HiringPipelineData,
  type NeedsAttentionData,
  type ApplicantSourcesData,
  type UpcomingInterviewsData,
} from "@/lib/dashboard";

const NOW = new Date("2026-10-28T12:05:00Z"); // Wednesday 28 Oct 2026, Manila
const RANGE = dashboardRange(undefined, NOW);

const hiringCard = (label: string, summary: DashboardSummary, range = RANGE) =>
  cardRowsFor(["/job-postings"], summary, range)[0].find((c) => c.label === label)!;

describe("Interviews this week card", () => {
  const interviews = (summary: DashboardSummary) => hiringCard("Interviews this week", summary);

  it("shows the week's count with how many are today", () => {
    expect(interviews({ interviews: { thisWeek: 6, today: 2 } })).toMatchObject({ figure: "6", caption: "2 today", comparison: null });
  });

  it("says None today, and shows 0 rather than Nothing to show yet, when there are no interviews", () => {
    expect(interviews({ interviews: { thisWeek: 0, today: 0 } })).toMatchObject({ figure: "0", caption: "None today" });
  });

  it("has no figure while the data is missing", () => {
    expect(interviews({})).toMatchObject({ figure: null, caption: null });
  });

  it("is not changed by the range", () => {
    expect(interviews({}).rangeDependent).toBe(false);
  });
});

describe("Manila week", () => {
  it("runs Monday to Sunday on Manila days", () => {
    const { week, today } = manilaWeek(NOW);
    expect(week.from.toISOString()).toBe("2026-10-25T16:00:00.000Z"); // Mon 26 Oct 00:00 Manila
    expect(week.to.toISOString()).toBe("2026-11-01T16:00:00.000Z"); // Mon 2 Nov 00:00 Manila
    expect(today.from.toISOString()).toBe("2026-10-27T16:00:00.000Z");
    expect(today.to.toISOString()).toBe("2026-10-28T16:00:00.000Z");
  });

  it("starts the new week at 00:00 Manila, which is still the day before in UTC", () => {
    expect(manilaWeek(new Date("2026-10-25T16:00:00Z")).week.from.toISOString()).toBe("2026-10-25T16:00:00.000Z");
    expect(manilaWeek(new Date("2026-10-25T15:59:00Z")).week.from.toISOString()).toBe("2026-10-18T16:00:00.000Z");
  });

  it("keeps Sunday in the week that started the Monday before", () => {
    expect(manilaWeek(new Date("2026-11-01T10:00:00Z")).week.from.toISOString()).toBe("2026-10-25T16:00:00.000Z");
  });
});

describe("Offer acceptance card", () => {
  const offers = (current: [number, number], previous: [number, number]): DashboardSummary => ({
    offers: { current: { accepted: current[0], decided: current[1] }, previous: { accepted: previous[0], decided: previous[1] } },
  });
  const card = (summary: DashboardSummary) => hiringCard("Offer acceptance", summary);

  it("shows accepted over decided as a whole percent with the counts as its caption", () => {
    expect(card(offers([10, 11], [0, 0]))).toMatchObject({ figure: "91%", caption: "10 of 11 offers accepted" });
    expect(card(offers([2, 3], [0, 0])).figure).toBe("67%");
    expect(card(offers([1, 1], [0, 0]))).toMatchObject({ figure: "100%", caption: "1 of 1 offer accepted" });
  });

  it("shows Nothing to show yet, never 0%, with no decided offers", () => {
    expect(card(offers([0, 0], [3, 4]))).toMatchObject({ figure: null, caption: null, comparison: null });
    expect(card({})).toMatchObject({ figure: null });
  });

  it("shows a real 0% when offers were decided and none accepted", () => {
    expect(card(offers([0, 4], [0, 0])).figure).toBe("0%");
  });

  it("compares in percentage points of the whole percents shown, coloured by direction", () => {
    expect(card(offers([10, 11], [3, 4])).comparison).toEqual({ text: "16 pts vs last month", tone: "good", arrow: "up" });
    expect(card(offers([1, 2], [3, 4])).comparison).toEqual({ text: "25 pts vs last month", tone: "bad", arrow: "down" });
    expect(card(offers([3, 4], [6, 8])).comparison).toEqual({ text: "No change vs last month", tone: "none", arrow: "none" });
    expect(card(offers([3, 4], [2, 5])).comparison?.text).toBe("35 pts vs last month");
  });

  it("omits the comparison unless both periods have decided offers", () => {
    expect(card(offers([3, 4], [0, 0])).comparison).toBeNull();
  });

  it("follows the range", () => {
    expect(card({}).rangeDependent).toBe(true);
  });
});

describe("Average time to hire card", () => {
  const hires = (current: number | null, previous: number | null): DashboardSummary => ({
    timeToHire: {
      current: { hires: current === null ? 0 : 2, averageDays: current },
      previous: { hires: previous === null ? 0 : 2, averageDays: previous },
    },
  });
  const card = (summary: DashboardSummary) => hiringCard("Average time to hire", summary);

  it("shows the mean rounded to a whole number of days, pluralised", () => {
    expect(card(hires(18, null)).figure).toBe("18 days");
    expect(card(hires(17.6, null)).figure).toBe("18 days");
    expect(card(hires(1.2, null)).figure).toBe("1 day");
  });

  it("shows Nothing to show yet, never 0 days, with no hires", () => {
    expect(card(hires(null, 12))).toMatchObject({ figure: null, comparison: null });
    expect(card({})).toMatchObject({ figure: null });
  });

  it("calls a shorter time faster, in green with a down arrow", () => {
    expect(card(hires(18, 22)).comparison).toEqual({ text: "4 days faster than last month", tone: "good", arrow: "down" });
    expect(card(hires(18, 19)).comparison?.text).toBe("1 day faster than last month");
  });

  it("calls a longer time slower, in red with an up arrow", () => {
    expect(card(hires(25, 20)).comparison).toEqual({ text: "5 days slower than last month", tone: "bad", arrow: "up" });
  });

  it("shows no change in grey", () => {
    expect(card(hires(18.2, 17.8)).comparison).toEqual({ text: "No change vs last month", tone: "none", arrow: "none" });
  });

  it("omits the comparison unless both periods have hires, and follows the range", () => {
    expect(card(hires(18, null)).comparison).toBeNull();
    expect(card({}).rangeDependent).toBe(true);
  });

  it("words the comparison for the range's Previous period", () => {
    const year = dashboardRange("year-to-date", NOW);
    expect(hiringCard("Average time to hire", hires(18, 22), year).comparison?.text).toBe("4 days faster than last year");
  });
});

describe("Custom range", () => {
  const custom = (from: unknown, to: unknown) => dashboardRange("custom", NOW, { from, to });

  it("covers both dates, with the Previous period of the same length just before", () => {
    const range = custom("2026-09-01", "2026-10-15");
    expect(range).toMatchObject({ id: "custom", name: "Custom", start: "2026-09-01", end: "2026-10-15", label: "Custom · 1 Sep – 15 Oct 2026" });
    expect(range.from.toISOString()).toBe("2026-08-31T16:00:00.000Z");
    expect(range.to.toISOString()).toBe("2026-10-15T16:00:00.000Z");
    expect(range.previous).toMatchObject({ start: "2026-07-18", end: "2026-08-31", wording: "vs previous period" });
  });

  it("accepts a single day and today", () => {
    expect(custom("2026-10-28", "2026-10-28")).toMatchObject({ id: "custom", start: "2026-10-28", end: "2026-10-28" });
    expect(custom("2026-10-28", "2026-10-28").previous).toMatchObject({ start: "2026-10-27", end: "2026-10-27" });
  });

  it("falls back to This month for anything that is not a valid range", () => {
    for (const [from, to] of [
      ["2026-02-30", "2026-03-01"], // not a real date
      ["2026-1-5", "2026-10-15"], // not YYYY-MM-DD
      ["2026-10-15", "2026-09-01"], // out of order
      ["2026-10-01", "2026-10-29"], // after today in Manila
      ["2025-01-01", "2026-10-28"], // over a year
      [undefined, "2026-10-15"],
      ["2026-09-01", ["2026-10-15"]],
      ["", ""],
    ]) {
      expect(custom(from, to).id).toBe("this-month");
    }
  });

  it("falls back when the range id is custom but no dates came with it", () => {
    expect(dashboardRange("custom", NOW).id).toBe("this-month");
  });

  it("allows a year, and refuses a day more", () => {
    expect(customRangeProblem("2025-10-27", "2026-10-28", NOW)).toBeNull();
    expect(customRangeProblem("2025-10-26", "2026-10-28", NOW)).toBe("too-long");
    expect(customRangeProblem("2026-10-15", "2026-10-29", NOW)).toBe("future");
    expect(customRangeProblem("2026-10-15", "2026-10-14", NOW)).toBe("order");
    expect(customRangeProblem("nope", "2026-10-14", NOW)).toBe("invalid");
  });

  it("is written back to the URL with its two dates", () => {
    expect(rangeSearch(custom("2026-09-01", "2026-10-15"))).toBe("range=custom&from=2026-09-01&to=2026-10-15");
    expect(rangeSearch(RANGE)).toBe("range=this-month");
  });
});

describe("Export", () => {
  it("has one row per hiring card, with an empty Value when a card has nothing to show", () => {
    const summary: DashboardSummary = {
      openJobs: { count: 5, openings: 18, locations: 3 },
      applicants: { current: 132, previous: 100 },
      interviews: { thisWeek: 6, today: 2 },
      offers: { current: { accepted: 10, decided: 11 }, previous: { accepted: 3, decided: 4 } },
      timeToHire: { current: { hires: 0, averageDays: null }, previous: { hires: 2, averageDays: 20 } },
    };
    const csv = hiringCardsCsv(cardRowsFor(["/job-postings"], summary, RANGE)[0]);
    expect(csv.split("\r\n")).toEqual([
      "Card,Value,Detail,Comparison",
      "Open jobs,5,18 openings · 3 locations,",
      "Applicants,132,,+32% vs last month",
      "Interviews this week,6,2 today,",
      "Offer acceptance,91%,10 of 11 offers accepted,+16 pts vs last month",
      "Average time to hire,,,",
      "",
    ]);
  });

  it("quotes cells that hold commas or quotes", () => {
    const card = { label: 'A "b", c', figure: "1", caption: null, comparison: null, module: "Recruitment and Hiring" as const, rangeDependent: false };
    expect(hiringCardsCsv([card])).toBe('Card,Value,Detail,Comparison\r\n"A ""b"", c",1,,\r\n');
  });

  it("is named for the range's dates", () => {
    expect(exportFileName(RANGE)).toBe("dashboard-hiring-2026-10-01_to_2026-10-28.csv");
    expect(exportFileName(dashboardRange("custom", NOW, { from: "2026-09-01", to: "2026-10-15" }))).toBe("dashboard-hiring-2026-09-01_to_2026-10-15.csv");
  });
});

describe("Upcoming interviews widget", () => {
  const widget = (pages: string[], upcomingInterviews: DashboardSummary["upcomingInterviews"], now = NOW) =>
    dashboardLayoutFor(pages, { upcomingInterviews }, RANGE, now).hiringRows.flat().find((w) => w.id === "upcoming-interviews");
  const at = (id: number, startsAt: string, name = `Applicant ${id}`) => ({ id, applicantName: name, jobPostingTitle: "Cashier", type: "Online" as const, startsAt });
  const data = (list: DashboardSummary["upcomingInterviews"], now = NOW) => widget(["/job-postings"], list, now)!.data as UpcomingInterviewsData | null;

  it("is shown only to Staff holding Recruitment and Hiring", () => {
    expect(widget(["/dashboard", "/attendance"], [at(1, "2026-10-28T13:00:00Z")])).toBeUndefined();
    expect(widget(["/job-postings"], [])).toMatchObject({ label: "Upcoming interviews", module: "Recruitment and Hiring" });
  });

  it("lists the next five soonest first and counts all of them in the headline", () => {
    const list = [
      at(7, "2026-10-31T02:00:00Z"), at(1, "2026-10-28T13:00:00Z"), at(2, "2026-10-28T12:30:00Z"),
      at(3, "2026-10-29T02:00:00Z"), at(4, "2026-10-30T02:00:00Z"), at(5, "2026-10-30T03:00:00Z"), at(6, "2026-10-31T01:00:00Z"),
    ];
    const d = data(list)!;
    expect(d.items.map((i) => i.id)).toEqual([2, 1, 3, 4, 5]);
    expect(d.headline).toBe("2 today, 5 more this week.");
  });

  it("words the day and time in Manila time: Today, otherwise weekday and date", () => {
    const d = data([at(1, "2026-10-28T13:00:00Z"), at(2, "2026-10-29T02:30:00Z")])!;
    expect(d.items.map((i) => i.when)).toEqual(["Today, 9:00 PM", "Thu, Oct 29, 10:30 AM"]);
  });

  it("leaves out interviews that started or fall outside the Manila week", () => {
    const d = data([
      at(1, "2026-10-28T12:05:00Z"), // started this minute
      at(2, "2026-10-28T03:00:00Z"), // finished
      at(3, "2026-11-01T15:59:00Z"), // Sun 23:59 Manila: in
      at(4, "2026-11-01T16:00:00Z"), // Mon 00:00 Manila: next week
    ])!;
    expect(d.items.map((i) => i.id)).toEqual([3]);
    expect(d.headline).toBe("None today, 1 this week.");
  });

  it("rolls over to the new week at Manila midnight", () => {
    const sundayNight = new Date("2026-11-01T15:00:00Z"); // Sun 1 Nov 23:00 Manila
    expect(data([at(1, "2026-11-01T15:30:00Z"), at(2, "2026-11-01T16:30:00Z")], sundayNight)!.items.map((i) => i.id)).toEqual([1]);
    expect(data([at(2, "2026-11-01T16:30:00Z")], new Date("2026-11-01T16:00:00Z"))!.items.map((i) => i.id)).toEqual([2]);
  });

  it("says only today when nothing else is left in the week", () => {
    expect(data([at(1, "2026-10-28T13:00:00Z")])!.headline).toBe("1 today.");
  });

  it("has no data, so shows Nothing to show yet, with no interviews or none loaded", () => {
    expect(data([])).toBeNull();
    expect(data(undefined)).toBeNull();
  });

  it("ignores the Dashboard Range", () => {
    const list = [at(1, "2026-10-28T13:00:00Z")];
    const other = dashboardRange("last-month", NOW);
    expect(dashboardLayoutFor(["/job-postings"], { upcomingInterviews: list }, other, NOW).hiringRows).toEqual(
      dashboardLayoutFor(["/job-postings"], { upcomingInterviews: list }, RANGE, NOW).hiringRows,
    );
  });
});

describe("Applicants by job widget", () => {
  const widget = (pages: string[], applicantsByJob: DashboardSummary["applicantsByJob"], range = RANGE) =>
    dashboardLayoutFor(pages, { applicantsByJob }, range, NOW).hiringRows.flat().find((w) => w.id === "applicants-by-job");
  const data = (applicantsByJob: DashboardSummary["applicantsByJob"], range = RANGE) =>
    widget(["/job-postings"], applicantsByJob, range)!.data as ApplicantsByJobData | null;
  const job = (id: string, count: number, title = id) => ({ id, title, count });

  it("is shown only to Staff holding Recruitment and Hiring, and follows the range", () => {
    expect(widget(["/dashboard", "/attendance"], { total: 1, jobs: [job("a", 1)] })).toBeUndefined();
    expect(widget(["/job-postings"], undefined)).toMatchObject({ label: "Applicants by job", module: "Recruitment and Hiring", rangeDependent: true });
  });

  it("takes percent of all Applications in the range, not of the top five, and scales bars to the largest", () => {
    const d = data({ total: 20, jobs: [job("a", 8, "Cashier"), job("b", 4, "Cook"), job("c", 1, "Guard")] })!;
    expect(d.rows).toEqual([
      { id: "a", title: "Cashier", count: 8, percent: 40, bar: 100 },
      { id: "b", title: "Cook", count: 4, percent: 20, bar: 50 },
      { id: "c", title: "Guard", count: 1, percent: 5, bar: 13 },
    ]);
  });

  it("names the top job with the range's wording", () => {
    const summary = { total: 5, jobs: [job("a", 5, "Cashier")] };
    expect(data(summary)!.headline).toBe("Cashier draws the most applicants this month.");
    expect(data(summary, dashboardRange("last-30-days", NOW))!.headline).toBe("Cashier draws the most applicants in the last 30 days.");
    expect(data(summary, dashboardRange("year-to-date", NOW))!.headline).toBe("Cashier draws the most applicants so far this year.");
  });

  it("lists at most five, largest first, ties by title", () => {
    const jobs = [job("f", 1, "F"), job("b", 2, "B"), job("a", 2, "A"), job("c", 1, "C"), job("d", 1, "D"), job("e", 1, "E")];
    const d = data({ total: 8, jobs })!;
    expect(d.rows.map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(d.headline).toBe("A draws the most applicants this month.");
  });

  it("has no data, so shows Nothing to show yet, when no Application was received or none is loaded", () => {
    expect(data({ total: 0, jobs: [] })).toBeNull();
    expect(data(undefined)).toBeNull();
  });
});

describe("Hiring pipeline widget", () => {
  const widget = (pages: string[], hiringPipeline: DashboardSummary["hiringPipeline"], range = RANGE) =>
    dashboardLayoutFor(pages, { hiringPipeline }, range, NOW).hiringRows.flat().find((w) => w.id === "hiring-pipeline");
  const data = (counts: [number, number, number, number, number], range = RANGE) =>
    widget(["/job-postings"], { applied: counts[0], screening: counts[1], interview: counts[2], offer: counts[3], hired: counts[4] }, range)!
      .data as HiringPipelineData | null;

  it("is shown only to Staff holding Recruitment and Hiring, and follows the range", () => {
    expect(widget(["/dashboard", "/attendance"], { applied: 1, screening: 0, interview: 0, offer: 0, hired: 0 })).toBeUndefined();
    expect(widget(["/job-postings"], undefined)).toMatchObject({ label: "Hiring pipeline", module: "Recruitment and Hiring", rangeDependent: true });
  });

  it("shows five bars, each a whole percent of all Applications received", () => {
    expect(data([20, 12, 6, 3, 1])!.bars).toEqual([
      { stage: "Applied", count: 20, percent: 100 },
      { stage: "Screening", count: 12, percent: 60 },
      { stage: "Interview", count: 6, percent: 30 },
      { stage: "Offer", count: 3, percent: 15 },
      { stage: "Hired", count: 1, percent: 5 },
    ]);
  });

  it("names the odds of a hire and the Stage with the largest loss", () => {
    expect(data([20, 12, 6, 3, 1])!.headline).toBe("About 1 in 20 applicants gets hired. Most drop off at Applied.");
    expect(data([20, 18, 6, 4, 2])!.headline).toBe("About 1 in 10 applicants gets hired. Most drop off at Screening.");
    expect(data([20, 18, 16, 4, 2])!.headline).toBe("About 1 in 10 applicants gets hired. Most drop off at Interview.");
    expect(data([20, 18, 16, 14, 2])!.headline).toBe("About 1 in 10 applicants gets hired. Most drop off at Offer.");
  });

  it("gives a tie to the earlier Stage", () => {
    expect(data([10, 8, 6, 4, 2])!.headline).toBe("About 1 in 5 applicants gets hired. Most drop off at Applied.");
  });

  it("never loses a negative amount when a Stage was skipped", () => {
    expect(data([10, 2, 5, 5, 5])!.headline).toBe("About 1 in 2 applicants gets hired. Most drop off at Applied.");
  });

  it("falls back to a neutral line with no hires", () => {
    expect(data([4, 2, 1, 0, 0])!.headline).toBe("No one has been hired this month yet.");
    expect(data([4, 2, 1, 0, 0], dashboardRange("last-30-days", NOW))!.headline).toBe("No one has been hired in the last 30 days yet.");
  });

  it("has no data, so shows its empty state, with no Applications", () => {
    expect(data([0, 0, 0, 0, 0])).toBeNull();
    expect(widget(["/job-postings"], undefined)!.data).toBeNull();
  });
});

describe("Needs attention widget", () => {
  const counts = (toReview: number, toSchedule: number, resultsToRecord: number, extra: Partial<NonNullable<DashboardSummary["needsAttention"]>> = {}) => ({
    toReview: { count: toReview, oldestAppliedAt: toReview ? "2026-10-25T08:00:00Z" : null },
    toSchedule: { count: toSchedule, topJob: toSchedule ? { title: "Cashier", count: toSchedule } : null },
    resultsToRecord,
    ...extra,
  });
  const widget = (pages: string[], needsAttention: DashboardSummary["needsAttention"], range = RANGE) =>
    dashboardLayoutFor(pages, { needsAttention }, range, NOW).hiringRows.flat().find((w) => w.id === "needs-attention");
  const data = (needsAttention: DashboardSummary["needsAttention"], range = RANGE) =>
    widget(["/job-postings"], needsAttention, range)!.data as NeedsAttentionData | null;

  it("is shown only to Staff holding Recruitment and Hiring, and ignores the range", () => {
    expect(widget(["/dashboard", "/attendance"], counts(1, 1, 1))).toBeUndefined();
    expect(widget(["/job-postings"], undefined)).toMatchObject({ label: "Needs attention", module: "Recruitment and Hiring" });
    expect(widget(["/job-postings"], undefined)!.rangeDependent).toBeUndefined();
    expect(data(counts(1, 2, 3), dashboardRange("last-30-days", NOW))).toEqual(data(counts(1, 2, 3)));
  });

  it("lists the three rows in order, each with its count and where Staff act", () => {
    expect(data(counts(4, 2, 1))!.rows.map((r) => [r.id, r.title, r.count, r.href])).toEqual([
      ["review", "Applications to review", 4, "/applicants?stage=New"],
      ["schedule", "Interviews to schedule", 2, "/applicants?stage=Interview"],
      ["results", "Results to record", 1, "/interviews"],
    ]);
  });

  it("says how long ago the oldest Application to review applied, and which Job Posting has most waiting", () => {
    const rows = data(counts(4, 2, 1))!.rows;
    expect(rows[0].detail).toBe("Oldest applied 3 days ago"); // 25 Oct to 28 Oct, Manila
    expect(rows[1].detail).toBe("Most waiting: Cashier");
    expect(data(counts(1, 0, 0, { toReview: { count: 1, oldestAppliedAt: "2026-10-28T01:00:00Z" } }))!.rows[0].detail).toBe("Oldest applied today");
    expect(data(counts(1, 0, 0, { toReview: { count: 1, oldestAppliedAt: "2026-10-27T01:00:00Z" } }))!.rows[0].detail).toBe("Oldest applied 1 day ago");
  });

  it("sums the counts in the headline", () => {
    expect(data(counts(4, 2, 1))!.headline).toBe("7 things to do today");
    expect(data(counts(0, 0, 1))!.headline).toBe("1 thing to do today");
  });

  it("keeps a zero row, muted, and sums only what is above zero", () => {
    const d = data(counts(3, 0, 0))!;
    expect(d.rows.map((r) => r.muted)).toEqual([false, true, true]);
    expect(d.headline).toBe("3 things to do today");
    expect(d.rows[1].detail).toBeNull();
  });

  it("says nothing needs attention when every count is zero, and shows its empty state without data", () => {
    const d = data(counts(0, 0, 0))!;
    expect(d.headline).toBe("Nothing needs your attention.");
    expect(d.rows.every((r) => r.muted)).toBe(true);
    expect(widget(["/job-postings"], undefined)!.data).toBeNull();
  });
});

describe("Where applicants come from widget", () => {
  type Row = NonNullable<DashboardSummary["applicantSources"]>[number];
  const row = (source: Row["source"], count: number, hired = 0): Row => ({ source, count, hired });
  const widget = (pages: string[], applicantSources: DashboardSummary["applicantSources"], range = RANGE) =>
    dashboardLayoutFor(pages, { applicantSources }, range, NOW).hiringRows.flat().find((w) => w.id === "applicant-sources");
  const data = (applicantSources: Row[], range = RANGE) => widget(["/job-postings"], applicantSources, range)!.data as ApplicantSourcesData;

  it("is shown only to Staff holding Recruitment and Hiring, and follows the range", () => {
    expect(widget(["/dashboard", "/attendance"], [row("Facebook", 1)])).toBeUndefined();
    expect(widget(["/job-postings"], undefined)).toMatchObject({ label: "Where applicants come from", module: "Recruitment and Hiring", rangeDependent: true });
    expect(widget(["/job-postings"], undefined)!.data).toBeNull();
  });

  it("shows the five Sources, largest share first, ties in Source order", () => {
    const d = data([row("Careers page", 4), row("Facebook", 2), row("Walk-in", 2), row("JobStreet", 1)]);
    expect(d.rows.map((r) => [r.source, r.count])).toEqual([
      ["Careers page", 4], ["Facebook", 2], ["Walk-in", 2], ["JobStreet", 1], ["Referral", 0],
    ]);
  });

  it("makes the shares add up to 100, and scales bars to the largest", () => {
    const d = data([row("Facebook", 1), row("JobStreet", 1), row("Walk-in", 1)]); // 33.3 each would sum to 99
    expect(d.rows.map((r) => r.percent)).toEqual([34, 33, 33, 0, 0]);
    expect(d.rows.reduce((sum, r) => sum + r.percent, 0)).toBe(100);
    const e = data([row("Careers page", 8), row("Facebook", 2)]);
    expect(e.rows.slice(0, 2).map((r) => [r.percent, r.bar])).toEqual([[80, 100], [20, 25]]);
  });

  it("takes hire rate as the Source's own hires over its own Applications", () => {
    const d = data([row("Careers page", 8, 2), row("Facebook", 3, 1), row("Referral", 0)]);
    expect(Object.fromEntries(d.rows.map((r) => [r.source, r.hireRate]))).toMatchObject({ "Careers page": 25, Facebook: 33, Referral: null });
  });

  it("shows Unspecified only when it has Applications, and counts it in the shares", () => {
    expect(data([row("Facebook", 1)]).rows.map((r) => r.source)).not.toContain("Unspecified");
    const d = data([row("Facebook", 3), row("Unspecified", 1)]);
    expect(d.rows.map((r) => [r.source, r.percent])).toEqual([["Facebook", 75], ["Unspecified", 25], ["JobStreet", 0], ["Walk-in", 0], ["Referral", 0], ["Careers page", 0]]);
    expect(d.rows.reduce((sum, r) => sum + r.percent, 0)).toBe(100);
  });

  it("names the Source with the most Applications and the one hired most often", () => {
    expect(data([row("Facebook", 6, 0), row("Referral", 2, 1), row("Walk-in", 4, 1)]).headline).toBe(
      "Facebook brings the most applicants. Referral applicants are hired most often.",
    );
  });

  it("gives ties for most Applications and for best hire rate to the first Source in order", () => {
    expect(data([row("Walk-in", 2, 1), row("JobStreet", 2, 1), row("Facebook", 2, 0)]).headline).toBe(
      "Facebook brings the most applicants. JobStreet applicants are hired most often.",
    );
  });

  it("compares hire rates exactly, not rounded", () => {
    // 33.44% against 33.33%: both show as 33%, but the exact rates are not a tie.
    expect(data([row("Facebook", 3, 1), row("JobStreet", 299, 100)]).headline).toBe("JobStreet brings the most applicants. JobStreet applicants are hired most often.");
  });

  it("falls back when nothing was received, and leaves out the second sentence with no hires", () => {
    expect(data([]).headline).toBe("Careers page brings the most applicants.");
    expect(data([]).rows.every((r) => r.percent === 0 && r.hireRate === null)).toBe(true);
    expect(data([row("Facebook", 3), row("Walk-in", 1)]).headline).toBe("Facebook brings the most applicants.");
  });

  it("never lets Unspecified win a sentence, even when it is the largest", () => {
    const d = data([row("Unspecified", 9, 9), row("Facebook", 2, 1)]);
    expect(d.headline).toBe("Facebook brings the most applicants. Facebook applicants are hired most often.");
    expect(d.rows[0].source).toBe("Unspecified");
    expect(data([row("Unspecified", 5, 1)]).headline).toBe("Careers page brings the most applicants.");
  });
});
