"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ApplicationError } from "@/lib/applications";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { applicationsForRequest } from "@/lib/portal/applications";
import { readApplicantForm, type ApplicantFormErrors } from "@/lib/application-view";

export type AddApplicantState = { error?: string; fieldErrors?: ApplicantFormErrors; added?: number; attempt?: number; values?: Record<string, string> };

const FIELDS = ["fullName", "email", "mobile", "address", "jobPostingId", "expectedSalary", "availableFrom", "source", "referredBy"] as const;

const MESSAGES: Record<ApplicationError["reason"], string> = {
  validation: "Check the applicant's details and try again.",
  "not-found": "That Job Posting no longer exists.",
  conflict: "This email already has an Application for that Job Posting, or the posting is no longer Open.",
  unavailable: "HRMS could not reach the Portal or database. Please try again in a moment.",
  invalid: "",
  denied: "",
};

/** Adds a walk-in or referral to an Open Job Posting; the new Application starts at New. */
export async function addApplicant(previous: AddApplicantState, data: FormData): Promise<AddApplicantState> {
  // Sent back so the form keeps what was typed when React resets it after the action.
  const values = Object.fromEntries(FIELDS.map((name) => [name, (data.get(name) as string | null) ?? ""])) as Record<(typeof FIELDS)[number], string>;
  const attempt = (previous.attempt ?? 0) + 1;
  const { input, errors } = readApplicantForm(values);
  if (!input) return { fieldErrors: errors, values, attempt };
  try {
    await (await applicationsForRequest()).addApplicant(input);
  } catch (error) {
    if (!(error instanceof ApplicationError)) throw error;
    if (error.reason === "denied") redirect(NO_ACCESS_PATH);
    if (error.reason === "invalid") redirect(LOGIN_PATH);
    // A duplicate belongs beside the email field.
    if (error.reason === "conflict") return { fieldErrors: { email: "This email already applied for that Job Posting." }, values, attempt };
    return { error: MESSAGES[error.reason], values, attempt };
  }
  revalidatePath("/applicants");
  return { added: (previous.added ?? 0) + 1, attempt };
}
