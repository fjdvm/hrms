"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AccountRequestError } from "@/lib/account-requests";
import { EmployeeError } from "@/lib/employees";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import type { AccountRequestOptions } from "@/lib/portal/account-requests";
import { employeesForRequest } from "@/lib/portal/employees";

export type FieldProblems = AccountRequestError["problems"];
export type OptionsResult = { ok: true; options: AccountRequestOptions } | { ok: false; error: string };
export type SendResult = { ok: true; reference: string } | { ok: false; error: string; problems: FieldProblems };

const MESSAGES: Record<AccountRequestError["reason"], string> = {
  validation: "Check the highlighted fields and try again.",
  "email-taken": "That work email is already in use.",
  conflict: "This person already has an active account request, or is no longer onboarding.",
  "not-found": "That Employee record no longer exists.",
  unavailable: "HRMS could not reach the Portal. Nothing was sent. Please try again in a moment.",
  denied: "", invalid: "",
};

/** Sends a refused session to sign-in or the no-access page; anything else becomes a message for the dialog. */
function refusal(error: unknown): { reason: AccountRequestError["reason"]; problems: FieldProblems } {
  if (error instanceof AccountRequestError || error instanceof EmployeeError) {
    if (error.reason === "denied") redirect(NO_ACCESS_PATH);
    if (error.reason === "invalid") redirect(LOGIN_PATH);
    return { reason: error.reason as AccountRequestError["reason"], problems: error instanceof AccountRequestError ? error.problems : {} };
  }
  throw error;
}

/** The Portal's Roles and Modules, fetched when the dialog opens. */
export async function loadAccountRequestOptions(): Promise<OptionsResult> {
  try {
    return { ok: true, options: await (await employeesForRequest()).accountRequestOptions() };
  } catch (error) {
    return { ok: false, error: MESSAGES[refusal(error).reason] };
  }
}

export async function sendAccountRequest(employeeId: number, input: { workEmail: string; roleId: string | number; moduleIds: (string | number)[]; neededFrom?: string; note?: string }): Promise<SendResult> {
  try {
    const result = await (await employeesForRequest()).requestAccount(employeeId, input);
    revalidatePath("/employee-onboarding");
    return { ok: true, reference: result.reference };
  } catch (error) {
    const { reason, problems } = refusal(error);
    return { ok: false, error: MESSAGES[reason], problems };
  }
}
