"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { AccountRequestError } from "@/lib/account-requests";
import { EmployeeError, type AccountRequestStatus } from "@/lib/employees";
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
  "too-soon": "A reminder was already sent in the last 24 hours.",
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

export type StatusResult = { ok: true; status: AccountRequestStatus } | { ok: false; error: string };

/** The status panel's data, read when the panel opens and again on a live update or the user's refresh. */
export async function loadAccountRequestStatus(employeeId: number, reference?: string): Promise<StatusResult> {
  try {
    return { ok: true, status: await (await employeesForRequest()).accountRequestStatus(employeeId, reference) };
  } catch (error) {
    if (error instanceof EmployeeError) {
      if (error.reason === "denied") redirect(NO_ACCESS_PATH);
      if (error.reason === "invalid") redirect(LOGIN_PATH);
      return { ok: false, error: error.reason === "not-found" ? reference ? "That declined request could not be found." : "This person has no active account request." : "The request could not be loaded. Please try again in a moment." };
    }
    throw error;
  }
}

export type NoAccountResult = { ok: true } | { ok: false; error: string };

const NO_ACCOUNT_MESSAGES: Record<AccountRequestError["reason"], string> = {
  ...MESSAGES,
  conflict: "This person's account state has changed, or they are already Active. The list has been refreshed.",
  "not-found": "That Employee record no longer exists.",
};

async function changeNoAccountNeeded(employeeId: number, change: "set" | "undo"): Promise<NoAccountResult> {
  try {
    const employees = await employeesForRequest();
    if (change === "set") await employees.setNoAccountNeeded(employeeId);
    else await employees.undoNoAccountNeeded(employeeId);
    revalidatePath("/employee-onboarding");
    return { ok: true };
  } catch (error) {
    const { reason } = refusal(error);
    // The person's state moved on (Active, or a request was sent): show the current list rather than a stale row.
    if (reason === "conflict" || reason === "not-found") revalidatePath("/employee-onboarding");
    return { ok: false, error: NO_ACCOUNT_MESSAGES[reason] };
  }
}

/** Marks an Onboarding person "No account needed" (Super Admin and HRMS Manager only, enforced by the employees module). */
export async function markNoAccountNeeded(employeeId: number): Promise<NoAccountResult> {
  return changeNoAccountNeeded(employeeId, "set");
}
/** Undoes "No account needed" until the person is Active. */
export async function undoNoAccountNeeded(employeeId: number): Promise<NoAccountResult> {
  return changeNoAccountNeeded(employeeId, "undo");
}
