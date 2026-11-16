import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import type { Staff } from "./portal/client";
import { kpiModule, type Actor } from "./performance-kpis";

/**
 * The Performance interface: the single seam every Performance ticket extends. It owns the access rule and composes the
 * small domain modules behind it (scoring, attendance, periods, KPIs, evaluations, shift); screens call it and hold no
 * rule of their own.
 */

export { KpiError, type Kpi, type KpiProblem, type KpiStatus, type WeightSet, type Weights } from "./performance-kpis";

export class PerformanceError extends Error {
  constructor(public readonly reason: "invalid" | "unavailable" | "denied") {
    super(`Performance: ${reason}`);
  }
}

export type PerformanceAccess = { decision: "allowed"; staff: Staff } | { decision: "denied" };

/**
 * Server-side boundary. Rechecks the Portal on every operation; `db` and `now` are injectable so tests control the
 * database and the clock. Later domain modules take the same `db` and `now`.
 */
export function performanceFor(sessionHandle: string | undefined, db: Database = database, now: () => Date = () => new Date()) {
  // Held for the domain modules later tickets add.
  void now;
  const kpis = kpiModule(db);

  /**
   * The Performance Module grant alone decides (ADR-0004): no manager permission, no role names. A session the Portal
   * rejects or cannot answer for throws, so it is never read as "no access".
   */
  async function access(): Promise<PerformanceAccess> {
    const result = await accessFor(sessionHandle).check("Performance");
    if (result.decision === "invalid" || result.decision === "unavailable") throw new PerformanceError(result.decision);
    return result.decision === "allowed" ? { decision: "allowed", staff: result.staff } : { decision: "denied" };
  }

  /** Every operation proves the Module first and names who is acting, so each change records its Staff member. */
  async function acting(): Promise<Actor> {
    const result = await access();
    if (result.decision !== "allowed") throw new PerformanceError("denied");
    return { id: result.staff.id ?? result.staff.username, name: result.staff.name };
  }

  return {
    access,
    /** The five KPIs with their source, target, status and weight in the default set. */
    listKpis: async () => { await acting(); return kpis.listKpis(); },
    /** Activates or deactivates a KPI. There is no delete: a KPI an Evaluation used must stay explainable. */
    setKpiStatus: async (id: string, status: string) => kpis.setKpiStatus(await acting(), id, status),
    /** The default set, then the position sets, each with its total. */
    listWeightSets: async () => { await acting(); return kpis.listWeightSets(); },
    /** Creates a position set, or edits a set by `id`. Refused unless the weights total 100. */
    saveWeightSet: async (input: { id?: number; position?: string | null; weights: unknown }) => kpis.saveWeightSet(await acting(), input),
    /** The set that scores an Employee with this position, with its name; the default when no position set matches. */
    weightSetFor: async (position: string | null | undefined) => { await acting(); return kpis.weightSetFor(position); },
  };
}
