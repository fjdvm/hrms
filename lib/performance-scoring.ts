/**
 * The Performance scoring engine: the one place the scoring rules live. It is pure: no database, no clock and no
 * imports, so every rule can be checked with hand-computed examples. The Performance interface feeds it normalised
 * rows and the facts around them; nothing here is editable in the UI. HR approval of the formulas, the weights, the
 * Not-applicable rule and the floor is a business step tracked outside this code.
 *
 * Inputs: one Employee's normalised attendance rows for the Evaluation period (one time-in and at most one time-out
 * per date; turning raw punches into those rows is the parser's job), the Employee's fixed shift, the grace period,
 * the Employee's scheduled days and excused days, a Training completion count, the rating and a weight set.
 *
 * Days. The days that count are the scheduled days minus the excused days. A row on any other date is ignored, so
 * Attendance rate can never pass 100.
 *   present day   a counted day with a time-in and a time-out.
 *   absence       a counted day with no row at all, once the Employee has other rows. Absences are not listed; they
 *                 are simply the counted days that are not present.
 *   issue         a counted day with a time-in and no time-out: not present, and returned so HR can resolve it
 *                 (re-import, mark Excused, or mark Absent). An Employee with no rows at all is also an issue; they
 *                 are never scored as fully absent by accident, only when HR has confirmed no attendance for the
 *                 period (`noAttendanceConfirmed`): then every counted day is an absence, Attendance rate is 0, and
 *                 Punctuality and Full shift are Not applicable because nobody was present.
 *
 * KPI results, each a percentage from 0 to 100:
 *   Attendance rate     present days / counted days x 100.
 *   Punctuality         (present days - late days) / present days x 100. Late: time-in after the shift start plus
 *                       the grace period. A time-in exactly at that boundary is on time.
 *   Full shift          (present days - early-out days) / present days x 100. Early-out: time-out before the
 *                       shift end. A time-out exactly at the shift end is not early.
 *   Training completion completed / due x 100, with the counts read from the Training Module by the caller.
 *   Evaluator rating    the rating, 0 to 100, as entered.
 *
 * Not applicable. A result that cannot be worked out is left out, never counted as 0: no Training due, no present
 * day (Punctuality and Full shift), no rows at all (the three attendance KPIs), no rating yet, or the KPI is inactive
 * (HR deactivated it, so it is not scored at all). The weights of the
 * results that remain are rescaled in proportion so they still add up to the set's total; the weights actually used
 * are returned with the result so the score stays explainable.
 *
 * Score. The sum of each result times its weight used, over 100, shown to one decimal. Points per KPI are returned
 * unrounded. When the weight remaining is below {@link INSUFFICIENT_DATA_FLOOR_PERCENT} of the set's total the
 * result is "Insufficient data" and no score is returned.
 */

import { SALES_FORMULA, scoreSales, type SalesInput, type SalesReason } from "./performance-sales-scoring";

/**
 * The version of these rules. A submitted evaluation stores the formulas below with it, so a later change to a rule never alters it;
 * change this when a formula, the grace handling or the floor changes.
 */
export const SCORING_RULES_VERSION = "2026-12";

/** The formulas as HR reads them. Saved with every submitted evaluation. */
export const SCORING_FORMULAS = {
  attendanceRate: "Days with a time-in and a time-out ÷ (scheduled days − excused days) × 100",
  punctuality: "(Present days − late days) ÷ present days × 100. Late: a time-in after the shift start plus the grace period; exactly at that time is on time.",
  fullShift: "(Present days − early-out days) ÷ present days × 100. Early-out: a time-out before the shift end.",
  trainingCompletion: "Trainings completed ÷ Trainings due in the period × 100. Not applicable when none were due.",
  evaluatorRating: "The evaluator's rating, from 0 to 100.",
  sales: SALES_FORMULA,
} as const;

/** The five starter KPIs every weight set weighs. */
export const CORE_KPI_IDS = ["attendanceRate", "punctuality", "fullShift", "trainingCompletion", "evaluatorRating"] as const;
export type CoreKpiId = (typeof CORE_KPI_IDS)[number];
/** Every KPI the engine can score. The sales KPI is scored only when the applied weight set gives it a weight above 0. */
export const KPI_IDS = [...CORE_KPI_IDS, "sales"] as const;
export type KpiId = (typeof KPI_IDS)[number];
/** A weight set's weights: the five starter KPIs, and sales only when it weighs it (a missing KPI counts as 0). */
export type KpiWeights = Record<CoreKpiId, number> & { sales?: number };

/** A placeholder pending HR sign-off: below this share of the weight remaining, the result is Insufficient data. */
export const INSUFFICIENT_DATA_FLOOR_PERCENT = 60;

/** One Employee's normalised attendance for one date. Times are "HH:MM" on the 24-hour clock; dates are "YYYY-MM-DD". */
export type AttendanceRow = { date: string; timeIn: string; timeOut: string | null };

export type ScoringInput = {
  rows: readonly AttendanceRow[];
  /** The Employee's one fixed shift, "HH:MM". Overnight shifts do not exist: the end is after the start. */
  shift: { start: string; end: string };
  graceMinutes: number;
  /** Dates the Employee is scheduled to work in the period. */
  scheduledDays: readonly string[];
  /** Dates HR marked Excused for this Employee and period. */
  excusedDays: readonly string[];
  /** Trainings due in the period and how many the Employee completed; nothing due is Not applicable. */
  training: { completed: number; due: number };
  /** The evaluator's rating from 0 to 100, or null while it has not been entered. */
  rating: number | null;
  /** The weight of each KPI in the applied weight set; the set's total is what the weights are rescaled to. */
  weights: Readonly<KpiWeights>;
  /** What was found for the sales KPI. Required when the weight set weighs sales above 0, and ignored otherwise. */
  sales?: SalesInput;
  /** The minimum present days for the sales KPI. Defaults to the placeholder; a reopened evaluation passes the one saved at its first submission. */
  salesMinPresentDays?: number;
  /** HR confirmed this Employee had no attendance for the period. It only matters when there are no rows at all. */
  noAttendanceConfirmed?: boolean;
  /** KPIs HR has deactivated: they are left out like a Not-applicable result, and the other weights are rescaled. */
  inactiveKpis?: readonly KpiId[];
  /** The floor in force, as a percent of the weight remaining. Defaults to {@link INSUFFICIENT_DATA_FLOOR_PERCENT}; a reopened evaluation passes the one saved when it was first submitted. */
  floorPercent?: number;
};

export type NotApplicableReason = "no-attendance" | "no-present-days" | "no-training-due" | "no-rating" | "inactive" | SalesReason;

export type KpiResult =
  | { kpi: KpiId; status: "scored"; result: number; weight: number; weightUsed: number; points: number }
  | { kpi: KpiId; status: "not-applicable"; reason: NotApplicableReason; weight: number };

export type AttendanceIssue = { kind: "no-attendance" } | { kind: "missing-time-out"; date: string };

export type AttendanceCounts = { counted: number; present: number; late: number; earlyOut: number };

export type Scoring = {
  results: KpiResult[];
  counts: AttendanceCounts;
  issues: AttendanceIssue[];
  /** The weights actually used after leaving out Not-applicable results; they add up to the set's total. */
  weightsUsed: Partial<Record<KpiId, number>>;
  /** Share of the set's total weight that remained, 0 to 100. */
  weightRemainingPercent: number;
} & ({ outcome: "scored"; score: number } | { outcome: "insufficient-data" });

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const minutes = (time: string) => {
  const match = TIME.exec(time);
  if (!match) throw new RangeError(`Not a clock time: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
};
/** Rounds half up to one decimal, so 92.996 shows as 93.0 and 92.25 as 92.3. */
export const roundScore = (value: number) => Math.round((value + Number.EPSILON) * 10) / 10;

/** Works out the KPI results and the weighted score out of 100 for one Employee and one Evaluation period. */
export function scoreEvaluation(input: ScoringInput): Scoring {
  const { rows, shift, graceMinutes, training, rating, weights } = input;
  if (rating !== null && !(Number.isFinite(rating) && rating >= 0 && rating <= 100)) throw new RangeError("The rating is from 0 to 100.");
  if (!(Number.isFinite(graceMinutes) && graceMinutes >= 0)) throw new RangeError("The grace period is zero or more minutes.");
  if (!(Number.isInteger(training.completed) && Number.isInteger(training.due) && training.completed >= 0 && training.due >= 0 && training.completed <= training.due)) {
    throw new RangeError("Training completed must be a whole number from 0 up to the number due.");
  }
  const shiftStart = minutes(shift.start);
  const shiftEnd = minutes(shift.end);
  if (shiftEnd <= shiftStart) throw new RangeError("The shift end must be after the shift start.");
  const lateAfter = shiftStart + graceMinutes;

  const byDate = new Map<string, AttendanceRow>();
  for (const row of rows) {
    if (byDate.has(row.date)) throw new Error(`Two attendance rows for ${row.date}.`);
    byDate.set(row.date, row);
  }

  const excused = new Set(input.excusedDays);
  const counted = [...new Set(input.scheduledDays)].filter((day) => !excused.has(day)).sort();
  const issues: AttendanceIssue[] = [];
  let present = 0;
  let late = 0;
  let earlyOut = 0;
  const confirmedAbsent = input.noAttendanceConfirmed === true && rows.length === 0;
  if (rows.length === 0 && !confirmedAbsent) issues.push({ kind: "no-attendance" });
  for (const day of counted) {
    const row = byDate.get(day);
    if (!row) continue;
    if (row.timeOut === null) {
      issues.push({ kind: "missing-time-out", date: day });
      continue;
    }
    present += 1;
    if (minutes(row.timeIn) > lateAfter) late += 1;
    if (minutes(row.timeOut) < shiftEnd) earlyOut += 1;
  }

  const percent = (part: number, whole: number) => (part / whole) * 100;
  const noAttendance = (rows.length === 0 && !confirmedAbsent) || counted.length === 0;
  type Raw = { result: number } | { reason: NotApplicableReason };
  const inactive = new Set(input.inactiveKpis ?? []);
  const salesWeight = weights.sales ?? 0;
  if (salesWeight > 0 && !input.sales) throw new Error("A weight set that weighs sales needs the sales figures.");
  const worked: Record<KpiId, Raw> = {
    attendanceRate: noAttendance ? { reason: "no-attendance" } : { result: percent(present, counted.length) },
    punctuality: noAttendance ? { reason: "no-attendance" } : present === 0 ? { reason: "no-present-days" } : { result: percent(present - late, present) },
    fullShift: noAttendance ? { reason: "no-attendance" } : present === 0 ? { reason: "no-present-days" } : { result: percent(present - earlyOut, present) },
    trainingCompletion: training.due === 0 ? { reason: "no-training-due" } : { result: percent(training.completed, training.due) },
    evaluatorRating: rating === null ? { reason: "no-rating" } : { result: rating },
    sales: salesWeight > 0 ? scoreSales(input.sales!, present, input.salesMinPresentDays) : { reason: "no-linked-account" },
  };
  // The sales KPI is part of the score only when the set weighs it; otherwise nothing about the result mentions it.
  const scoredKpis = KPI_IDS.filter((kpi) => kpi !== "sales" || salesWeight > 0);
  const weightOf = (kpi: KpiId) => weights[kpi] ?? 0;

  const raw = Object.fromEntries(scoredKpis.map((kpi) => [kpi, inactive.has(kpi) ? { reason: "inactive" as const } : worked[kpi]])) as Record<KpiId, Raw>;
  const total = scoredKpis.reduce((sum, kpi) => sum + weightOf(kpi), 0);
  const remaining = scoredKpis.reduce((sum, kpi) => sum + ("result" in raw[kpi] ? weightOf(kpi) : 0), 0);
  const scale = remaining > 0 ? total / remaining : 0;

  const weightsUsed: Partial<Record<KpiId, number>> = {};
  const results = scoredKpis.map((kpi): KpiResult => {
    const value = raw[kpi];
    if ("reason" in value) return { kpi, status: "not-applicable", reason: value.reason, weight: weightOf(kpi) };
    const weightUsed = weightOf(kpi) * scale;
    weightsUsed[kpi] = weightUsed;
    return { kpi, status: "scored", result: value.result, weight: weightOf(kpi), weightUsed, points: (value.result * weightUsed) / 100 };
  });

  const common = {
    results,
    counts: { counted: counted.length, present, late, earlyOut },
    issues,
    weightsUsed,
    weightRemainingPercent: total > 0 ? (remaining / total) * 100 : 0,
  };
  // Compared without division so exactly 60% of the weight is enough and a hair under is not.
  if (total <= 0 || remaining * 100 < (input.floorPercent ?? INSUFFICIENT_DATA_FLOOR_PERCENT) * total) return { ...common, outcome: "insufficient-data" };
  const score = results.reduce((sum, result) => sum + (result.status === "scored" ? result.points : 0), 0);
  return { ...common, outcome: "scored", score: roundScore(score) };
}
