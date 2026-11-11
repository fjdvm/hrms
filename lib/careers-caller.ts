import { createHash, timingSafeEqual } from "node:crypto";
import { OfferError } from "./offers";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** True when the request carries the Careers caller key (`CAREERS_CALLER_KEY`) as a bearer token. Never true when the key is unset. */
export function isCareersCaller(request: Request): boolean {
  const key = process.env.CAREERS_CALLER_KEY;
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1];
  return Boolean(key && given && timingSafeEqual(digest(given), digest(key)));
}

const MESSAGES: Record<string, string> = {
  withdrawn: "This application was withdrawn, so the offer allows no further action.",
  draft: "This offer has not been sent yet.",
  "already-answered": "This offer has already been answered. A reply is final.",
  declined: "This offer was declined, so documents can no longer be submitted.",
};

/** One JSON error for every refusal, so Careers can show a clear message. */
export function careersError(error: unknown): Response {
  const headers = { "Cache-Control": "private, no-store" };
  if (!(error instanceof OfferError)) {
    console.error("Careers offer call failed");
    return Response.json({ error: "unavailable", message: "Something went wrong. Try again." }, { status: 503, headers });
  }
  const status = { denied: 403, invalid: 401, unavailable: 503, validation: 400, "not-found": 404, conflict: 409 }[error.reason];
  const message = error.reason === "validation" ? "The request is not valid."
    : error.reason === "not-found" ? "No such offer for this applicant."
    : error.reason === "conflict" ? MESSAGES[error.detail ?? "already-answered"]
    : "Something went wrong. Try again.";
  return Response.json({ error: error.detail ?? error.reason, message }, { status, headers });
}

export const unauthorized = () => Response.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "private, no-store" } });

/** The JSON body as an object, or null when it is not one. */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
