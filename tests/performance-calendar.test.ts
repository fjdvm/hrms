import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { daySpan, eachDay, isCalendarDate, isoWeekday, monthRange, periodName, quarterRange, scheduledDays } from "@/lib/performance-calendar";

// November 2026: the 1st is a Sunday, so it has 5 Sundays (1, 8, 15, 22, 29), 4 Saturdays (7, 14, 21, 28) and 30 days.
// Weekdays (Mon-Fri): 21. Mon-Sat: 25. Nov 30 is a Monday.
const NOV = { periodStart: "2026-11-01", periodEnd: "2026-11-30", employeeStart: "2026-01-05" };
const MON_FRI = [1, 2, 3, 4, 5];
const MON_SAT = [1, 2, 3, 4, 5, 6];

describe("calendar dates", () => {
  it("knows real dates", () => {
    expect(["2026-11-16", "2028-02-29", "2000-01-01"].every(isCalendarDate)).toBe(true);
    expect(["2026-02-30", "2027-02-29", "2026-13-01", "2026-11-1", "Nov 1", "", null, 20261101].some(isCalendarDate)).toBe(false);
  });

  it("works out the ISO weekday from the date itself", () => {
    expect(isoWeekday("2026-11-16")).toBe(1); // Monday
    expect(isoWeekday("2026-11-21")).toBe(6); // Saturday
    expect(isoWeekday("2026-11-15")).toBe(7); // Sunday
    expect(isoWeekday("2028-02-29")).toBe(2); // a leap day, a Tuesday
  });

  it("lists days inclusively, in order", () => {
    expect(eachDay("2026-11-29", "2026-12-02")).toEqual(["2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02"]);
    expect(eachDay("2026-11-30", "2026-11-30")).toEqual(["2026-11-30"]);
    expect(eachDay("2026-12-01", "2026-11-30")).toEqual([]);
    expect(daySpan("2026-11-01", "2026-11-30")).toBe(30);
    expect(daySpan("2026-11-30", "2026-11-30")).toBe(1);
  });
});

describe("what a Month and a Quarter cover", () => {
  it("fills the dates of a month, including leap February and year ends", () => {
    expect(monthRange(2026, 11)).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(monthRange(2026, 2)).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthRange(2028, 2)).toEqual({ start: "2028-02-01", end: "2028-02-29" });
    expect(monthRange(2026, 12)).toEqual({ start: "2026-12-01", end: "2026-12-31" });
  });

  it("fills the dates of a calendar quarter", () => {
    expect(quarterRange(2026, 1)).toEqual({ start: "2026-01-01", end: "2026-03-31" });
    expect(quarterRange(2026, 2)).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(quarterRange(2026, 3)).toEqual({ start: "2026-07-01", end: "2026-09-30" });
    expect(quarterRange(2026, 4)).toEqual({ start: "2026-10-01", end: "2026-12-31" });
  });

  it("names a period", () => {
    expect(periodName({ type: "Month", start: "2026-11-01", end: "2026-11-30" })).toBe("November 2026");
    expect(periodName({ type: "Quarter", start: "2026-10-01", end: "2026-12-31" })).toBe("Q4 2026");
    expect(periodName({ type: "Quarter", start: "2026-01-01", end: "2026-03-31" })).toBe("Q1 2026");
    expect(periodName({ type: "Custom", start: "2026-11-03", end: "2026-12-20" })).toBe("3 Nov – 20 Dec 2026");
    expect(periodName({ type: "Custom", start: "2026-12-15", end: "2027-01-14" })).toBe("15 Dec 2026 – 14 Jan 2027");
  });
});

describe("scheduled days", () => {
  it("counts a Mon–Fri Employee's weekdays and a Mon–Sat Employee's Mon to Sat across a month", () => {
    const fri = scheduledDays({ ...NOV, workingDays: MON_FRI, nonWorkingDates: [] });
    const sat = scheduledDays({ ...NOV, workingDays: MON_SAT, nonWorkingDates: [] });

    expect(fri).toHaveLength(21);
    expect(sat).toHaveLength(25);
    expect(fri[0]).toBe("2026-11-02");
    expect(fri.at(-1)).toBe("2026-11-30");
    expect(fri).not.toContain("2026-11-07");
    expect(sat).toContain("2026-11-07");
    expect(sat).not.toContain("2026-11-08");
  });

  it("starts counting from the Employee's start date for a mid-period joiner", () => {
    const fri = scheduledDays({ ...NOV, employeeStart: "2026-11-16", workingDays: MON_FRI, nonWorkingDates: [] });
    const sat = scheduledDays({ ...NOV, employeeStart: "2026-11-16", workingDays: MON_SAT, nonWorkingDates: [] });

    expect(fri).toHaveLength(11);
    expect(fri[0]).toBe("2026-11-16");
    expect(sat).toHaveLength(13);
    // The start date itself counts when it is a Working day, and a day off start is skipped to the next Working day.
    expect(scheduledDays({ ...NOV, employeeStart: "2026-11-14", workingDays: MON_FRI, nonWorkingDates: [] })[0]).toBe("2026-11-16");
  });

  it("schedules nothing for an Employee who starts after the period ends, and everything for one who started before", () => {
    expect(scheduledDays({ ...NOV, employeeStart: "2026-12-01", workingDays: MON_FRI, nonWorkingDates: [] })).toEqual([]);
    expect(scheduledDays({ ...NOV, employeeStart: "2026-11-30", workingDays: MON_FRI, nonWorkingDates: [] })).toEqual(["2026-11-30"]);
    expect(scheduledDays({ ...NOV, employeeStart: "2020-01-01", workingDays: MON_FRI, nonWorkingDates: [] })).toHaveLength(21);
  });

  it("takes a holiday off a Working day, and ignores one on a day the Employee does not work", () => {
    // Nov 30 (Monday): a Working day for both. Nov 7 (Saturday): a Working day for Mon–Sat only. Nov 8 (Sunday): for neither.
    expect(scheduledDays({ ...NOV, workingDays: MON_FRI, nonWorkingDates: ["2026-11-30"] })).toHaveLength(20);
    expect(scheduledDays({ ...NOV, workingDays: MON_SAT, nonWorkingDates: ["2026-11-30"] })).toHaveLength(24);
    expect(scheduledDays({ ...NOV, workingDays: MON_FRI, nonWorkingDates: ["2026-11-07"] })).toHaveLength(21);
    expect(scheduledDays({ ...NOV, workingDays: MON_SAT, nonWorkingDates: ["2026-11-07"] })).toHaveLength(24);
    expect(scheduledDays({ ...NOV, workingDays: MON_SAT, nonWorkingDates: ["2026-11-08"] })).toHaveLength(25);
    expect(scheduledDays({ ...NOV, workingDays: MON_FRI, nonWorkingDates: ["2026-11-08", "2026-12-25", "2026-10-31"] })).toHaveLength(21);
  });

  it("does not mind how the calendar or Working days are ordered or repeated", () => {
    const a = scheduledDays({ ...NOV, workingDays: [5, 1, 3, 2, 4, 1], nonWorkingDates: ["2026-11-30", "2026-11-02", "2026-11-30"] });
    const b = scheduledDays({ ...NOV, workingDays: MON_FRI, nonWorkingDates: ["2026-11-02", "2026-11-30"] });

    expect(a).toEqual(b);
    expect(a).toHaveLength(19);
  });

  it("is a pure function: it imports nothing and reads no clock", () => {
    const source = readFileSync(new URL("../lib/performance-calendar.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/new Date\(\)|Date\.now\(/);
  });
});
