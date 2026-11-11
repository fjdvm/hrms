"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { OfferError } from "@/lib/offers";
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
