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
