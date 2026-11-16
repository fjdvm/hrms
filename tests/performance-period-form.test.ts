import { describe, expect, it } from "vitest";
import { countNonWorking, dateLabel, findOverlap, monthChoices, nonWorkingText, periodsHolding, quarterChoices, rangeLabel, readGrace } from "@/lib/performance-period-form";
import { overlapMessage } from "@/lib/performance-period-messages";

const company = (start: string, end: string, name: string) => ({ kind: "Company" as const, start, end, name });

describe("range labels", () => {
  it("writes a month, a span within a year and a span across years the way Figma does", () => {
    expect(rangeLabel({ start: "2026-11-01", end: "2026-11-30" })).toBe("1 – 30 Nov 2026");
    expect(rangeLabel({ start: "2026-10-01", end: "2026-12-31" })).toBe("1 Oct – 31 Dec 2026");
    expect(rangeLabel({ start: "2026-12-01", end: "2027-01-31" })).toBe("1 Dec 2026 – 31 Jan 2027");
    expect(dateLabel("2026-11-30")).toBe("Mon 30 Nov 2026");
    expect(dateLabel("2026-11-30", false)).toBe("Mon 30 Nov");
  });
});

describe("Month and Quarter choices", () => {
  it("fill the dates, in order, around today", () => {
    const months = monthChoices("2026-11-16");
    expect(months[0].range).toEqual({ start: "2026-05-01", end: "2026-05-31" });
    expect(months.find((m) => m.name === "November 2026")?.range).toEqual({ start: "2026-11-01", end: "2026-11-30" });
    expect(months.at(-1)?.name).toBe("November 2027");
    const quarters = quarterChoices("2026-11-16");
    expect(quarters.find((q) => q.name === "Q4 2026")?.range).toEqual({ start: "2026-10-01", end: "2026-12-31" });
    expect(quarters[0].name).toBe("Q2 2026");
    expect(quarters.map((q) => q.range.start)).toEqual([...quarters.map((q) => q.range.start)].sort());
  });
});

describe("overlap", () => {
  const periods = [company("2026-11-01", "2026-11-30", "November 2026")];

  it("finds a period that shares even one day, and none that only touches", () => {
    expect(findOverlap({ start: "2026-10-01", end: "2026-12-31" }, periods)?.name).toBe("November 2026");
    expect(findOverlap({ start: "2026-11-30", end: "2026-12-05" }, periods)?.name).toBe("November 2026");
    expect(findOverlap({ start: "2026-12-01", end: "2026-12-31" }, periods)).toBeUndefined();
    expect(findOverlap({ start: "2026-10-01", end: "2026-10-31" }, periods)).toBeUndefined();
    expect(findOverlap(null, periods)).toBeUndefined();
  });

  it("words the error as the Overlap frame does", () => {
    expect(overlapMessage({ name: "November 2026", start: "2026-11-01", end: "2026-11-30" })).toBe("Overlaps November 2026 (1 – 30 Nov 2026).");
  });
});

describe("non-working dates in a period", () => {
  it("counts the calendar dates inside the range, both ends included", () => {
    const dates = ["2026-10-31", "2026-11-01", "2026-11-30", "2026-12-01"];
    expect(countNonWorking({ start: "2026-11-01", end: "2026-11-30" }, dates)).toBe(2);
    expect(countNonWorking(null, dates)).toBe(0);
    expect(nonWorkingText(1)).toBe("1 non-working date in this period");
    expect(nonWorkingText(7)).toBe("7 non-working dates in this period");
  });

  it("names the periods a date falls in", () => {
    const periods = [company("2026-11-01", "2026-11-30", "November 2026"), company("2026-12-01", "2026-12-31", "December 2026")];
    expect(periodsHolding("2026-11-30", periods).map((p) => p.name)).toEqual(["November 2026"]);
    expect(periodsHolding("2027-01-01", periods)).toEqual([]);
  });
});

describe("the grace period", () => {
  it("takes whole minutes from 0 to 120", () => {
    expect(readGrace("10")).toEqual({ minutes: 10, error: null });
    expect(readGrace(" 0 ")).toEqual({ minutes: 0, error: null });
    expect(readGrace("120").minutes).toBe(120);
  });

  it("refuses anything else with a message instead of changing it", () => {
    for (const text of ["", "  ", "1.5", "-1", "ten", "10 min", "1e2", "٣"]) expect(readGrace(text).minutes).toBeNull();
    expect(readGrace("").error).toBe("Enter the grace period in whole minutes.");
    expect(readGrace("1.5").error).toBe("Grace period can only be whole minutes, digits only.");
    expect(readGrace("121").error).toBe("Grace period is at most 120 minutes.");
  });
});
