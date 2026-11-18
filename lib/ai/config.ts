import type { AiFeature } from "./messages";

/**
 * AI settings, all environment variables, read on the server only. The key is never in a NEXT_PUBLIC_ variable and never in
 * anything sent to the browser.
 *
 *   OPENAI_API_KEY               the provider key (secret)
 *   OPENAI_MODEL                 default gpt-4.1-mini
 *   AI_JOB_DRAFTER_ENABLED       default on; false, 0, off or no switches the Job description drafter off
 *   AI_SUGGESTIONS_ENABLED       default on; the same for Development suggestions
 *   AI_DAILY_LIMIT_JOB_DRAFT     drafts per Staff member per Manila day, default 20
 *   AI_DAILY_LIMIT_SUGGESTIONS   suggestion runs per Staff member per Manila day, default 60
 *   AI_DAILY_BUDGET              company-wide calls per Manila day across all features; unset means no cap (200 in production)
 */
export const DEFAULT_MODEL = "gpt-4.1-mini";
export const DEFAULT_LIMITS: Record<AiFeature, number> = { "job-draft": 20, suggestions: 60 };

export type AiConfig = {
  apiKey: string | null;
  model: string;
  enabled: Record<AiFeature, boolean>;
  limits: Record<AiFeature, number>;
  /** Company-wide calls per Manila day, or null for no cap. */
  budget: number | null;
};

type Env = Record<string, string | undefined>;

const positiveInteger = (value: string | undefined): number | null => {
  const text = value?.trim();
  if (!text || !/^[0-9]+$/.test(text)) return null;
  const number = Number(text);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
};
const isOn = (value: string | undefined) => !["false", "0", "off", "no"].includes(value?.trim().toLowerCase() ?? "");

export function readAiConfig(env: Env = process.env): AiConfig {
  return {
    apiKey: env.OPENAI_API_KEY?.trim() || null,
    model: env.OPENAI_MODEL?.trim() || DEFAULT_MODEL,
    enabled: { "job-draft": isOn(env.AI_JOB_DRAFTER_ENABLED), suggestions: isOn(env.AI_SUGGESTIONS_ENABLED) },
    limits: {
      "job-draft": positiveInteger(env.AI_DAILY_LIMIT_JOB_DRAFT) ?? DEFAULT_LIMITS["job-draft"],
      suggestions: positiveInteger(env.AI_DAILY_LIMIT_SUGGESTIONS) ?? DEFAULT_LIMITS.suggestions,
    },
    budget: positiveInteger(env.AI_DAILY_BUDGET),
  };
}
