import { describe, expect, it } from "vitest";
import type { WeightSet } from "@/lib/performance-kpis";
import { BLANK_WEIGHTS, checkWeightForm, setForPosition, startingWeights, totalOf, weightOf, weightsFrom, type WeightTexts } from "@/lib/performance-weight-form";
import { kpiMessage, POSITION_TAKEN_MESSAGE } from "@/lib/performance-kpi-messages";

const set = (id: number, name: string, position: string | null, w: [number, number, number, number, number]): WeightSet => ({
  id, name, isDefault: position === null, position, total: w.reduce((a, b) => a + b, 0), updatedByName: "Ada", updatedAt: "2026-11-16",
  weights: { attendanceRate: w[0], punctuality: w[1], fullShift: w[2], trainingCompletion: w[3], evaluatorRating: w[4] },
});
const SETS = [set(1, "Default set", null, [30, 25, 15, 15, 15]), set(2, "Branch Cashier", "Branch Cashier", [40, 20, 10, 10, 20])];
const texts = (w: [string, string, string, string, string]): WeightTexts => ({ attendanceRate: w[0], punctuality: w[1], fullShift: w[2], trainingCompletion: w[3], evaluatorRating: w[4] });

describe("the weights a new set starts with", () => {
  it("copies the default set, starts blank, or copies another position's set", () => {
    expect(startingWeights("default", SETS)).toEqual(texts(["30", "25", "15", "15", "15"]));
    expect(startingWeights("blank", SETS)).toEqual(BLANK_WEIGHTS);
    expect(startingWeights("another", SETS, 2)).toEqual(texts(["40", "20", "10", "10", "20"]));
  });

  it("never copies the default set as 'another', and falls back to blank when there is nothing to copy", () => {
    expect(startingWeights("another", SETS, 1)).toEqual(BLANK_WEIGHTS);
    expect(startingWeights("another", SETS, 99)).toEqual(BLANK_WEIGHTS);
    expect(startingWeights("another", SETS)).toEqual(BLANK_WEIGHTS);
    expect(startingWeights("default", [])).toEqual(BLANK_WEIGHTS);
  });
});

describe("weights as typed", () => {
  it("reads whole numbers, counts empty as 0 and refuses anything else", () => {
    expect([weightOf("0"), weightOf("30"), weightOf("100"), weightOf(""), weightOf("  7 ")]).toEqual([0, 30, 100, 0, 7]);
    for (const bad of ["-5", "1.5", "abc", "1e2", "1000", "5 5"]) expect(weightOf(bad)).toBeNull();
  });

  it("keeps a running total, ignoring what is not a number", () => {
    expect(totalOf(texts(["30", "25", "15", "15", "15"]))).toBe(100);
    expect(totalOf(texts(["30", "25", "15", "15", ""]))).toBe(85);
    expect(totalOf(texts(["30", "x", "15", "15", "15"]))).toBe(75);
    expect(weightsFrom(texts(["30", "25", "15", "15", ""]))).toEqual({ attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 0 });
  });
});

describe("which set a position already has", () => {
  it("matches exactly, ignoring case and extra spaces, and never the default set", () => {
    expect(setForPosition("  branch   CASHIER ", SETS)?.id).toBe(2);
    expect(setForPosition("Branch Cashier II", SETS)).toBeUndefined();
    expect(setForPosition("Default set", SETS)).toBeUndefined();
    expect(setForPosition("", SETS)).toBeUndefined();
  });
});

describe("the form's state", () => {
  const ok = texts(["30", "25", "15", "15", "15"]);

  it("allows Create set only for a free position and weights that total 100", () => {
    expect(checkWeightForm("Stock Clerk", ok, SETS)).toMatchObject({ position: "Stock Clerk", positionError: null, weightsError: null, total: 100, canCreate: true });
    expect(checkWeightForm("  Stock   Clerk ", ok, SETS).position).toBe("Stock Clerk");
  });

  it("does not allow it when the total is not 100, and says what the total is", () => {
    for (const w of [texts(["30", "25", "15", "15", "14"]), texts(["30", "25", "15", "15", "16"]), BLANK_WEIGHTS]) {
      const state = checkWeightForm("Stock Clerk", w, SETS);
      expect(state.canCreate).toBe(false);
      expect(state.weightsError).toBe(`Weights total ${state.total}, not 100.`);
    }
  });

  it("does not allow it for a position that already has a set, with the message from the Figma", () => {
    const state = checkWeightForm("BRANCH cashier", ok, SETS);

    expect(state).toMatchObject({ canCreate: false, positionError: "A position can have only one weight set." });
    expect(state.positionError).toBe(POSITION_TAKEN_MESSAGE);
  });

  it("is quiet until something is typed, and refuses an empty or odd position", () => {
    expect(checkWeightForm("", ok, SETS)).toMatchObject({ position: null, positionError: null, canCreate: false });
    expect(checkWeightForm("   ", ok, SETS)).toMatchObject({ positionError: null, canCreate: false });
    expect(checkWeightForm("Cashier<script>", ok, SETS)).toMatchObject({ canCreate: false, positionError: kpiMessage("position-characters") });
    expect(checkWeightForm("x".repeat(101), ok, SETS)).toMatchObject({ canCreate: false, positionError: kpiMessage("position-too-long") });
  });

  it("refuses a weight that is not a whole number", () => {
    expect(checkWeightForm("Stock Clerk", texts(["30.5", "25", "15", "15", "15"]), SETS)).toMatchObject({ canCreate: false, weightsError: "Each weight must be a whole number from 0 to 100." });
  });
});
