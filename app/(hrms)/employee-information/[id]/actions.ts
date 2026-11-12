"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { EmployeeError, type EmployeeSection, type GovernmentIds } from "@/lib/employees";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { employeesForRequest } from "@/lib/portal/employees";

export type EditResult<T = undefined> = { ok: true; values?: T } | { ok: false; error: string };

const MESSAGES: Record<EmployeeError["reason"], string> = {
  validation: "Check the highlighted fields and try again.",
  "not-found": "That Employee record no longer exists.",
  unavailable: "HRMS could not reach the Portal or database. Please try again in a moment.",
  denied: "", invalid: "",
};

function fail(error: unknown): string {
  if (!(error instanceof EmployeeError)) throw error;
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
