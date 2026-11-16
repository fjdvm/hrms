import { describe, expect, it } from "vitest";
import { evaluationHref, importText, inTab, matchesSearch, notScoredText, pickPeriod, profileHref, scoreText, shiftText, statusBadge } from "@/lib/performance-list";

const p = (id: number, start: string, end: string) => ({ id, start, end });
const PERIODS = [p(3, "2026-12-01", "2026-12-31"), p(2, "2026-11-01", "2026-11-30"), p(1, "2026-09-01", "2026-09-30")];

describe("which period the list opens on", () => {
  it("opens the one asked for when it exists", () => {
    expect(pickPeriod(PERIODS, "2026-11-16", "1")?.id).toBe(1);
    expect(pickPeriod(PERIODS, "2026-11-16", "99")?.id).toBe(2);
    expect(pickPeriod(PERIODS, "2026-11-16", "abc")?.id).toBe(2);
  });

  it("opens the period that holds today, else the latest that has started, else the earliest to come", () => {
    expect(pickPeriod(PERIODS, "2026-11-16")?.id).toBe(2);
    expect(pickPeriod(PERIODS, "2026-10-15")?.id).toBe(1);
    expect(pickPeriod(PERIODS, "2026-08-01")?.id).toBe(1);
    expect(pickPeriod([], "2026-11-16")).toBeUndefined();
  });
});

describe("row text", () => {
  it("writes the shift as Figma does, with minutes only when there are some", () => {
    expect(shiftText({ start: "06:00", end: "14:00" })).toBe("6 AM – 2 PM");
    expect(shiftText({ start: "08:30", end: "17:00" })).toBe("8:30 AM – 5 PM");
    expect(shiftText({ start: "00:00", end: "12:00" })).toBe("12 AM – 12 PM");
    expect(shiftText(null)).toBe("Not set");
  });

  it("shows a score to one decimal, Insufficient data only once attendance is in, and a dash otherwise", () => {
    const imported = { imported: true, confirmedNone: false, openIssues: 0 };
    const none = { imported: false, confirmedNone: false, openIssues: 0 };
    expect(scoreText({ score: { outcome: "scored", value: 93 }, attendance: imported })).toBe("93.0");
    expect(scoreText({ score: { outcome: "scored", value: 88.44 }, attendance: imported })).toBe("88.4");
    expect(scoreText({ score: { outcome: "insufficient-data" }, attendance: imported })).toBe("Insufficient data");
    expect(scoreText({ score: { outcome: "insufficient-data" }, attendance: none })).toBe("—");
    expect(scoreText({ score: { outcome: "not-scored", reason: "shift-missing" }, attendance: none })).toBe("—");
  });

  it("says whether attendance is imported, with a marker for open issues", () => {
    expect(importText({ imported: true, confirmedNone: false, openIssues: 0 })).toEqual({ label: "Imported", issues: null });
    expect(importText({ imported: true, confirmedNone: false, openIssues: 2 })).toEqual({ label: "Imported", issues: "2 issues" });
    expect(importText({ imported: true, confirmedNone: false, openIssues: 1 }).issues).toBe("1 issue");
    expect(importText({ imported: false, confirmedNone: false, openIssues: 0 }).label).toBe("Not imported");
    expect(importText({ imported: false, confirmedNone: true, openIssues: 0 }).label).toBe("No attendance");
  });

  it("badges the status, and a missing shift as Not scored whatever the status", () => {
    const scored = { outcome: "scored", value: 90 } as const;
    expect(statusBadge({ status: "Evaluated", score: scored })).toEqual({ label: "Evaluated", tone: "success" });
    expect(statusBadge({ status: "In review", score: scored })).toEqual({ label: "In review", tone: "warning" });
    expect(statusBadge({ status: "Draft", score: scored })).toEqual({ label: "Draft", tone: "secondary" });
    expect(statusBadge({ status: "Draft", score: { outcome: "not-scored", reason: "shift-missing" } })).toEqual({ label: "Not scored: shift missing", tone: "destructive" });
  });
});

describe("narrowing the rows", () => {
  it("filters by tab, All being everyone", () => {
    expect(inTab({ status: "Draft" }, "All")).toBe(true);
    expect(inTab({ status: "Draft" }, "Draft")).toBe(true);
    expect(inTab({ status: "Draft" }, "In review")).toBe(false);
    expect(inTab({ status: "Evaluated" }, "Evaluated")).toBe(true);
  });

  it("searches by name or employee number, ignoring case and extra spaces", () => {
    const row = { name: "Mylene Santos", employeeNumber: "BR-EMP-0012" };
    expect(matchesSearch(row, "")).toBe(true);
    expect(matchesSearch(row, "  mylene   SANTOS ")).toBe(true);
    expect(matchesSearch(row, "emp-0012")).toBe(true);
    expect(matchesSearch(row, "carla")).toBe(false);
  });
});

describe("links and the warning line", () => {
  it("builds the evaluation and profile links", () => {
    expect(evaluationHref(12, 2)).toBe("/performance/evaluation/12?period=2");
    expect(profileHref(12)).toBe("/employee-information/12");
  });

  it("words the warning as Figma does, naming up to three people", () => {
    expect(notScoredText([{ name: "Patricia Gomez" }])).toBe("1 employee is not scored: shift missing (Patricia Gomez)");
    expect(notScoredText([{ name: "A" }, { name: "B" }])).toBe("2 employees are not scored: shift missing (A, B)");
    expect(notScoredText([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }])).toBe("5 employees are not scored: shift missing (A, B, C and 2 more)");
  });
});
