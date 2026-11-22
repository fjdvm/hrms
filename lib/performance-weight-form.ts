import { KpiError, readPosition, WEIGHT_SET_TOTAL, type WeightSet, type Weights } from "./performance-kpis";
import { kpiMessage, POSITION_TAKEN_MESSAGE } from "./performance-kpi-messages";
import { CORE_KPI_IDS as KPI_IDS, type CoreKpiId as KpiId } from "./performance-scoring";
import { matchKey } from "./validators/text";

/**
 * The rules behind the New weight set dialog, as pure functions that mirror the server's: the dialog shows errors as the
 * Staff member types, and the server (`saveWeightSet`) still has the final say. They reuse the interface's own readers, so
 * the dialog and the server refuse the same things with the same words.
 */

export type BaseChoice = "default" | "blank" | "another";
/** The weights as typed, one text per KPI; empty counts as 0. */
export type WeightTexts = Record<KpiId, string>;
export const BASE_CHOICES: readonly { id: BaseChoice; label: string; help: string }[] = [
  { id: "default", label: "Default set", help: "Copying the default set gives the five starter KPIs and their weights." },
  { id: "blank", label: "Blank", help: "Starts every weight at 0. Enter the weights so they total 100." },
  { id: "another", label: "Another set", help: "Copies the weights of another position's set." },
];

const textsOf = (weights: Weights): WeightTexts => Object.fromEntries(KPI_IDS.map((kpi) => [kpi, String(weights[kpi])])) as WeightTexts;
export const BLANK_WEIGHTS: WeightTexts = Object.fromEntries(KPI_IDS.map((kpi) => [kpi, "0"])) as WeightTexts;

/** The weights a new set starts with: a copy of the default set, all zero, or a copy of another set. */
export function startingWeights(base: BaseChoice, sets: readonly WeightSet[], anotherId?: number): WeightTexts {
  if (base === "blank") return { ...BLANK_WEIGHTS };
  const source = base === "another" ? sets.find((set) => set.id === anotherId && !set.isDefault) : sets.find((set) => set.isDefault);
  return source ? textsOf(source.weights) : { ...BLANK_WEIGHTS };
}

/** A weight typed as text: whole digits only; anything else is not a weight. Empty is 0. */
export function weightOf(text: string): number | null {
  if (text.trim() === "") return 0;
  return /^\d{1,3}$/.test(text.trim()) ? Number(text.trim()) : null;
}

/** The running total of the weights typed so far; a weight that is not a whole number adds nothing. */
export const totalOf = (texts: WeightTexts) => KPI_IDS.reduce((sum, kpi) => sum + (weightOf(texts[kpi]) ?? 0), 0);

/** The set that already has this position (exact match, ignoring case and extra spaces), if any. */
export function setForPosition(position: string, sets: readonly WeightSet[]): WeightSet | undefined {
  const key = matchKey(position);
  return key ? sets.find((set) => !set.isDefault && set.position !== null && matchKey(set.position) === key) : undefined;
}

export type WeightFormState = {
  /** The cleaned position, once it is valid. */
  position: string | null;
  positionError: string | null;
  weightsError: string | null;
  total: number;
  /** True when Create set may be pressed: a valid, free position and weights that total 100. */
  canCreate: boolean;
};

/** Checks the position and weights as typed. `positionError` is empty until something is typed, so a fresh dialog is not red. */
export function checkWeightForm(positionText: string, texts: WeightTexts, sets: readonly WeightSet[]): WeightFormState {
  const total = totalOf(texts);
  let position: string | null = null;
  let positionError: string | null = null;
  if (positionText.trim() !== "") {
    try {
      position = readPosition(positionText);
      if (setForPosition(position, sets)) positionError = POSITION_TAKEN_MESSAGE;
    } catch (error) {
      if (!(error instanceof KpiError)) throw error;
      positionError = kpiMessage(error.problem);
    }
  }
  const parsed = KPI_IDS.map((kpi) => weightOf(texts[kpi]));
  const weightsError = parsed.some((value) => value === null) ? kpiMessage("weights-invalid") : total !== WEIGHT_SET_TOTAL ? kpiMessage("weights-total", { total }) : null;
  return { position, positionError, weightsError, total, canCreate: position !== null && positionError === null && weightsError === null };
}

/** The weights to send, from texts that already passed `checkWeightForm`. */
export function weightsFrom(texts: WeightTexts): Weights {
  return Object.fromEntries(KPI_IDS.map((kpi) => [kpi, weightOf(texts[kpi]) ?? 0])) as Weights;
}
