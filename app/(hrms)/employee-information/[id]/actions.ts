"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { EmployeeError, type EmployeeSection, type GovernmentIds, type ShiftProblem } from "@/lib/employees";
import { SHIFT_ORDER_MESSAGE } from "@/lib/employee-edit-form";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { employeesForRequest } from "@/lib/portal/employees";

export type EditResult<T = undefined> = { ok: true; values?: T } | { ok: false; error: string };

const MESSAGES: Record<EmployeeError["reason"], string> = {
  validation: "Check the highlighted fields and try again.",
  "not-found": "That Employee record no longer exists.",
  unavailable: "HRMS could not reach the Portal or database. Please try again in a moment.",
  denied: "", invalid: "",
};

const SHIFT_MESSAGES: Record<ShiftProblem, string> = {
  "shift-incomplete": "Set the Shift start, Shift end and Working days together, or clear all three.",
  "shift-order": SHIFT_ORDER_MESSAGE,
  "shift-days": "Choose at least one Working day.",
};

function fail(error: unknown): string {
  if (!(error instanceof EmployeeError)) throw error;
  if (error.detail) return SHIFT_MESSAGES[error.detail];
  if (error.reason === "denied") redirect(NO_ACCESS_PATH);
  if (error.reason === "invalid") redirect(LOGIN_PATH);
  return MESSAGES[error.reason];
}

export async function saveSection(id: number, section: EmployeeSection | "governmentIds", input: Record<string, unknown>, effectiveDate?: string): Promise<EditResult> {
  try {
    const employees = await employeesForRequest();
    if (section === "governmentIds") await employees.replaceGovernmentIds(id, input as Partial<GovernmentIds>);
    else await employees.editSection(id, section, input, effectiveDate || undefined);
  } catch (error) {
    return { ok: false, error: fail(error) };
  }
  revalidatePath(`/employee-information/${id}`);
  return { ok: true };
}

/** Asked for on click; the server audits every disclosure. */
export async function revealGovernmentIds(id: number, fields?: (keyof GovernmentIds)[]): Promise<EditResult<Partial<GovernmentIds>>> {
  try {
    return { ok: true, values: await (await employeesForRequest()).revealGovernmentIds(id, fields) };
  } catch (error) {
    return { ok: false, error: fail(error) };
  }
}
