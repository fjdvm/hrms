"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { TrainingError } from "@/lib/trainings";
import { TERM_FIELDS, readTrainingForm, type TrainingFormErrors } from "@/lib/training-terms";

export type SaveTrainingState = { error?: string; fieldErrors?: TrainingFormErrors; values?: Record<string, string>; attempt?: number };

const MESSAGES: Record<TrainingError["reason"], string> = {
  validation: "Check the training's details and try again.",
  "not-found": "That training no longer exists.",
  unavailable: "HRMS could not reach the Portal or database. Please try again in a moment.",
  invalid: "",
  denied: "",
};

/** Saves a new Training. Invalid input comes back as messages beside the fields; nothing is stripped silently. */
export async function saveTraining(previous: SaveTrainingState, data: FormData): Promise<SaveTrainingState> {
  const values = Object.fromEntries(TERM_FIELDS.map((name) => [name, (data.get(name) as string | null) ?? ""]));
  const attempt = (previous.attempt ?? 0) + 1;
  const { terms, errors } = readTrainingForm(values);
  if (!terms) return { fieldErrors: errors, values, attempt };
  try {
    await (await trainingsForRequest()).create(terms);
  } catch (error) {
    if (!(error instanceof TrainingError)) throw error;
    if (error.reason === "denied") redirect(NO_ACCESS_PATH);
    if (error.reason === "invalid") redirect(LOGIN_PATH);
    return { error: MESSAGES[error.reason], values, attempt };
  }
  revalidatePath("/training");
  redirect("/training");
}
