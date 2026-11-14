"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { TrainingError } from "@/lib/trainings";
import { TERM_FIELDS, materialProblem, readTrainingForm, type MaterialRequest, type TrainingFormErrors, type TrainingMaterial } from "@/lib/training-terms";

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
    await (await trainingsForRequest()).create(terms, data.getAll("material").filter((id): id is string => typeof id === "string"));
  } catch (error) {
    if (!(error instanceof TrainingError)) throw error;
    if (error.reason === "denied") redirect(NO_ACCESS_PATH);
    if (error.reason === "invalid") redirect(LOGIN_PATH);
    return { error: MESSAGES[error.reason], values, attempt };
  }
  revalidatePath("/training");
  redirect("/training");
}

function problem(error: unknown): string {
  if (!(error instanceof TrainingError)) throw error;
  if (error.reason === "denied") redirect(NO_ACCESS_PATH);
  if (error.reason === "invalid") redirect(LOGIN_PATH);
  return error.reason === "validation" ? "That file can't be attached." : MESSAGES[error.reason];
}

/** Step 1 of an upload: file-storage's signed address. The browser then PUTs the bytes straight to it (ADR-0003). */
export async function requestMaterialUpload(file: MaterialRequest, trainingId?: number): Promise<{ error?: string; fileId?: string; uploadUrl?: string }> {
  const invalid = materialProblem(file);
  if (invalid) return { error: invalid };
  try {
    return await (await trainingsForRequest()).requestMaterial({ filename: file.filename, contentType: file.contentType, size: file.size }, trainingId);
  } catch (error) {
    return { error: problem(error) };
  }
}

/** Step 2: the bytes arrived, so the material becomes Active. */
export async function confirmMaterialUpload(fileId: string, trainingId?: number): Promise<{ error?: string; material?: TrainingMaterial }> {
  try {
    const material = await (await trainingsForRequest()).confirmMaterial(fileId);
    if (trainingId !== undefined) revalidatePath(`/training/${trainingId}`);
    revalidatePath("/training");
    return { material };
  } catch (error) {
    return { error: problem(error) };
  }
}

/** Deletes a material for good; the caller has already shown the confirm dialog. */
export async function deleteTrainingMaterial(fileId: string, trainingId?: number): Promise<{ error?: string }> {
  try {
    await (await trainingsForRequest()).deleteMaterial(fileId);
  } catch (error) {
    return { error: problem(error) };
  }
  if (trainingId !== undefined) revalidatePath(`/training/${trainingId}`);
  revalidatePath("/training");
  return {};
}
