import type { Database } from "./database";
import { auditStep, deliverAuditEvents } from "./audit";
import type { Actor } from "./performance-kpis";

/**
 * Every Performance mutation writes its change, its Audit event, its local history row (`hrms_performance_audit`) and any Staff
 * notification in one SQL statement. This builds the Audit event's step for that statement: it appends the event's two values to the
 * statement's own positional `values`, and returns the INSERT to use as a step. After the statement commits, `deliver()` sends the event
 * at once; a failure leaves it queued for the maintenance route and never undoes the Staff action.
 *
 * The step selects FROM the change (`from`, aliased `src`, one row when something changed), so a refused or lost mutation queues nothing.
 * Metadata holds ids, counts and flags only: never ratings' comments, reasons or other Staff-typed text.
 */
export function performanceAudit(db: Database, actor: Actor, values: unknown[]) {
  const ids: string[] = [];
  return {
    step(action: string, target: { type: string; id: string; display_name: string }, description: string, from: string, extra?: string) {
      const built = auditStep({ module: "Performance", action, staff: { id: actor.id, username: actor.id, name: actor.name }, target, description }, values.length + 1, from, extra);
      values.push(...built.values);
      ids.push(built.id);
      return built.sql;
    },
    deliver: () => Promise.all(ids.map((id) => deliverAuditEvents(db, id))),
  };
}

/** At most this many dates or ids are listed in an event's metadata; the count is always exact, so metadata stays within 4 KB. */
export const LISTED = 100;
