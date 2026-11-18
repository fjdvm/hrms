import type { Database } from "@/lib/database";
import { readAiConfig, type AiConfig } from "./config";
import { createOpenAiClient, type AiClient, type AiRequest } from "./openai";
import { COUNTS_TOWARD_LIMIT, codeFor, describeFailure, showsReferenceId, type AiFailure, type AiFeature, type AiReason } from "./messages";
import { logRefusal, newReferenceId, reserveUsage, settleUsage, usedToday } from "./usage";

export type AiResult<T> = { ok: true; value: T } | ({ ok: false } & AiFailure);

export type RunAiInput<T> = {
  db: Database;
  /** The Staff member (their Portal id). The caller has already checked their Module access. */
  staffId: string;
  feature: AiFeature;
  /** The model is filled in from the config. */
  request: Omit<AiRequest, "model">;
  /** Checks the provider's output against our own schema (and any wording check). Returns the usable value, or null when it cannot be used. `attempt` is 0 for the first try and 1 for the regeneration. */
  parse: (output: unknown, attempt: number) => T | null;
  /** The provider seam. Defaults to a real OpenAI client; tests pass a fake. */
  client?: AiClient;
  config?: AiConfig;
  now?: () => Date;
  /** An unusable result is regenerated once (so two tries), then reported as AI-0093. */
  attempts?: number;
};

/**
 * Runs one AI request for a Staff member: refuses it when the feature is off or a limit is reached, calls the provider, checks the
 * result, and records the request in the usage log. It never throws for an AI problem; it returns a typed failure that carries the
 * message and (on a red error) a Reference ID. The prompt and the output are never logged.
 */
export async function runAi<T>(input: RunAiInput<T>): Promise<AiResult<T>> {
  const config = input.config ?? readAiConfig();
  const client = input.client ?? createOpenAiClient({ apiKey: config.apiKey });
  const now = input.now ?? (() => new Date());
  const { db, staffId, feature } = input;
  const limit = config.limits[feature];
  const fail = (reason: AiReason, referenceId: string | null = null): AiResult<T> => ({ ok: false, ...describeFailure(reason, feature, limit, referenceId) });

  if (!config.enabled[feature]) {
    await logRefusal(db, { staffId, feature, model: config.model, reason: "feature-off", now: now() });
    return fail("feature-off");
  }

  const reservation = await reserveUsage(db, { staffId, feature, model: config.model, limit, budget: config.budget, now: now() });
  if (reservation.refusal) return fail(reservation.refusal);

  let inputTokens = 0;
  let outputTokens = 0;
  let reason: AiReason = "unusable";
  let value: T | null = null;
  try {
    for (let attempt = 0; attempt < (input.attempts ?? 2) && value === null; attempt += 1) {
      const result = await client({ ...input.request, model: config.model });
      inputTokens += result.ok ? result.inputTokens : (result.inputTokens ?? 0);
      outputTokens += result.ok ? result.outputTokens : (result.outputTokens ?? 0);
      if (result.ok) {
        try { value = input.parse(result.output, attempt); } catch { value = null; }
        reason = "unusable";
      } else if (result.reason === "bad-response") {
        reason = "unusable";
      } else {
        // The provider failed on its side: no retry, and the slot is given back.
        reason = result.reason;
        break;
      }
    }
  } catch {
    // A client that throws is a provider failure we could not classify.
    reason = "provider-unavailable";
  }

  if (value !== null) {
    await settleUsage(db, reservation.usageId, { outcome: "success", inputTokens, outputTokens });
    return { ok: true, value };
  }

  const stored = await settleUsage(db, reservation.usageId, {
    outcome: reason === "unusable" ? "unusable" : "failed",
    reason,
    countsTowardLimit: COUNTS_TOWARD_LIMIT[reason],
    referenceId: showsReferenceId(reason) ? newReferenceId() : null,
    inputTokens,
    outputTokens,
  });
  // The real reason (a quota error, say) goes to the server log with the Reference ID. Staff only ever see the generic message.
  console.error(`[ai] ${codeFor(reason)} ${reason} feature=${feature}${stored ? ` ref=${stored}` : ""}`);
  return fail(reason, stored);
}

/** Drafts left today for a Staff member, for the dialog to show when it opens. */
export async function draftsLeft(db: Database, staffId: string, feature: AiFeature, config: AiConfig = readAiConfig(), now: Date = new Date()): Promise<number> {
  return Math.max(0, config.limits[feature] - (await usedToday(db, staffId, feature, now)));
}
