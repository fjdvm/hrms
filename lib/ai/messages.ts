/**
 * The one place that turns an AI failure reason into an internal code, a banner colour and the message Staff read
 * (docs/ai-error-codes.md). Screens and server actions never write a code or a message themselves.
 *
 * A code is internal: it goes in logs and the usage table, and no message ever contains one. On a red banner Staff see a
 * Reference ID instead, which support looks up in the usage log.
 */
export type AiFeature = "job-draft" | "suggestions";

export type AiCode = "AI-0089" | "AI-0090" | "AI-0091" | "AI-0092" | "AI-0093" | "AI-0094" | "AI-0100";
export type AiBanner = "yellow" | "red" | "grey" | "none";

/** Why a request was refused or failed. Several reasons can share one code: the finer reason is logged, not shown. */
export type AiReason =
  | "limit-reached" // AI-0089
  | "budget-reached" // AI-0090
  | "provider-rate-limit" // AI-0091: the provider's own rate limit
  | "provider-quota" // AI-0091: its quota or billing (shown as "busy", never as billing)
  | "provider-unavailable" // AI-0091: down, or the network failed
  | "provider-rejected" // AI-0091: it refused our request (bad key, bad request)
  | "timeout" // AI-0092
  | "unusable" // AI-0093
  | "feature-off" // AI-0094
  | "not-available"; // AI-0100

const CODES: Record<AiReason, { code: AiCode; banner: AiBanner }> = {
  "limit-reached": { code: "AI-0089", banner: "yellow" },
  "budget-reached": { code: "AI-0090", banner: "yellow" },
  "provider-rate-limit": { code: "AI-0091", banner: "red" },
  "provider-quota": { code: "AI-0091", banner: "red" },
  "provider-unavailable": { code: "AI-0091", banner: "red" },
  "provider-rejected": { code: "AI-0091", banner: "red" },
  timeout: { code: "AI-0092", banner: "red" },
  unusable: { code: "AI-0093", banner: "red" },
  "feature-off": { code: "AI-0094", banner: "none" },
  "not-available": { code: "AI-0100", banner: "grey" },
};

/** Does a request that failed for this reason use one of the Staff member's daily slots? A refusal and a provider-side failure do not. */
export const COUNTS_TOWARD_LIMIT: Record<AiReason, boolean> = {
  "limit-reached": false,
  "budget-reached": false,
  "provider-rate-limit": false,
  "provider-quota": false,
  "provider-unavailable": false,
  "provider-rejected": false,
  timeout: false,
  unusable: true,
  "feature-off": false,
  "not-available": false,
};

export type AiFailure = {
  reason: AiReason;
  code: AiCode;
  banner: AiBanner;
  /** What Staff read. Null when nothing is shown (AI-0094: the button is hidden or disabled with a tooltip). */
  message: string | null;
  /** A random six-character id, only on a red banner. It is also stored on the usage row. */
  referenceId: string | null;
};

const NAMES = {
  "job-draft": { plural: "AI drafts", noun: "drafting", alternative: "write the posting yourself", unusable: "The AI draft couldn't be used. Please try again or write it yourself." },
  suggestions: { plural: "AI suggestions", noun: "suggestions", alternative: "flag development needs yourself", unusable: "The AI suggestions couldn't be used. Please try again or flag a development need yourself." },
} satisfies Record<AiFeature, { plural: string; noun: string; alternative: string; unusable: string }>;

/** The message Staff read for a reason in a feature. `limit` is the feature's daily allowance, named in the limit message. */
export function aiMessage(reason: AiReason, feature: AiFeature, limit: number): string | null {
  const names = NAMES[feature];
  switch (reason) {
    case "limit-reached": return `You've used all ${limit} ${names.plural} today. The limit resets at 12:00 AM Manila time. You can still ${names.alternative}.`;
    case "budget-reached": return `AI ${names.noun} ${feature === "job-draft" ? "is" : "are"} unavailable right now. Please try again tomorrow.`;
    case "provider-rate-limit":
    case "provider-quota":
    case "provider-unavailable":
    case "provider-rejected": return "The AI service is busy. Please try again in a moment.";
    case "timeout": return "That took too long. Please try again.";
    case "unusable": return names.unusable;
    case "feature-off": return null;
    case "not-available": return feature === "suggestions"
      ? "Suggestions aren't available for this evaluation: it has Insufficient data, so there are too few KPI results to suggest from."
      : null;
  }
}

export const codeFor = (reason: AiReason): AiCode => CODES[reason].code;
export const bannerFor = (reason: AiReason): AiBanner => CODES[reason].banner;
/** Red errors show a Reference ID; yellow, grey and silent outcomes do not. */
export const showsReferenceId = (reason: AiReason): boolean => CODES[reason].banner === "red";

/** The whole failure for a reason, as the screen needs it. Pass the Reference ID only for a red one. */
export function describeFailure(reason: AiReason, feature: AiFeature, limit: number, referenceId: string | null = null): AiFailure {
  const { code, banner } = CODES[reason];
  return { reason, code, banner, message: aiMessage(reason, feature, limit), referenceId: showsReferenceId(reason) ? referenceId : null };
}
