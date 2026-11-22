import type { Database } from "./database";
import type { Actor } from "./performance-kpis";

/**
 * The POS go-live date: the first production day HRMS may read POS sales from. Until it is set, an import is refused, and no import ever
 * reads a day before it, so test data in the POS is never read. One of the settings in `hrms_performance_settings`; changing it is audited.
 */

export const POS_GO_LIVE_KEY = "pos_go_live_date";

export type GoLiveProblem = "date-invalid";
export class GoLiveError extends Error {
  constructor(public readonly problem: GoLiveProblem) {
    super(`POS go-live: ${problem}`);
  }
}

export type GoLive = { date: string; setByName: string; setAt: string };

/** A real calendar date as "YYYY-MM-DD", or refused. */
export function readGoLiveDate(input: unknown): string {
  const text = typeof input === "string" ? input.trim() : "";
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(`${text}T00:00:00Z`).toISOString().slice(0, 10) === text;
  if (!valid) throw new GoLiveError("date-invalid");
  return text;
}

export function posSettingsModule(db: Database) {
  async function goLive(): Promise<GoLive | null> {
    const { rows } = await db.query<GoLive>(`SELECT value AS date, updated_by_name AS "setByName", updated_at::text AS "setAt" FROM public.hrms_performance_settings WHERE key = $1`, [POS_GO_LIVE_KEY]);
    return rows[0] ?? null;
  }

  /** Sets the go-live date. Setting the same date again changes and records nothing. The change and its audit row are one statement. */
  async function setGoLive(actor: Actor, input: unknown): Promise<GoLive> {
    const date = readGoLiveDate(input);
    await db.query(`
      WITH previous AS (SELECT value FROM public.hrms_performance_settings WHERE key = $1), changed AS (
        INSERT INTO public.hrms_performance_settings (key, value, updated_by_id, updated_by_name) VALUES ($1, $2, $3, $4)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by_id = EXCLUDED.updated_by_id, updated_by_name = EXCLUDED.updated_by_name, updated_at = clock_timestamp()
        WHERE public.hrms_performance_settings.value <> EXCLUDED.value RETURNING value
      ) INSERT INTO public.hrms_performance_audit (actor_id, actor_name, action, subject, subject_id, detail)
        SELECT $3, $4, 'pos-go-live-date-set', 'setting', $1, jsonb_build_object('from', (SELECT value FROM previous), 'to', changed.value) FROM changed`, [POS_GO_LIVE_KEY, date, actor.id, actor.name]);
    return (await goLive())!;
  }

  return { goLive, setGoLive };
}
