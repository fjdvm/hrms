/**
 * The terms of the Performance roster and the Evaluation page, as pure functions: no database and no clock. They turn what is
 * stored (is there a saved evaluation, is it submitted) and what was worked out (attendance, shift, rating) into the derived
 * status, the tab counts, the progress figures and the four Submit checks.
 *
 * Status is derived, never chosen: Draft until a rating is saved (nothing is stored, so the Employee shows from the live
 * roster), In review once a rating is saved or after a reopen, Evaluated once submitted. There is no review button.
 */

export type EvaluationStatus = "Draft" | "In review" | "Evaluated";
export const EVALUATION_TABS = ["All", "Draft", "In review", "Evaluated"] as const;
export type EvaluationTab = (typeof EVALUATION_TABS)[number];

/** A saved evaluation is "In review" until it is submitted, and "Evaluated" after; no saved evaluation is a Draft. */
export const statusOf = (evaluation: { status: "In review" | "Evaluated" } | null | undefined): EvaluationStatus => (evaluation ? evaluation.status : "Draft");

export const isEvaluationTab = (value: unknown): value is EvaluationTab => (EVALUATION_TABS as readonly unknown[]).includes(value);

/** How many Employees each tab holds: All is everyone, and each other tab is one status. */
export function tabCounts(statuses: readonly EvaluationStatus[]): Record<EvaluationTab, number> {
  return {
    All: statuses.length,
    Draft: statuses.filter((status) => status === "Draft").length,
    "In review": statuses.filter((status) => status === "In review").length,
    Evaluated: statuses.filter((status) => status === "Evaluated").length,
  };
}

/** "3 of 8 evaluated" and its whole percentage; nobody on the roster is 0 of 0 and 0%, never a division by zero. */
export function progressOf(statuses: readonly EvaluationStatus[]): { evaluated: number; total: number; percent: number } {
  const evaluated = statuses.filter((status) => status === "Evaluated").length;
  return { evaluated, total: statuses.length, percent: statuses.length === 0 ? 0 : Math.round((evaluated / statuses.length) * 100) };
}

export type SubmitCheckId = "attendance-imported" | "shift-set" | "issues-resolved" | "rating-entered";
export type SubmitCheck = { id: SubmitCheckId; label: string; passed: boolean; /** Why it is not met, for the banner; null when it is. */ reason: string | null };
export type SubmitReadiness = {
  checks: SubmitCheck[];
  /** All four checks pass. Training completion arrives by itself and a Not-applicable result does not block. */
  unlocked: boolean;
  /** The reason for the banner: the first check that is not met, in checklist order. Null when unlocked. */
  reason: string | null;
  /** The banner's button, when what is missing is the rating. */
  action: "enter-rating" | null;
};

export type ReadinessFacts = { attendanceImported: boolean; shiftSet: boolean; openIssues: number; ratingEntered: boolean };

/** The four Submit checks in checklist order, each with its state and a reason, and whether Submit is unlocked. */
export function submitReadiness(facts: ReadinessFacts): SubmitReadiness {
  const checks: SubmitCheck[] = [
    { id: "attendance-imported", label: "Attendance imported", passed: facts.attendanceImported, reason: facts.attendanceImported ? null : "Attendance has not been imported for this period. Import it, or confirm there was none." },
    { id: "shift-set", label: "Shift set", passed: facts.shiftSet, reason: facts.shiftSet ? null : "This employee has no shift. Set it on their record to score them." },
    { id: "issues-resolved", label: "Attendance issues resolved", passed: facts.openIssues === 0, reason: facts.openIssues === 0 ? null : `${facts.openIssues} attendance ${facts.openIssues === 1 ? "issue" : "issues"} to resolve.` },
    { id: "rating-entered", label: "Rating entered", passed: facts.ratingEntered, reason: facts.ratingEntered ? null : "Enter the rating." },
  ];
  const blocked = checks.find((check) => !check.passed);
  return { checks, unlocked: !blocked, reason: blocked?.reason ?? null, action: blocked?.id === "rating-entered" ? "enter-rating" : null };
}
