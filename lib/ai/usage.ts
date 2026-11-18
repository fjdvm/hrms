import { randomInt } from "node:crypto";
import type { Database } from "@/lib/database";
import type { AiFeature, AiReason } from "./messages";
import { codeFor } from "./messages";

/** Six characters, no 0/O/1/I/L so a Staff member can read one out over the phone. */
const REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const newReferenceId = (): string => Array.from({ length: 6 }, () => REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)]).join("");

/**
 * Checks the daily limits and writes the usage row in one statement (the `hrms_ai_reserve` function, migration 0049), so two
 * requests at the same moment cannot both take the last slot. A reserved request is `pending` and already holds its slot.
 */
export async function reserveUsage(db: Database, input: { staffId: string; feature: AiFeature; model: string; limit: number; budget: number | null; now: Date }) {
  const { rows } = await db.query<{ usage_id: number; refusal: "AI-0089" | "AI-0090" | null }>(
    `SELECT usage_id, refusal FROM public.hrms_ai_reserve($1, $2, $3, $4, $5, $6)`,
    [input.staffId, input.feature, input.model, input.limit, input.budget, input.now.toISOString()],
  );
  const { usage_id, refusal } = rows[0];
  return { usageId: usage_id, refusal: refusal === "AI-0089" ? ("limit-reached" as const) : refusal === "AI-0090" ? ("budget-reached" as const) : null };
}

/** Logs a request that was refused before any slot was considered (the feature is switched off). It counts for nothing. */
export async function logRefusal(db: Database, input: { staffId: string; feature: AiFeature; model: string; reason: AiReason; now: Date }): Promise<void> {
  await db.query(
    `INSERT INTO public.hrms_ai_usage (staff_id, feature, model, outcome, error_code, error_reason, counts_toward_limit, created_at) VALUES ($1, $2, $3, 'refused', $4, $5, false, $6)`,
    [input.staffId, input.feature, input.model, codeFor(input.reason), input.reason, input.now.toISOString()],
  );
}

export type Settlement =
  | { outcome: "success"; inputTokens: number; outputTokens: number }
  | { outcome: "failed" | "unusable"; reason: AiReason; countsTowardLimit: boolean; referenceId: string | null; inputTokens: number; outputTokens: number };

const isUniqueViolation = (error: unknown) => (error as { code?: string } | null)?.code === "23505";

/**
 * Records how a reserved request ended. A request the provider failed on gives its slot back (counts_toward_limit false);
 * an unusable result keeps it. Returns the Reference ID that was stored, if any (a random id that was taken is replaced by another).
 */
export async function settleUsage(db: Database, usageId: number, result: Settlement): Promise<string | null> {
  if (result.outcome === "success") {
    await db.query(`UPDATE public.hrms_ai_usage SET outcome = 'success', input_tokens = $2, output_tokens = $3 WHERE id = $1`, [usageId, result.inputTokens, result.outputTokens]);
    return null;
  }
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const referenceId = result.referenceId === null ? null : attempt === 0 ? result.referenceId : newReferenceId();
    try {
      await db.query(
        `UPDATE public.hrms_ai_usage SET outcome = $2, error_code = $3, error_reason = $4, reference_id = $5, counts_toward_limit = $6, input_tokens = $7, output_tokens = $8 WHERE id = $1`,
        [usageId, result.outcome, codeFor(result.reason), result.reason, referenceId, result.countsTowardLimit, result.inputTokens, result.outputTokens],
      );
      return referenceId;
    } catch (error) {
      if (!isUniqueViolation(error) || result.referenceId === null) throw error;
    }
  }
  throw new Error("Could not store a unique Reference ID");
}

/** How many of the Staff member's daily slots for a feature are used on the Manila day of `now`. A user action reads this (the dialog opening); nothing polls it. */
export async function usedToday(db: Database, staffId: string, feature: AiFeature, now: Date = new Date()): Promise<number> {
  const { rows } = await db.query<{ used: number }>(
    `SELECT count(*)::int AS used FROM public.hrms_ai_usage WHERE staff_id = $1 AND feature = $2 AND counts_toward_limit AND usage_day = ($3::timestamptz AT TIME ZONE 'Asia/Manila')::date`,
    [staffId, feature, now.toISOString()],
  );
  return rows[0].used;
}
