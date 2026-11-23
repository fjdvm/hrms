import type { LinkProblem } from "./performance-links";

/** What HR reads when a POS account link is refused. The server action and the Link POS cashier dialog use the same words. */
export const NOT_A_CASHIER = "Not a cashier position";

export function linkMessage(problem: LinkProblem): string {
  switch (problem) {
    case "not-cashier": return `${NOT_A_CASHIER}. Only an employee whose position is a cashier position can be linked.`;
    case "account-taken": return "That POS account is already linked to an employee.";
    case "account-invalid": return "That POS account is not valid.";
    case "unknown-employee": return "That employee could not be found.";
    case "reason-required": return "Choose the reason: this employee already has a POS account.";
    case "reason-not-needed": return "This employee has no POS account yet, so no reason is needed.";
    case "reason-invalid": return "Choose the reason from the list.";
    default: return "Something went wrong. Reload the page and try again.";
  }
}
