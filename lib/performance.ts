import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import type { Staff } from "./portal/client";

/**
 * The Performance interface: the single seam every Performance ticket extends. It owns the access rule today and
 * grows small domain modules (scoring, attendance, periods, KPIs, evaluations, shift) behind it; screens call it
 * and hold no rule of their own.
 */

export class PerformanceError extends Error {
  constructor(public readonly reason: "invalid" | "unavailable") {
    super(`Performance: ${reason}`);
  }
}

export type PerformanceAccess = { decision: "allowed"; staff: Staff } | { decision: "denied" };

/**
 * Server-side boundary. Rechecks the Portal on every operation; `db` and `now` are injectable so tests control the
 * database and the clock. Later domain modules take the same `db` and `now`.
 */
export function performanceFor(sessionHandle: string | undefined, db: Database = database, now: () => Date = () => new Date()) {
  // Held for the domain modules later tickets add; the access rule needs neither.
  void db;
  void now;

  /**
   * The Performance Module grant alone decides (ADR-0004): no manager permission, no role names. A session the Portal
   * rejects or cannot answer for throws, so it is never read as "no access".
   */
  async function access(): Promise<PerformanceAccess> {
    const result = await accessFor(sessionHandle).check("Performance");
    if (result.decision === "invalid" || result.decision === "unavailable") throw new PerformanceError(result.decision);
    return result.decision === "allowed" ? { decision: "allowed", staff: result.staff } : { decision: "denied" };
  }

  return { access };
}
