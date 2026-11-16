import type { SubmitCheck } from "./performance-evaluations-terms";
import type { SubmitProblem } from "./performance-submit";

/** What HR reads when a submit is refused. The server action and the Submit evaluation dialog use the same words. */
export function submitMessage(problem: SubmitProblem, missing: readonly Pick<SubmitCheck, "reason">[] = []): string {
  switch (problem) {
    case "checks-missing": {
      const reasons = missing.map((check) => check.reason).filter((reason): reason is string => Boolean(reason));
      return reasons.length ? `This evaluation can’t be submitted yet. ${reasons.join(" ")}` : "This evaluation can’t be submitted yet: a check is not met.";
    }
    case "already-submitted": return "This evaluation is already submitted. Reload the page.";
    case "changed": return "This evaluation changed while you were submitting. Reload the page, review it, then submit again.";
    default: return "Something went wrong. Reload the page and try again.";
  }
}
