"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { deliverOfferEmails } from "@/lib/offer-emails";
import { revalidatePath } from "next/cache";
import { OfferError } from "@/lib/offers";
import { manilaToInstant } from "@/lib/offer-reply";
import { requestProblem, type DocumentType } from "@/lib/offer-documents";
import { TERM_FIELDS, readOfferForm, type OfferFormErrors } from "@/lib/offer-view";
import { LOGIN_PATH, NO_ACCESS_PATH } from "@/lib/portal/config";
import { offersForRequest } from "@/lib/portal/offers";

export type SaveOfferState = { error?: string; fieldErrors?: OfferFormErrors; values?: Record<string, string>; attempt?: number };

const MESSAGES: Record<OfferError["reason"], string> = {
  validation: "Check the offer's terms and try again.",
  "not-found": "That Application or Offer no longer exists.",
  conflict: "This Offer can no longer be changed. It may have been sent, deleted or withdrawn, or the Application may already have an Offer.",
  unavailable: "HRMS could not reach the Portal or database. Please try again in a moment.",
  invalid: "",
  denied: "",
};

function fail(error: unknown): string {
  if (!(error instanceof OfferError)) throw error;
  if (error.reason === "denied") redirect(NO_ACCESS_PATH);
  if (error.reason === "invalid") redirect(LOGIN_PATH);
  return MESSAGES[error.reason];
}

/** Saves a Draft: a new one for `applicationId`, or an edit of `offerId`. */
export async function saveOffer(previous: SaveOfferState, data: FormData): Promise<SaveOfferState> {
  const values = Object.fromEntries(TERM_FIELDS.map((name) => [name, (data.get(name) as string | null) ?? ""])) as Record<(typeof TERM_FIELDS)[number], string>;
  const attempt = (previous.attempt ?? 0) + 1;
  const { terms, errors } = readOfferForm(values);
  if (!terms) return { fieldErrors: errors, values, attempt };
  const offerId = Number(data.get("offerId"));
  const applicationId = Number(data.get("applicationId"));
  try {
    const offers = await offersForRequest();
    if (data.get("offerId")) await offers.update(offerId, terms);
    else await offers.create(applicationId, terms);
  } catch (error) {
    return { error: fail(error), values, attempt };
  }
  revalidatePath("/offers");
  redirect("/offers");
}

/** Deletes a Draft; its Application returns to the New offer picker. */
export async function deleteOffer(offerId: number): Promise<{ error?: string }> {
  try {
    await (await offersForRequest()).delete(offerId);
  } catch (error) {
    return { error: fail(error) };
  }
  revalidatePath("/offers");
  redirect("/offers");
}

/** Sends a Draft with a reply-by date. The Applicant's email goes out through the outbox straight away. */
export async function sendOffer(offerId: number, replyBy: string): Promise<{ error?: string }> {
  try {
    await (await offersForRequest()).send(offerId, replyBy);
  } catch (error) {
    if (error instanceof OfferError && error.reason === "validation") return { error: "Choose a reply-by date that is today or later." };
    return { error: fail(error) };
  }
  after(() => deliverOfferEmails());
  revalidatePath("/offers");
  redirect(`/offers/${offerId}`);
}

/** Records the Applicant's reply. `repliedAt` and `sendAt` are Manila wall-clock times ("YYYY-MM-DDTHH:mm"); no `sendAt` means the email goes out now. */
export async function recordReply(offerId: number, answer: string, repliedAt: string, sendAt: string | null): Promise<{ error?: string }> {
  const replied = manilaToInstant(repliedAt);
  const send = sendAt === null ? null : manilaToInstant(sendAt);
  if (!replied || (sendAt !== null && !send) || (answer !== "Accepted" && answer !== "Declined")) return { error: "Check the answer and the times and try again." };
  try {
    await (await offersForRequest()).recordReply(offerId, { answer, repliedAt: replied, sendAt: send });
  } catch (error) {
    if (error instanceof OfferError && error.reason === "validation") return { error: "The reply can't have come in before the offer was sent or in the future, and the email can't be sent in the past." };
    if (error instanceof OfferError && error.reason === "conflict") return { error: "This offer has already been answered or can no longer be answered. Replies are final." };
    return { error: fail(error) };
  }
  after(() => deliverOfferEmails());
  revalidatePath("/offers");
  revalidatePath(`/offers/${offerId}`);
  return {};
}

/** Gives a Sent offer more time to reply. */
export async function extendReplyBy(offerId: number, replyBy: string): Promise<{ error?: string }> {
  try {
    await (await offersForRequest()).extendReplyBy(offerId, replyBy);
  } catch (error) {
    if (error instanceof OfferError && error.reason === "validation") return { error: "Choose a date later than the current reply-by date." };
    return { error: fail(error) };
  }
  revalidatePath("/offers");
  revalidatePath(`/offers/${offerId}`);
  return {};
}

/** Asks the Applicant for documents. The email goes out at once through the outbox. */
export async function requestOfferDocuments(offerId: number, types: DocumentType[], dueDate: string, message: string): Promise<{ error?: string }> {
  const problem = requestProblem({ types, dueDate, message }, new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }));
  if (problem) return { error: problem };
  try {
    await (await offersForRequest()).requestDocuments(offerId, { types, dueDate, message });
  } catch (error) {
    if (error instanceof OfferError && error.reason === "conflict") return { error: "Documents can only be requested on a sent or accepted offer whose Application has not withdrawn." };
    return { error: fail(error) };
  }
  after(() => deliverOfferEmails());
  revalidatePath(`/offers/${offerId}`);
  return {};
}
