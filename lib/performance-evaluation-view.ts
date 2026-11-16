import { formatWorkingDays } from "./validators/weekdays";
import type { EvaluationDetail, KpiLine } from "./performance-evaluations";
import type { SubmitCheckId } from "./performance-evaluations-terms";
import { shiftText } from "./performance-list";
import { rangeLabel } from "./performance-period-form";

/**
 * What the Employee evaluation page says, as pure functions over the detail the Performance interface returns: the banner, each
 * KPI line's note and figures, the headline score and the Submit checklist's details. The screen holds no rule of its own.
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A timestamp as Postgres writes it ("2026-11-30 02:00:00.123456+00") or as ISO, moved to the Manila calendar; null when it is not one. */
function manila(timestamp: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(Z|[+-]\d{2}(?::?\d{2})?)?$/.exec(timestamp);
  if (!match) return null;
  const [, y, mo, d, h, mi, sec, zone = "Z"] = match;
  const parts = /^([+-])(\d{2}):?(\d{2})?$/.exec(zone);
  const offsetMinutes = parts ? (parts[1] === "-" ? -1 : 1) * (Number(parts[2]) * 60 + Number(parts[3] ?? 0)) : 0;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(sec)) - offsetMinutes * 60_000;
  return new Date(utc + 8 * 3_600_000);
}

/** "30 Nov" for a timestamp, on the Manila calendar. */
export const dayMonth = (timestamp: string) => { const date = manila(timestamp); return date ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}` : ""; };

/** "30 Nov 2026" for a timestamp, on the Manila calendar. */
export const dayMonthYear = (timestamp: string) => { const date = manila(timestamp); return date ? `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}` : ""; };

/** The Submit dialog's confirmation: what is met, with the rating, and that all four are needed. */
export function submitSummary(detail: Pick<EvaluationDetail, "attendance" | "counts" | "rating">): string {
  const attendance = detail.attendance.confirmedNone && !detail.attendance.imported ? "Attendance is confirmed as none" : `Attendance is imported (${detail.counts?.present ?? 0} days)`;
  return `${attendance}, the shift is set, attendance issues are resolved and your rating (${detail.rating?.value ?? "—"} / 100) is entered. All four are needed to submit.`;
}

/** A weight or percentage to one decimal, with the decimal dropped when it is whole: 30, 35.3. */
export const percentText = (value: number) => `${Number.isInteger(value) ? value : value.toFixed(1)}%`;

const MET: Record<SubmitCheckId, string> = {
  "attendance-imported": "attendance is imported",
  "shift-set": "the shift is set",
  "issues-resolved": "attendance issues are resolved",
  "rating-entered": "the rating is entered",
};

/** The banner's sentence: that Submit is unlocked, or which checks are missing and which are met. */
export function bannerText(detail: Pick<EvaluationDetail, "submit" | "attendance"> & { submitted: Pick<NonNullable<EvaluationDetail["submitted"]>, "submittedByName" | "submittedAt"> | null }): string {
  if (detail.submitted) return `Evaluated and locked on ${dayMonthYear(detail.submitted.submittedAt)} by ${detail.submitted.submittedByName}. The score, KPI results and weights used are saved.`;
  const { checks, unlocked } = detail.submit;
  if (unlocked) return "Submit is unlocked: attendance is imported, the shift is set, attendance issues are resolved and the rating is entered. Submitting locks this evaluation.";
  const missing = checks.filter((check) => !check.passed).map((check) => {
    if (check.id === "attendance-imported") return "attendance is not imported yet";
    if (check.id === "shift-set") return "the shift is not set";
    if (check.id === "issues-resolved") return `${detail.attendance.openIssues} attendance ${detail.attendance.openIssues === 1 ? "issue is" : "issues are"} open`;
    return "the rating is not entered yet";
  });
  const met = checks.filter((check) => check.passed).map((check) => MET[check.id]);
  const join = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0]);
  const rest = met.length ? ` ${join(met).replace(/^./, (c) => c.toUpperCase())}.` : "";
  const resolve = detail.attendance.openIssues > 0 ? " Resolve each one below, or re-import a corrected file." : "";
  return `Submit is locked: ${join(missing)}.${resolve}${rest}`;
}

/** The rating, once entered or while submitted, is what completes the score; until then the page says "incomplete". */
export const isIncomplete = (detail: Pick<EvaluationDetail, "rating" | "score" | "shift">) => detail.shift !== null && detail.rating === null;

/** The KPI results title: "93.0 / 100", "incomplete", "Insufficient data" or "Not scored: shift missing". */
export function scoreHeadline(detail: Pick<EvaluationDetail, "rating" | "score" | "shift">): string {
  if (detail.score.outcome === "not-scored") return "Not scored: shift missing";
  if (isIncomplete(detail)) return "incomplete";
  return detail.score.outcome === "scored" ? `${detail.score.value.toFixed(1)} / 100` : "Insufficient data";
}

/** The weights the scored KPIs would carry between them: under 100 means the others were rescaled. */
export const scoredWeight = (kpis: readonly KpiLine[]) => kpis.filter((kpi) => kpi.status === "scored").reduce((sum, kpi) => sum + kpi.weight, 0);

export type LineFigures = { result: string; weight: string; points: string; note: string };

const REASONS: Record<NonNullable<KpiLine["reason"]>, string> = {
  "no-attendance": "No attendance in this period",
  "no-present-days": "No present days to measure",
  "no-training-due": "No Training due in this period",
  "no-rating": "Not entered yet",
  inactive: "KPI is inactive",
};

/**
 * One KPI row: the result, the weight and points, and the note under the name. While the rating is missing the other rows show their
 * own weights and points (the score is "incomplete"); once it is entered, a Not-applicable result is left out and the rest are rescaled.
 */
export function lineFigures(detail: Pick<EvaluationDetail, "counts" | "rating" | "shift" | "score">, line: KpiLine): LineFigures {
  const counts = detail.counts;
  const incomplete = isIncomplete(detail);
  const noteFor = (): string => {
    if (line.reason) return REASONS[line.reason];
    if (line.id === "attendanceRate" && counts) return `${counts.present} of ${counts.counted} days present`;
    if (line.id === "punctuality" && counts) return `${counts.late} late of ${counts.present} present`;
    if (line.id === "fullShift" && counts) return `${counts.earlyOut} early-out of ${counts.present}`;
    if (line.id === "evaluatorRating" && detail.rating) return `Entered by ${detail.rating.savedByName}`;
    return line.description;
  };
  const note = [noteFor(), line.flag].filter(Boolean).join(" · ");
  if (line.status === "not-applicable") {
    const rateless = line.reason === "no-rating" || line.reason === "no-attendance" || line.reason === "no-present-days";
    return { result: rateless ? "—" : "Not applicable", weight: rateless ? percentText(line.weight) : "—", points: "—", note };
  }
  const result = (line.result ?? 0).toFixed(1);
  if (incomplete) return { result, weight: percentText(line.weight), points: (((line.result ?? 0) * line.weight) / 100).toFixed(1), note };
  return { result, weight: percentText(line.weightUsed ?? line.weight), points: (line.points ?? 0).toFixed(1), note };
}

/** The overall row: the score out of 100 and what it was built from. */
export function overallFigures(detail: Pick<EvaluationDetail, "kpis" | "rating" | "score" | "shift">): { score: string; note: string } {
  if (detail.score.outcome === "not-scored") return { score: "Not scored", note: "Shift missing" };
  if (isIncomplete(detail)) return { score: "Incomplete", note: "Sum of the weighted results" };
  if (detail.score.outcome === "insufficient-data") return { score: "Insufficient data", note: "Too little weight remains to score this reliably" };
  const used = scoredWeight(detail.kpis);
  return { score: `${detail.score.value.toFixed(1)} / 100`, note: used < 100 ? `Rescaled from ${percentText(used)}` : "Sum of the weighted results" };
}

export type CheckDetail = { id: SubmitCheckId; label: string; passed: boolean; detail: string };

/** The Submit checklist: each check's state, with the detail Figma shows beneath it. */
export function checklist(detail: Pick<EvaluationDetail, "submit" | "attendance" | "shift" | "rating" | "counts" | "issues">): CheckDetail[] {
  return detail.submit.checks.map((check) => {
    let text: string;
    if (check.id === "attendance-imported") text = check.passed ? (detail.attendance.confirmedNone && !detail.attendance.imported ? "Confirmed: no attendance this period" : `${detail.counts?.present ?? 0} days matched`) : "Not imported yet";
    else if (check.id === "shift-set") text = detail.shift ? `${shiftText(detail.shift)} · ${formatWorkingDays(detail.shift.workingDays)}` : "No shift on the Employee record";
    else if (check.id === "issues-resolved") text = detail.attendance.openIssues === 0 ? "No open issues" : `${detail.attendance.openIssues} open · see Attendance issues`;
    else text = detail.rating ? `${detail.rating.value} / 100 · entered ${dayMonth(detail.rating.savedAt)}` : "Not entered yet";
    return { id: check.id, label: check.label, passed: check.passed, detail: text };
  });
}

/** The Evaluation period card's four figures. */
export function periodFigures(detail: Pick<EvaluationDetail, "period" | "shift" | "scheduledDays" | "excusedDays" | "graceMinutes">) {
  return {
    period: { name: detail.period.name, range: rangeLabel(detail.period) },
    shift: shiftText(detail.shift),
    scheduled: detail.shift ? `${detail.scheduledDays.length} (${detail.excusedDays.length} excused)` : "—",
    grace: `${detail.graceMinutes} ${detail.graceMinutes === 1 ? "minute" : "minutes"}`,
  };
}
