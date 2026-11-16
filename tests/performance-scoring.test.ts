import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  INSUFFICIENT_DATA_FLOOR_PERCENT, roundScore, scoreEvaluation,
  type AttendanceRow, type KpiId, type ScoringInput,
} from "@/lib/performance-scoring";

// Hand-computed examples. Dates are plain strings: the engine has no clock and no calendar.
const day = (n: number) => `2026-11-${String(n).padStart(2, "0")}`;
const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => day(from + i));
const WEIGHTS: Record<KpiId, number> = { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 };
const ON_TIME: Pick<AttendanceRow, "timeIn" | "timeOut"> = { timeIn: "06:00", timeOut: "14:00" };
const row = (date: string, overrides: Partial<AttendanceRow> = {}): AttendanceRow => ({ date, ...ON_TIME, ...overrides });

/** A shift of 6:00 AM to 2:00 PM with a 10 minute grace, 10 scheduled days and everything on time, unless overridden. */
function input(overrides: Partial<ScoringInput> = {}): ScoringInput {
  return {
    rows: days(1, 10).map((date) => row(date)),
    shift: { start: "06:00", end: "14:00" },
    graceMinutes: 10,
    scheduledDays: days(1, 10),
    excusedDays: [],
    training: { completed: 2, due: 2 },
    rating: 85,
    weights: WEIGHTS,
    ...overrides,
  };
}
const result = (scoring: ReturnType<typeof scoreEvaluation>, kpi: KpiId) => scoring.results.find((r) => r.kpi === kpi)!;

it("returns 93.0 out of 100 for the requirements' worked example", () => {
  // 26 scheduled days, 25 present (one absence), 3 late, 1 early-out, 2 of 2 Trainings, rating 85.
  const rows = days(1, 25).map((date, i) => row(date, { timeIn: i < 3 ? "06:11" : "06:00", timeOut: i === 3 ? "13:59" : "14:00" }));
  const scoring = scoreEvaluation(input({ rows, scheduledDays: days(1, 26) }));

  expect(scoring.outcome).toBe("scored");
  expect(scoring).toMatchObject({ outcome: "scored", score: 93.0, counts: { counted: 26, present: 25, late: 3, earlyOut: 1 }, issues: [] });
  // 25/26 x 30 + 22/25 x 25 + 24/25 x 15 + 100% x 15 + 85 x 15, each over 100.
  const points = Object.fromEntries(scoring.results.map((r) => [r.kpi, r.status === "scored" ? r.points : null]));
  expect(points.attendanceRate).toBeCloseTo(28.846154, 5);
  expect(points).toMatchObject({ punctuality: 22, fullShift: 14.4, trainingCompletion: 15, evaluatorRating: 12.75 });
  expect(scoring.weightsUsed).toEqual(WEIGHTS);
  expect(scoring.weightRemainingPercent).toBe(100);
});

describe("Attendance rate", () => {
  it("is days with a time-in and a time-out over scheduled days minus excused days", () => {
    // 10 scheduled, 2 excused, so 8 count; 6 present.
    const scoring = scoreEvaluation(input({ rows: days(1, 6).map((d) => row(d)), excusedDays: [day(9), day(10)] }));

    expect(result(scoring, "attendanceRate")).toMatchObject({ status: "scored", result: 75 });
    expect(scoring.counts).toMatchObject({ counted: 8, present: 6 });
  });

  it("counts a scheduled day with no row as an absence when the Employee has other rows", () => {
    const scoring = scoreEvaluation(input({ rows: [row(day(1))] }));

    expect(result(scoring, "attendanceRate")).toMatchObject({ result: 10 });
    expect(scoring.issues).toEqual([]);
  });

  it("ignores a row on an excused or unscheduled day, so the rate never passes 100", () => {
    const rows = [...days(1, 10).map((d) => row(d)), row(day(11)), row(day(12))];
    const scoring = scoreEvaluation(input({ rows, excusedDays: [day(10)] }));

    expect(result(scoring, "attendanceRate")).toMatchObject({ result: 100 });
    expect(scoring.counts).toMatchObject({ counted: 9, present: 9 });
  });

  it("does not count a day with a time-in and no time-out as present, and returns it as an issue", () => {
    const rows = [...days(1, 9).map((d) => row(d)), row(day(10), { timeOut: null })];
    const scoring = scoreEvaluation(input({ rows }));

    expect(result(scoring, "attendanceRate")).toMatchObject({ result: 90 });
    expect(scoring.counts.present).toBe(9);
    expect(scoring.issues).toEqual([{ kind: "missing-time-out", date: day(10) }]);
  });

  it("does not flag a missing time-out on an excused day, which HR has already resolved", () => {
    const rows = [...days(1, 9).map((d) => row(d)), row(day(10), { timeOut: null })];
    const scoring = scoreEvaluation(input({ rows, excusedDays: [day(10)] }));

    expect(scoring.issues).toEqual([]);
    expect(result(scoring, "attendanceRate")).toMatchObject({ result: 100 });
  });
});

describe("Punctuality", () => {
  it("treats a time-in exactly at the shift start plus the grace period as on time", () => {
    const scoring = scoreEvaluation(input({ rows: days(1, 10).map((d) => row(d, { timeIn: "06:10" })) }));

    expect(scoring.counts.late).toBe(0);
    expect(result(scoring, "punctuality")).toMatchObject({ result: 100 });
  });

  it("treats one minute past the boundary as late", () => {
    const rows = days(1, 10).map((d, i) => row(d, { timeIn: i < 2 ? "06:11" : "05:30" }));
    const scoring = scoreEvaluation(input({ rows }));

    expect(scoring.counts.late).toBe(2);
    expect(result(scoring, "punctuality")).toMatchObject({ result: 80 });
  });

  it("uses the grace period it is given", () => {
    const rows = days(1, 10).map((d) => row(d, { timeIn: "06:05" }));

    expect(scoreEvaluation(input({ rows, graceMinutes: 4 })).counts.late).toBe(10);
    expect(scoreEvaluation(input({ rows, graceMinutes: 5 })).counts.late).toBe(0);
  });

  it("is over present days only: an absence does not make anyone late", () => {
    const scoring = scoreEvaluation(input({ rows: days(1, 5).map((d, i) => row(d, { timeIn: i === 0 ? "07:00" : "06:00" })) }));

    expect(result(scoring, "punctuality")).toMatchObject({ result: 80 });
  });
});

describe("Full shift", () => {
  it("counts a time-out before the shift end as an early-out, and exactly at the shift end as not", () => {
    const rows = days(1, 10).map((d, i) => row(d, { timeOut: i < 3 ? "13:59" : "14:00" }));
    const scoring = scoreEvaluation(input({ rows }));

    expect(scoring.counts.earlyOut).toBe(3);
    expect(result(scoring, "fullShift")).toMatchObject({ result: 70 });
  });
});

describe("Training completion and Not applicable", () => {
  it("is completed over due", () => {
    const scoring = scoreEvaluation(input({ training: { completed: 1, due: 4 } }));

    expect(result(scoring, "trainingCompletion")).toMatchObject({ status: "scored", result: 25 });
  });

  it("leaves a Not-applicable Training out, never 0%, and rescales the other weights in proportion", () => {
    // Everything else is perfect: attendance 100, punctuality 100, full shift 100, rating 80.
    const scoring = scoreEvaluation(input({ training: { completed: 0, due: 0 }, rating: 80 }));

    expect(result(scoring, "trainingCompletion")).toEqual({ kpi: "trainingCompletion", status: "not-applicable", reason: "no-training-due", weight: 15 });
    // 85 of 100 remains, so the weights become 30, 25, 15 and 15 over 85, scaled back up to 100.
    expect(scoring.weightsUsed.attendanceRate).toBeCloseTo(30 * (100 / 85), 10);
    expect(scoring.weightsUsed.evaluatorRating).toBeCloseTo(15 * (100 / 85), 10);
    expect(Object.values(scoring.weightsUsed).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
    expect(scoring.weightRemainingPercent).toBe(85);
    // (100 x 30 + 100 x 25 + 100 x 15 + 80 x 15) / 85 = 8200 / 85 = 96.47...
    expect(scoring).toMatchObject({ outcome: "scored", score: 96.5 });
  });

  it("rescales to the set's total, whatever the total is", () => {
    const scoring = scoreEvaluation(input({ training: { completed: 0, due: 0 }, weights: { attendanceRate: 3, punctuality: 2, fullShift: 1, trainingCompletion: 2, evaluatorRating: 2 } }));

    expect(Object.values(scoring.weightsUsed).reduce((a, b) => a + b, 0)).toBeCloseTo(10, 10);
  });

  it("leaves the rating out until it is entered, and still returns the KPI results", () => {
    const scoring = scoreEvaluation(input({ rating: null }));

    expect(result(scoring, "evaluatorRating")).toMatchObject({ status: "not-applicable", reason: "no-rating" });
    expect(scoring.outcome).toBe("scored");
    expect(scoring.weightRemainingPercent).toBe(85);
  });

  it("accepts the rating's ends, 0 and 100", () => {
    expect(result(scoreEvaluation(input({ rating: 0 })), "evaluatorRating")).toMatchObject({ result: 0 });
    expect(result(scoreEvaluation(input({ rating: 100 })), "evaluatorRating")).toMatchObject({ result: 100 });
  });
});

describe("Insufficient data", () => {
  it("names its floor as 60% pending HR sign-off", () => {
    expect(INSUFFICIENT_DATA_FLOOR_PERCENT).toBe(60);
  });

  it("returns no score when too little weight remains", () => {
    // No rows at all, no Training due and no rating: only nothing is left.
    const scoring = scoreEvaluation(input({ rows: [], training: { completed: 0, due: 0 }, rating: null }));

    expect(scoring.outcome).toBe("insufficient-data");
    expect(scoring).not.toHaveProperty("score");
    expect(scoring.weightRemainingPercent).toBe(0);
  });

  it("returns a score at exactly 60% of the weight remaining, and none below it", () => {
    const even = { attendanceRate: 20, punctuality: 20, fullShift: 20, trainingCompletion: 20, evaluatorRating: 20 } as const;
    // Nobody present: Punctuality and Full shift are Not applicable, 60 of 100 remains.
    const absent = [row(day(1), { timeOut: null })];
    const atFloor = scoreEvaluation(input({ rows: absent, weights: even }));
    const below = scoreEvaluation(input({ rows: absent, weights: even, rating: null }));

    expect(atFloor.weightRemainingPercent).toBe(60);
    expect(atFloor.outcome).toBe("scored");
    expect(below.weightRemainingPercent).toBe(40);
    expect(below.outcome).toBe("insufficient-data");
  });

  it("is insufficient when the weights add up to nothing", () => {
    const zero = { attendanceRate: 0, punctuality: 0, fullShift: 0, trainingCompletion: 0, evaluatorRating: 0 };

    expect(scoreEvaluation(input({ weights: zero })).outcome).toBe("insufficient-data");
  });
});

describe("an Employee with no attendance rows", () => {
  it("is flagged, never scored as fully absent, and leaves the three attendance KPIs out", () => {
    const scoring = scoreEvaluation(input({ rows: [] }));

    expect(scoring.issues).toEqual([{ kind: "no-attendance" }]);
    for (const kpi of ["attendanceRate", "punctuality", "fullShift"] as const) {
      expect(result(scoring, kpi)).toMatchObject({ status: "not-applicable", reason: "no-attendance" });
    }
    // Training and rating are 30 of 100: below the floor.
    expect(scoring.outcome).toBe("insufficient-data");
  });
});

describe("Employees with nobody present", () => {
  it("leaves Punctuality and Full shift out rather than dividing by zero", () => {
    const scoring = scoreEvaluation(input({ rows: [row(day(1), { timeOut: null })] }));

    expect(result(scoring, "attendanceRate")).toMatchObject({ result: 0 });
    expect(result(scoring, "punctuality")).toMatchObject({ status: "not-applicable", reason: "no-present-days" });
    expect(result(scoring, "fullShift")).toMatchObject({ status: "not-applicable", reason: "no-present-days" });
  });
});

describe("the score", () => {
  it("is the sum of each result times its weight, to one decimal, with each KPI's points", () => {
    // Attendance 50 x 30 + punctuality 100 x 25 + full shift 100 x 15 + training 50 x 15 + rating 70 x 15, over 100.
    const scoring = scoreEvaluation(input({ rows: days(1, 5).map((d) => row(d)), training: { completed: 1, due: 2 }, rating: 70 }));

    expect(scoring).toMatchObject({ outcome: "scored", score: 73 });
    expect(scoring.results.map((r) => (r.status === "scored" ? r.points : null))).toEqual([15, 25, 15, 7.5, 10.5]);
  });

  it("rounds half up to one decimal", () => {
    expect(roundScore(92.996154)).toBe(93.0);
    expect(roundScore(92.25)).toBe(92.3);
    expect(roundScore(92.24)).toBe(92.2);
    expect(roundScore(0)).toBe(0);
  });

  it("does not depend on the order of the rows or the days", () => {
    const base = input({ rows: days(1, 10).map((d, i) => row(d, { timeIn: i % 3 === 0 ? "06:30" : "06:00" })) });
    const shuffled = { ...base, rows: [...base.rows].reverse(), scheduledDays: [...base.scheduledDays].reverse() };

    expect(scoreEvaluation(shuffled)).toEqual(scoreEvaluation(base));
  });
});

describe("bad input", () => {
  it("refuses a rating outside 0 to 100", () => {
    for (const rating of [-1, 101, Number.NaN]) expect(() => scoreEvaluation(input({ rating }))).toThrow(RangeError);
  });

  it("refuses an overnight shift, a bad time, a negative grace and impossible Training counts", () => {
    expect(() => scoreEvaluation(input({ shift: { start: "22:00", end: "06:00" } }))).toThrow(RangeError);
    expect(() => scoreEvaluation(input({ shift: { start: "06:00", end: "06:00" } }))).toThrow(RangeError);
    expect(() => scoreEvaluation(input({ shift: { start: "6:00", end: "14:00" } }))).toThrow(RangeError);
    expect(() => scoreEvaluation(input({ graceMinutes: -1 }))).toThrow(RangeError);
    expect(() => scoreEvaluation(input({ training: { completed: 3, due: 2 } }))).toThrow(RangeError);
  });

  it("refuses two rows for one date instead of counting it twice", () => {
    expect(() => scoreEvaluation(input({ rows: [row(day(1)), row(day(1))] }))).toThrow();
  });
});

describe("the engine is pure", () => {
  it("imports nothing, so it has no database, and reads no clock", () => {
    const source = readFileSync(new URL("../lib/performance-scoring.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/new Date\(|Date\.now\(|performance\.now\(/);
  });
});
