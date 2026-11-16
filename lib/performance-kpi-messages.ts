import type { KpiProblem } from "./performance-kpis";

/** What HR reads when a KPI or weight-set change is refused. The server action and the New weight set dialog use the same words. */
export const POSITION_TAKEN_MESSAGE = "A position can have only one weight set.";

export function kpiMessage(problem: KpiProblem, extra: { total?: number; conflictsWith?: string } = {}): string {
  switch (problem) {
    case "weights-total": return extra.total === undefined ? "Weights must total 100." : `Weights total ${extra.total}, not 100.`;
    case "weights-invalid": return "Each weight must be a whole number from 0 to 100.";
    case "position-empty": return "Enter a position.";
    case "position-too-long": return "Position is too long (100 characters at most).";
    case "position-characters": return "Position can only contain letters, numbers, spaces and . , ' & ( ) / + -";
    case "position-taken": return POSITION_TAKEN_MESSAGE;
    default: return "Something went wrong. Reload the page and try again.";
  }
}
