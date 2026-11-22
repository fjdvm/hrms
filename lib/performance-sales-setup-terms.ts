import { readGoLiveDate } from "./performance-pos-settings";
import { readSalesTarget, SALES_TARGET_MAX } from "./performance-sales-inputs";

/**
 * The rules behind the Sales settings dialog in KPI Setup, as pure functions that mirror the server's: the dialog shows errors as the Staff member
 * types, and the server (`setSalesTarget`, `setPosGoLive`) still has the final say. They call the interface's own readers, so the dialog and the
 * server refuse the same things with the same words.
 */

export const TARGET_MESSAGE = `Enter the target in pesos per present day: more than 0, up to ₱${SALES_TARGET_MAX.toLocaleString("en-PH")}, with at most 2 decimals.`;
export const GO_LIVE_MESSAGE = "Choose a real calendar date.";
export const TARGET_REQUIRED_MESSAGE = "Enter the sales target. A target that is set can be changed, not cleared.";
export const GO_LIVE_REQUIRED_MESSAGE = "Choose the go-live date. A date that is set can be changed, not cleared.";

export type SalesSettingsInput = { target: string; goLive: string };
export type SalesSettingsCurrent = { target: number | null; goLive: string | null };
export type SalesSettingsState = {
  targetError: string | null; goLiveError: string | null;
  /** What Save would send: only the fields that changed and are valid. */
  changes: { target?: number; goLive?: string };
  canSave: boolean;
};

/** The target as typed: a peso amount, or empty when none is set yet. */
function targetOf(text: string): { value: number | null; error: string | null } {
  if (text.trim() === "") return { value: null, error: null };
  try { return { value: readSalesTarget(text), error: null }; } catch { return { value: null, error: TARGET_MESSAGE }; }
}
function goLiveOf(text: string): { value: string | null; error: string | null } {
  if (text.trim() === "") return { value: null, error: null };
  try { return { value: readGoLiveDate(text), error: null }; } catch { return { value: null, error: GO_LIVE_MESSAGE }; }
}

/** Checks the two fields as typed against what is saved now. A field left empty is fine only while nothing was saved for it. */
export function checkSalesSettings(input: SalesSettingsInput, current: SalesSettingsCurrent): SalesSettingsState {
  const target = targetOf(input.target);
  const goLive = goLiveOf(input.goLive);
  const targetError = target.error ?? (input.target.trim() === "" && current.target !== null ? TARGET_REQUIRED_MESSAGE : null);
  const goLiveError = goLive.error ?? (input.goLive.trim() === "" && current.goLive !== null ? GO_LIVE_REQUIRED_MESSAGE : null);
  const changes: SalesSettingsState["changes"] = {};
  if (targetError === null && target.value !== null && target.value !== current.target) changes.target = target.value;
  if (goLiveError === null && goLive.value !== null && goLive.value !== current.goLive) changes.goLive = goLive.value;
  return { targetError, goLiveError, changes, canSave: targetError === null && goLiveError === null && Object.keys(changes).length > 0 };
}
