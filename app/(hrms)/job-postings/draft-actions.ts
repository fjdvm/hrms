"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { jobDrafterFor, type JobDraftResult } from "@/lib/job-drafter";
import { JobPostingError } from "@/lib/job-postings";
import type { DraftRequest } from "@/lib/job-draft";
import { LOGIN_PATH, NO_ACCESS_PATH, SESSION_COOKIE } from "@/lib/portal/config";

const UNAVAILABLE = "HRMS could not reach the Portal or database. Please try again in a moment.";

/** Runs a drafter operation, sending Staff without the Job Postings Module to No access and a lapsed session to sign-in. */
async function run<T>(operation: (drafter: ReturnType<typeof jobDrafterFor>) => Promise<T>): Promise<T | { unavailable: string }> {
  try {
    return await operation(jobDrafterFor((await cookies()).get(SESSION_COOKIE)?.value));
  } catch (error) {
    if (!(error instanceof JobPostingError)) throw error;
    if (error.reason === "denied") redirect(NO_ACCESS_PATH);
    if (error.reason === "invalid") redirect(LOGIN_PATH);
    return { unavailable: UNAVAILABLE };
  }
}

/** Drafts the four description fields from a title and notes. It saves and publishes nothing. */
export async function draftJobDescription(request: DraftRequest): Promise<JobDraftResult | { unavailable: string }> {
  return run((drafter) => drafter.draft(request));
}

/** Drafts left today, read when the Draft with AI dialog opens. */
export async function jobDraftStatus() {
  return run((drafter) => drafter.status());
}
