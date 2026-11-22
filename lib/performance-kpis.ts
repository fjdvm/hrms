import type { Database } from "./database";
import { performanceAudit } from "./performance-audit";
import { KPI_IDS, type KpiId } from "./performance-scoring";
import { cleanText, hasControlCharacters, matchKey, nameProblem } from "./validators/text";

/**
 * The KPIs and the weight sets that score everyone with them. One of the small domain modules behind the Performance
 * interface: it owns these rules and takes the Staff member and the database from the seam, so access is decided there.
 *
 * A KPI is activated or deactivated, never deleted. A weight set gives every KPI a whole-number weight and the weights
 * total 100. There is one default set, which applies to everyone, and at most one set per position; a position set
 * applies when the Employee's position text matches exactly, ignoring case and extra spaces.
 */

export type KpiStatus = "Active" | "Inactive";
export const KPI_STATUSES: readonly KpiStatus[] = ["Active", "Inactive"];

export type Kpi = { id: KpiId; name: string; description: string; source: string; target: string; status: KpiStatus; defaultWeight: number };
export type Weights = Record<KpiId, number>;
export type WeightSet = { id: number; name: string; isDefault: boolean; position: string | null; weights: Weights; total: number; updatedByName: string; updatedAt: string };
export type Actor = { id: string; name: string };

/** Why a KPI or weight-set change was refused, so a screen can say so. */
export type KpiProblem =
  | "unknown-kpi" | "unknown-status"
  | "weights-invalid" | "weights-total"
  | "position-empty" | "position-too-long" | "position-characters" | "position-taken" | "default-position"
  | "unknown-set";

export class KpiError extends Error {
  /** `total` accompanies weights-total; `conflictsWith` names the set that already owns the position. */
  constructor(public readonly problem: KpiProblem, public readonly extra: { total?: number; conflictsWith?: string } = {}) {
    super(`KPI: ${problem}`);
  }
}

export const POSITION_MAX_LENGTH = 100;
export const WEIGHT_SET_TOTAL = 100;

/** A KPI with no weight counts as 0, so a set read before a newer KPI was weighed still totals correctly. */
export const weightsTotal = (weights: Partial<Weights>) => KPI_IDS.reduce((sum, kpi) => sum + (weights[kpi] ?? 0), 0);

/** Reads the five weights from untrusted input: exactly the five KPIs, each a whole number from 0 to 100. */
export function readWeights(input: unknown): Weights {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new KpiError("weights-invalid");
  const given = input as Record<string, unknown>;
  const keys = Object.keys(given);
  if (keys.length !== KPI_IDS.length || keys.some((key) => !(KPI_IDS as readonly string[]).includes(key))) throw new KpiError("weights-invalid");
  const weights = {} as Weights;
  for (const kpi of KPI_IDS) {
    const value = given[kpi];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > WEIGHT_SET_TOTAL) throw new KpiError("weights-invalid");
    weights[kpi] = value;
  }
  const total = weightsTotal(weights);
  if (total !== WEIGHT_SET_TOTAL) throw new KpiError("weights-total", { total });
  return weights;
}

/** Cleans and checks a position typed for a position set. Refused, not silently changed, when it holds odd characters. */
export function readPosition(input: unknown): string {
  if (typeof input !== "string") throw new KpiError("position-empty");
  if (hasControlCharacters(input)) throw new KpiError("position-characters");
  const cleaned = cleanText(input);
  const problem = nameProblem(cleaned, POSITION_MAX_LENGTH);
  if (problem === "empty") throw new KpiError("position-empty");
  if (problem === "too-long") throw new KpiError("position-too-long");
  if (problem === "characters") throw new KpiError("position-characters");
  return cleaned;
}

type SetRow = {
  id: number; name: string; isDefault: boolean; position: string | null;
  items: Partial<Record<string, number>> | null;
  updatedByName: string; updatedAt: string;
};
/** A weight set's own columns, plus its weights as one JSON object of KPI id to weight, read from the per-KPI rows. */
const SET_COLUMNS = `s.id, s.name, s.is_default AS "isDefault", s.position,
  (SELECT jsonb_object_agg(i.kpi_id, i.weight) FROM public.hrms_weight_set_items i WHERE i.set_id = s.id) AS items,
  s.updated_by_name AS "updatedByName", s.updated_at::text AS "updatedAt"`;
/** The same columns for a row a write just returned: its items are not visible yet, so the caller gives the weights it wrote. */
const WRITTEN_COLUMNS = `s.id, s.name, s.is_default AS "isDefault", s.position, NULL::jsonb AS items, s.updated_by_name AS "updatedByName", s.updated_at::text AS "updatedAt"`;
/** One item row per KPI for the set a CTE returned (`source`), from its weights bound as JSON (KPI id to weight). */
const ITEM_ROWS = (source: string, json: string) => `SELECT ${source}.id, w.key, w.value::int FROM ${source} CROSS JOIN jsonb_each_text(${json}) w`;

function toWeightSet(row: SetRow, written?: Weights): WeightSet {
  // A KPI with no row counts as weight 0.
  const weights = {} as Weights;
  for (const kpi of KPI_IDS) weights[kpi] = written ? written[kpi] : (row.items?.[kpi] ?? 0);
  return { id: row.id, name: row.name, isDefault: row.isDefault, position: row.position, weights, total: weightsTotal(weights), updatedByName: row.updatedByName, updatedAt: row.updatedAt };
}

const isUniqueViolation = (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");

export function kpiModule(db: Database) {
  /** The KPIs in their set order, each with its weight in the default set. */
  async function listKpis(): Promise<Kpi[]> {
    const { rows } = await db.query<Omit<Kpi, "defaultWeight"> & { defaultWeight: number }>(`
      SELECT k.id, k.name, k.description, k.source, k.target, k.status, COALESCE(i.weight, 0) AS "defaultWeight"
      FROM public.hrms_kpis k
      LEFT JOIN public.hrms_weight_sets s ON s.is_default
      LEFT JOIN public.hrms_weight_set_items i ON i.set_id = s.id AND i.kpi_id = k.id
      ORDER BY k.sort_order`);
    return rows;
  }

  /** Activates or deactivates a KPI. Nothing is deleted, and a change to the same status records nothing. */
  async function setKpiStatus(actor: Actor, id: string, status: string): Promise<Kpi[]> {
    if (!(KPI_IDS as readonly string[]).includes(id)) throw new KpiError("unknown-kpi");
    if (!(KPI_STATUSES as readonly string[]).includes(status)) throw new KpiError("unknown-status");
    const values: unknown[] = [id, status, actor.id, actor.name];
    const audit = performanceAudit(db, actor, values);
    const active = status === "Active";
    // One statement: the status change, its history row and its Audit event. The step queues nothing when the status did not change.
    const event = audit.step(active ? "kpi.activated" : "kpi.deactivated", { type: "kpi", id, display_name: id }, `${actor.name} ${active ? "activated" : "deactivated"} the ${id} KPI.`,
      `(SELECT c.id, c.name, c.status FROM changed c) src`,
      `jsonb_build_object('target', jsonb_build_object('type', 'kpi', 'id', src.id, 'display_name', src.name), 'metadata', jsonb_build_object('kpi_id', src.id, 'status', src.status))`);
    await db.query(`
      WITH changed AS (
        UPDATE public.hrms_kpis SET status = $2, updated_by_id = $3, updated_by_name = $4, updated_at = clock_timestamp()
        WHERE id = $1 AND status <> $2 RETURNING id, name, status
      ), logged AS (
        INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $3, $4, CASE WHEN status = 'Active' THEN 'kpi-activated' ELSE 'kpi-deactivated' END, 'kpi', id, jsonb_build_object('status', status) FROM changed
      ), audit AS (${event})
      SELECT id FROM changed`, values);
    await audit.deliver();
    return listKpis();
  }

  /** The default set first, then position sets by position. Each set carries its total. */
  async function listWeightSets(): Promise<WeightSet[]> {
    const { rows } = await db.query<SetRow>(`SELECT ${SET_COLUMNS} FROM public.hrms_weight_sets s ORDER BY s.is_default DESC, s.position_key, s.id`);
    return rows.map((row) => toWeightSet(row));
  }

  /**
   * The set that applies to an Employee with this position: the position set when the text matches exactly (ignoring case
   * and extra spaces), otherwise the default. Returns the set with its name so the Employee page can show it.
   */
  async function weightSetFor(position: string | null | undefined): Promise<WeightSet> {
    const key = typeof position === "string" ? matchKey(position) : "";
    const { rows } = await db.query<SetRow>(
      `SELECT ${SET_COLUMNS} FROM public.hrms_weight_sets s WHERE s.is_default OR ($1 <> '' AND s.position_key = $1) ORDER BY s.is_default LIMIT 1`, [key]);
    return toWeightSet(rows[0]);
  }

  async function ownerOf(position: string, exceptId?: number): Promise<string | undefined> {
    const { rows } = await db.query<{ name: string }>(`SELECT name FROM public.hrms_weight_sets WHERE position_key = $1 AND ($2::int IS NULL OR id <> $2)`, [matchKey(position), exceptId ?? null]);
    return rows[0]?.name;
  }

  /**
   * Creates a position set (no `id`) or edits a set (with its `id`): a position set's weights and position, or the default
   * set's weights. A set is saved only when its weights total 100, however the request arrives.
   */
  async function saveWeightSet(actor: Actor, input: { id?: number; position?: string | null; weights: unknown }): Promise<WeightSet> {
    const weights = readWeights(input.weights);
    const values = KPI_IDS.map((kpi) => weights[kpi]);
    if (input.id === undefined) {
      const position = readPosition(input.position);
      const taken = await ownerOf(position);
      if (taken) throw new KpiError("position-taken", { conflictsWith: taken });
      try {
        const bound: unknown[] = [position, matchKey(position), ...values, actor.id, actor.name, JSON.stringify(weights)];
        const audit = performanceAudit(db, actor, bound);
        // The position is the set's name, which Staff typed; it names the target but stays out of the metadata.
        const event = audit.step("weight_set.created", { type: "weight_set", id: "new", display_name: position }, `${actor.name} created the weight set for ${position}.`,
          `(SELECT c.id, c.position FROM created c) src`,
          `jsonb_build_object('target', jsonb_build_object('type', 'weight_set', 'id', src.id::text, 'display_name', src.position), 'metadata', jsonb_build_object('weight_set_id', src.id, 'is_default', false))`);
        const { rows } = await db.query<SetRow>(`
          WITH created AS (
            INSERT INTO public.hrms_weight_sets (name, is_default, position, position_key, attendance_rate, punctuality, full_shift, training_completion, evaluator_rating,
              created_by_id, created_by_name, updated_by_id, updated_by_name)
            VALUES ($1, false, $1, $2, $3, $4, $5, $6, $7, $8, $9, $8, $9) RETURNING *
          ), logged AS (
            INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
            SELECT $8, $9, 'weight-set-created', 'weight-set', id::text, jsonb_build_object('position', position, 'weights', $10::jsonb) FROM created
          ), items AS (
            INSERT INTO public.hrms_weight_set_items (set_id, kpi_id, weight) ${ITEM_ROWS("created", "$10::jsonb")}
          ), audit AS (${event})
          SELECT ${WRITTEN_COLUMNS} FROM created s`, bound);
        await audit.deliver();
        return toWeightSet(rows[0], weights);
      } catch (error) {
        if (isUniqueViolation(error)) throw new KpiError("position-taken", { conflictsWith: (await ownerOf(position)) ?? position });
        throw error;
      }
    }

    if (!Number.isInteger(input.id) || input.id < 1 || input.id > 2147483647) throw new KpiError("unknown-set");
    const existing = (await db.query<{ isDefault: boolean }>(`SELECT is_default AS "isDefault" FROM public.hrms_weight_sets WHERE id = $1`, [input.id])).rows[0];
    if (!existing) throw new KpiError("unknown-set");
    // The default set applies to everyone, so only its weights change; it has no position.
    let position: string | null = null;
    if (existing.isDefault) {
      if (input.position !== undefined && input.position !== null) throw new KpiError("default-position");
    } else {
      position = readPosition(input.position);
    }
    if (position !== null) {
      const taken = await ownerOf(position, input.id);
      if (taken) throw new KpiError("position-taken", { conflictsWith: taken });
    }
    try {
      const bound: unknown[] = [input.id, position, position === null ? null : matchKey(position), ...values, actor.id, actor.name, JSON.stringify(weights)];
      const audit = performanceAudit(db, actor, bound);
      const event = audit.step("weight_set.updated", { type: "weight_set", id: String(input.id), display_name: position ?? "Default weight set" }, `${actor.name} updated the weight set for ${position ?? "everyone (the default set)"}.`,
        `(SELECT u.id, u.name, u.is_default FROM updated u) src`,
        `jsonb_build_object('target', jsonb_build_object('type', 'weight_set', 'id', src.id::text, 'display_name', src.name), 'metadata', jsonb_build_object('weight_set_id', src.id, 'is_default', src.is_default))`);
      const { rows } = await db.query<SetRow>(`
        WITH updated AS (
          UPDATE public.hrms_weight_sets SET
            name = CASE WHEN is_default THEN name ELSE $2::text END, position = CASE WHEN is_default THEN NULL ELSE $2::text END,
            position_key = CASE WHEN is_default THEN NULL ELSE $3::text END,
            attendance_rate = $4, punctuality = $5, full_shift = $6, training_completion = $7, evaluator_rating = $8,
            updated_by_id = $9, updated_by_name = $10, updated_at = clock_timestamp()
          WHERE id = $1 RETURNING *
        ), logged AS (
          INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
          SELECT $9, $10, 'weight-set-updated', 'weight-set', id::text, jsonb_build_object('position', position, 'weights', $11::jsonb) FROM updated
        ), items AS (
          INSERT INTO public.hrms_weight_set_items (set_id, kpi_id, weight) ${ITEM_ROWS("updated", "$11::jsonb")}
          ON CONFLICT (set_id, kpi_id) DO UPDATE SET weight = EXCLUDED.weight
        ), audit AS (${event})
        SELECT ${WRITTEN_COLUMNS} FROM updated s`, bound);
      await audit.deliver();
      return toWeightSet(rows[0], weights);
    } catch (error) {
      if (isUniqueViolation(error) && position !== null) throw new KpiError("position-taken", { conflictsWith: (await ownerOf(position, input.id)) ?? position });
      throw error;
    }
  }

  return { listKpis, setKpiStatus, listWeightSets, weightSetFor, saveWeightSet };
}
