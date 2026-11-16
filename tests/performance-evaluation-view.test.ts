import { describe, expect, it } from "vitest";
import { bannerText, checklist, dayMonth, dayMonthYear, submitSummary, lineFigures, overallFigures, percentText, periodFigures, scoreHeadline } from "@/lib/performance-evaluation-view";
import { submitReadiness } from "@/lib/performance-evaluations-terms";
import type { EvaluationDetail, KpiLine } from "@/lib/performance-evaluations";
import { checkComments, checkRating, ratingMessage } from "@/lib/performance-rating-terms";

const line = (id: KpiLine["id"], extra: Partial<KpiLine> = {}): KpiLine => ({
  id, name: id, description: "desc", source: "Attendance import", target: "100%", status: "scored", result: 96.2, weight: 30, weightUsed: 30, points: 28.9, reason: null, flag: null, ...extra,
});
const RATING = { value: 85, comments: "Good", savedByName: "Ada Okafor", savedAt: "2026-11-30T02:00:00Z" };
const base = {
  shift: { start: "06:00", end: "14:00", workingDays: [1, 2, 3, 4, 5, 6] }, rating: RATING as EvaluationDetail["rating"], score: { outcome: "scored", value: 93 } as EvaluationDetail["score"],
  counts: { counted: 26, present: 25, late: 3, earlyOut: 1 }, issues: [], submitted: null,
  attendance: { imported: true, confirmedNone: false, openIssues: 0 },
  submit: submitReadiness({ attendanceImported: true, shiftSet: true, openIssues: 0, ratingEntered: true }),
};
const kpis = [line("attendanceRate"), line("punctuality", { weight: 25, weightUsed: 25, points: 22 }), line("fullShift", { weight: 15, weightUsed: 15, points: 14.4 }), line("trainingCompletion", { weight: 15, weightUsed: 15, points: 15 }), line("evaluatorRating", { weight: 15, weightUsed: 15, points: 12.8 })];

describe("the banner", () => {
  it("says Submit is unlocked when every check passes", () => {
    expect(bannerText(base)).toBe("Submit is unlocked: attendance is imported, the shift is set, attendance issues are resolved and the rating is entered. Submitting locks this evaluation.");
  });

  it("names the missing rating and what is met, as in the Submit locked frame", () => {
    const submit = submitReadiness({ attendanceImported: true, shiftSet: true, openIssues: 0, ratingEntered: false });
    expect(bannerText({ ...base, submit })).toBe("Submit is locked: the rating is not entered yet. Attendance is imported, the shift is set and attendance issues are resolved.");
  });

  it("names every missing check, with how many attendance issues are open", () => {
    const submit = submitReadiness({ attendanceImported: false, shiftSet: false, openIssues: 2, ratingEntered: false });
    expect(bannerText({ ...base, submit, attendance: { imported: false, confirmedNone: false, openIssues: 2 } }))
      .toBe("Submit is locked: attendance is not imported yet, the shift is not set, 2 attendance issues are open and the rating is not entered yet. Resolve each one below, or re-import a corrected file.");
    const one = submitReadiness({ attendanceImported: true, shiftSet: true, openIssues: 1, ratingEntered: true });
    expect(bannerText({ ...base, submit: one, attendance: { imported: true, confirmedNone: false, openIssues: 1 } })).toMatch(/^Submit is locked: 1 attendance issue is open\. Resolve each one below, or re-import a corrected file\. Attendance is imported/);
  });

  it("says when and by whom a submitted evaluation was locked", () => {
    expect(bannerText({ ...base, submitted: { submittedByName: "Ada Okafor", submittedAt: "2026-11-30 02:00:00+00" } })).toBe("Evaluated and locked on 30 Nov 2026 by Ada Okafor. The score, KPI results and weights used are saved.");
  });
});

describe("the KPI lines", () => {
  const detail = { counts: base.counts, rating: base.rating, shift: base.shift, score: base.score };

  it("explains each attendance KPI with the day counts, and the rating with who entered it", () => {
    expect(lineFigures(detail, kpis[0])).toEqual({ result: "96.2", weight: "30%", points: "28.9", note: "25 of 26 days present" });
    expect(lineFigures(detail, kpis[1]).note).toBe("3 late of 25 present");
    expect(lineFigures(detail, kpis[2]).note).toBe("1 early-out of 25");
    expect(lineFigures(detail, kpis[4]).note).toBe("Entered by Ada Okafor");
  });

  it("shows a Not-applicable Training result with the rescaled weights of the others", () => {
    const training = line("trainingCompletion", { status: "not-applicable", result: null, weightUsed: null, points: null, reason: "no-training-due" });
    expect(lineFigures(detail, training)).toEqual({ result: "Not applicable", weight: "—", points: "—", note: "No Training due in this period" });
    expect(lineFigures(detail, line("attendanceRate", { weight: 30, weightUsed: 35.294, points: 34 }))).toMatchObject({ weight: "35.3%", points: "34.0" });
  });

  it("flags Results not marked beside the Training note", () => {
    expect(lineFigures(detail, line("trainingCompletion", { flag: "Results not marked" })).note).toBe("desc · Results not marked");
  });

  it("while the rating is missing shows the other rows with their own weights and points, and a dash for the rating", () => {
    const missing = { ...detail, rating: null };
    const rating = line("evaluatorRating", { status: "not-applicable", result: null, weightUsed: null, points: null, reason: "no-rating", weight: 15 });
    expect(lineFigures(missing, line("attendanceRate", { weightUsed: 35.3, points: 34 }))).toMatchObject({ weight: "30%", points: "28.9" });
    expect(lineFigures(missing, rating)).toEqual({ result: "—", weight: "15%", points: "—", note: "Not entered yet" });
  });
});

describe("the headline and overall row", () => {
  it("shows the score out of 100, 'incomplete' without a rating, Insufficient data and the missing shift", () => {
    expect(scoreHeadline(base)).toBe("93.0 / 100");
    expect(scoreHeadline({ ...base, rating: null })).toBe("incomplete");
    expect(scoreHeadline({ ...base, score: { outcome: "insufficient-data" } })).toBe("Insufficient data");
    expect(scoreHeadline({ ...base, shift: null, rating: null, score: { outcome: "not-scored", reason: "shift-missing" } })).toBe("Not scored: shift missing");
  });

  it("says the score was rescaled when a KPI is left out", () => {
    expect(overallFigures({ ...base, kpis })).toEqual({ score: "93.0 / 100", note: "Sum of the weighted results" });
    const rescaled = [...kpis.slice(0, 3), line("trainingCompletion", { status: "not-applicable", result: null, weightUsed: null, points: null, reason: "no-training-due", weight: 15 }), kpis[4]];
    expect(overallFigures({ ...base, kpis: rescaled })).toEqual({ score: "93.0 / 100", note: "Rescaled from 85%" });
    expect(overallFigures({ ...base, kpis, rating: null }).score).toBe("Incomplete");
    expect(percentText(35.2941)).toBe("35.3%");
    expect(percentText(30)).toBe("30%");
  });
});

describe("the checklist and period card", () => {
  it("shows each check's state and detail, with how many issues are open", () => {
    const items = checklist(base);
    expect(items.map((c) => [c.label, c.passed, c.detail])).toEqual([
      ["Attendance imported", true, "25 days matched"], ["Shift set", true, "6 AM – 2 PM · Mon, Tue, Wed, Thu, Fri, Sat"],
      ["Attendance issues resolved", true, "No open issues"], ["Rating entered", true, "85 / 100 · entered 30 Nov"],
    ]);
    const open = checklist({ ...base, rating: null, attendance: { imported: true, confirmedNone: false, openIssues: 3 }, submit: submitReadiness({ attendanceImported: true, shiftSet: true, openIssues: 3, ratingEntered: false }) });
    expect(open[2]).toMatchObject({ passed: false, detail: "3 open · see Attendance issues" });
    expect(open[3]).toMatchObject({ passed: false, detail: "Not entered yet" });
  });

  it("shows the period, shift, scheduled and excused days and grace", () => {
    const period = { name: "November 2026", start: "2026-11-01", end: "2026-11-30" };
    expect(periodFigures({ period, shift: base.shift, scheduledDays: Array(26).fill("x"), excusedDays: [], graceMinutes: 10 } as never)).toEqual({ period: { name: "November 2026", range: "1 – 30 Nov 2026" }, shift: "6 AM – 2 PM", scheduled: "26 (0 excused)", grace: "10 minutes" });
    expect(periodFigures({ period, shift: null, scheduledDays: [], excusedDays: [], graceMinutes: 1 } as never)).toMatchObject({ shift: "Not set", scheduled: "—", grace: "1 minute" });
  });

  it("reads dates on the Manila calendar", () => {
    expect(dayMonth("2026-11-30T17:00:00Z")).toBe("1 Dec");
    expect(dayMonth("2026-11-30 02:00:00+00")).toBe("30 Nov");
    expect(dayMonth("2026-11-30 17:00:00.123456+00")).toBe("1 Dec");
    expect(dayMonth("2026-11-30 10:00:00+08")).toBe("30 Nov");
    expect(dayMonth("2026-11-30 20:00:00-05:30")).toBe("1 Dec");
    expect(dayMonth("garbage")).toBe("");
    expect(dayMonthYear("2026-11-30 02:00:00+00")).toBe("30 Nov 2026");
    expect(dayMonthYear("2026-12-31 17:00:00+00")).toBe("1 Jan 2027");
    expect(dayMonthYear("nope")).toBe("");
  });
});

describe("the Submit dialog's confirmation", () => {
  it("lists what is met with the rating, and that all four are needed", () => {
    expect(submitSummary(base)).toBe("Attendance is imported (25 days), the shift is set, attendance issues are resolved and your rating (85 / 100) is entered. All four are needed to submit.");
    expect(submitSummary({ ...base, attendance: { imported: false, confirmedNone: true, openIssues: 0 } })).toMatch(/^Attendance is confirmed as none, the shift is set/);
  });
});

describe("the rating form rules", () => {
  it("takes a whole number from 0 to 100, digits only", () => {
    for (const [text, value] of [["0", 0], ["85", 85], [" 100 ", 100]] as const) expect(checkRating(text)).toEqual({ value, error: null });
    for (const text of ["", "101", "-1", "8.5", "abc", "1e2", "1000"]) expect(checkRating(text).value).toBeNull();
    expect(checkRating("").error).toBe("Enter a rating from 0 to 100.");
    expect(checkRating("101").error).toBe("Enter a whole number from 0 to 100.");
  });

  it("accepts empty or ordinary comments and refuses control characters or too much text", () => {
    expect(checkComments("")).toBeNull();
    expect(checkComments("Good work.\nNeeds more practice.")).toBeNull();
    expect(checkComments("a\u0007b")).toMatch(/can’t contain/);
    expect(checkComments("x".repeat(2001))).toMatch(/too long/);
    expect(ratingMessage("already-submitted")).toMatch(/already submitted/);
  });
});
