"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { deliverTrainingNotices } from "@/lib/training-notices";
import { redirect } from "next/navigation";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { trainingsForRequest } from "@/lib/portal/trainings";
import { TrainingError } from "@/lib/trainings";
import { TERM_FIELDS, materialProblem, readCancelReason, readTrainingForm, type AssignableEmployee, type AssignRequest, type AssignResult, type CancelResult, type MaterialRequest, type TrainingFormErrors, type TrainingMaterial } from "@/lib/training-terms";

export type SaveTrainingState = { error?: string; fieldErrors?: TrainingFormErrors; values?: Record<string, string>; attempt?: number };

const MESSAGES: Record<TrainingError["reason"], string> = {
  validation: "Check the training's details and try again.",
  "not-found": "That training no longer exists.",
  conflict: "This training was cancelled, so no one can be assigned to it.",
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

export type AssignState = { error?: string; result?: AssignResult };

/** Everyone the Assign dialog may offer, loaded when the dialog opens. */
export async function loadAssignable(trainingId: number): Promise<{ error?: string; people?: AssignableEmployee[] }> {
  try {
    return { people: await (await trainingsForRequest()).assignable(trainingId) };
  } catch (error) {
    return { error: problem(error) };
  }
}

/** Assigns the chosen Employees, or a whole department's. */
export async function assignEmployees(trainingId: number, request: AssignRequest): Promise<AssignState> {
  try {
    const result = await (await trainingsForRequest()).assign(trainingId, request);
    // The Assignment emails go out straight away; anything that fails is retried by the scheduled job.
    after(() => deliverTrainingNotices());
    revalidatePath(`/training/${trainingId}`);
    revalidatePath(`/training/${trainingId}/log`);
    revalidatePath("/training");
    return { result };
  } catch (error) {
    return { error: problem(error) };
  }
}

/** Removes an Employee; the caller has already shown the confirm dialog. */
export async function removeAssignedEmployee(trainingId: number, employeeId: number): Promise<{ error?: string }> {
  try {
    await (await trainingsForRequest()).unassign(trainingId, employeeId);
  } catch (error) {
    return { error: problem(error) };
  }
  revalidatePath(`/training/${trainingId}`);
  revalidatePath("/training");
  return {};
}

/** Retry on a Not reached Employee: queues the notice again, with its full set of retries. */
export async function retryTrainingNotice(trainingId: number, noticeId: number): Promise<{ error?: string }> {
  try {
    await (await trainingsForRequest()).retryNotice(trainingId, noticeId);
  } catch (error) {
    if (error instanceof TrainingError && error.reason === "conflict") return { error: "That notice is already on its way." };
    return { error: problem(error) };
  }
  after(() => deliverTrainingNotices());
  revalidatePath(`/training/${trainingId}`);
  revalidatePath(`/training/${trainingId}/log`);
  return {};
}

export type CancelState = { error?: string; reasonError?: string; result?: CancelResult };

/** Cancels the Training with its reason; the caller has already shown the confirm dialog. Invalid input comes back beside the field. */
export async function cancelTraining(trainingId: number, reason: string, notify: boolean): Promise<CancelState> {
  const checked = readCancelReason(reason);
  if (checked.reason === null) return { reasonError: checked.error };
  try {
    const result = await (await trainingsForRequest()).cancel(trainingId, { reason: checked.reason, notify: Boolean(notify) });
    // The Cancelled emails go out straight away; anything that fails is retried by the scheduled job.
    after(() => deliverTrainingNotices());
    revalidatePath(`/training/${trainingId}`);
    revalidatePath(`/training/${trainingId}/log`);
    revalidatePath("/training");
    revalidatePath("/training/calendar");
    return { result };
  } catch (error) {
    if (error instanceof TrainingError && error.reason === "conflict") return { error: "This training was already cancelled or has results recorded, so it can't be cancelled." };
    if (error instanceof TrainingError && error.reason === "validation") return { reasonError: "Check the reason and try again." };
    return { error: problem(error) };
  }
}
