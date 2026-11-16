import type { EvaluationTab } from "./performance-evaluations-terms";
import type { Period } from "./performance-periods";
import type { RosterRow } from "./performance-evaluations";

/**
 * What the Performance list shows for each row and how it is narrowed: pure functions over the roster the Performance interface
 * returns, so the screen holds no rule of its own. Dates are Manila "YYYY-MM-DD" strings; nothing reads a clock.
 */

/** Where an Employee's evaluation page lives. The list's rows and the progress card's links open it. */
export const evaluationHref = (employeeId: number, periodId: number) => `/performance/evaluation/${employeeId}?period=${periodId}`;
/** The Employee's record, where "Set shift" is. */
export const profileHref = (employeeId: number) => `/employee-information/${employeeId}`;
export const periodHref = (periodId: number) => `/performance?period=${periodId}`;

/**
 * The period the list opens on: the one asked for when it exists, else the one that holds today, else the latest that has started,
 * else the earliest still to come. `periods` is latest first, as the interface returns them.
 */
export function pickPeriod<P extends Pick<Period, "id" | "start" | "end">>(periods: readonly P[], today: string, requested?: string | null): P | undefined {
  const asked = requested && /^\d+$/.test(requested) ? periods.find((period) => period.id === Number(requested)) : undefined;
  return asked
    ?? periods.find((period) => period.start <= today && today <= period.end)
    ?? periods.find((period) => period.start <= today)
    ?? periods.at(-1);
}

/** "6 AM – 2 PM", "8:30 AM – 5 PM"; "Not set" when the Employee has no shift. */
export function shiftText(shift: { start: string; end: string } | null): string {
  if (!shift) return "Not set";
  const clock = (time: string) => {
    const [hours, minutes] = time.split(":").map(Number);
    const hour = hours % 12 === 0 ? 12 : hours % 12;
    return `${hour}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${hours < 12 ? "AM" : "PM"}`;
  };
  return `${clock(shift.start)} – ${clock(shift.end)}`;
}

/** The score cell: one decimal as in the worked example, "Insufficient data" when too little weight remains, a dash when there is nothing to show. */
export function scoreText(row: Pick<RosterRow, "score" | "attendance">): string {
  if (row.score.outcome === "scored") return row.score.value.toFixed(1);
  return row.score.outcome === "insufficient-data" && row.attendance.imported ? "Insufficient data" : "—";
}

/** The attendance import cell and, when there are open attendance issues, the issue marker beside it. */
export function importText(attendance: Pick<RosterRow["attendance"], "imported" | "confirmedNone" | "openIssues">): { label: string; issues: string | null } {
  const issues = attendance.openIssues > 0 ? `${attendance.openIssues} ${attendance.openIssues === 1 ? "issue" : "issues"}` : null;
  if (attendance.confirmedNone && !attendance.imported) return { label: "No attendance", issues };
  return { label: attendance.imported ? "Imported" : "Not imported", issues };
}

/** The status badge's words and tone. An Employee with no shift is "Not scored: shift missing", whatever the status. */
export function statusBadge(row: Pick<RosterRow, "status" | "score">): { label: string; tone: "success" | "warning" | "secondary" | "destructive" } {
  if (row.score.outcome === "not-scored") return { label: "Not scored: shift missing", tone: "destructive" };
  return row.status === "Evaluated" ? { label: row.status, tone: "success" } : row.status === "In review" ? { label: row.status, tone: "warning" } : { label: row.status, tone: "secondary" };
}

/** The rows a tab shows: All is everyone, and each other tab is one status. */
export const inTab = (row: Pick<RosterRow, "status">, tab: EvaluationTab) => tab === "All" || row.status === tab;

/** The rows a search finds, by name or employee number, ignoring case and extra spaces. */
export function matchesSearch(row: Pick<RosterRow, "name" | "employeeNumber">, search: string): boolean {
  const needle = search.normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  return needle === "" || row.name.toLowerCase().includes(needle) || row.employeeNumber.toLowerCase().includes(needle);
}

/** The warning line's sentence, as in Figma: "1 employee is not scored: shift missing (Patricia Gomez)". */
export function notScoredText(people: readonly { name: string }[]): string {
  const names = people.slice(0, 3).map((person) => person.name).join(", ") + (people.length > 3 ? ` and ${people.length - 3} more` : "");
  return `${people.length} ${people.length === 1 ? "employee is" : "employees are"} not scored: shift missing (${names})`;
}
