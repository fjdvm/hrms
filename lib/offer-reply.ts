// Replies to an Offer: what Staff record and the email it sends. No database or server imports,
// so the response dialog (a client component) previews exactly what the module queues.

export const OFFER_ANSWERS = ["Accepted", "Declined"] as const;
export type OfferAnswer = (typeof OFFER_ANSWERS)[number];

/** A reply Staff record. `repliedAt` is when it came in; `sendAt` is when the email goes out, or null for right away. Both are instants (ISO). */
export type OfferReply = { answer: OfferAnswer; repliedAt: string; sendAt: string | null };

export type ReplyEmailFacts = { applicantName: string; role: string; startDate: string };

const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
const startLabel = (startDate: string) =>
  new Date(`${startDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The email an Applicant gets for a reply: a confirmation if accepted, a thank-you if declined. */
export function replyEmail(answer: OfferAnswer, facts: ReplyEmailFacts): { title: string; body: string } {
  const name = firstName(facts.applicantName);
  if (answer === "Accepted") {
    return {
      title: `Thank you for accepting our offer, ${name}`,
      body: `Dear ${facts.applicantName},\n\nThank you for accepting our offer for ${facts.role}. We'll send you a list of documents to submit before your first day on ${startLabel(facts.startDate)}.\n\nBren Raphael's`,
    };
  }
  return {
    title: "Thank you for considering Bren Raphael's",
    body: `Dear ${facts.applicantName},\n\nThank you for letting us know about your decision on the ${facts.role} offer. We appreciate the time you spent with us and wish you the very best.\n\nBren Raphael's`,
  };
}

/** The welcome email sent when Staff mark the Applicant Hired. It differs from the acceptance confirmation. */
export function hiredEmail(facts: ReplyEmailFacts): { title: string; body: string } {
  return {
    title: `Welcome to Bren Raphael's, ${firstName(facts.applicantName)}!`,
    body: `Dear ${facts.applicantName},\n\nWelcome aboard! We're delighted to have you join us as ${facts.role}. Your first day is ${startLabel(facts.startDate)}, and we'll be in touch with what to expect.\n\nBren Raphael's`,
  };
}

/** "2026-11-12T18:00" (Manila wall clock, as a datetime-local input writes it) to an instant. Null when it is not a real time. */
export function manilaToInstant(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const date = new Date(`${local}:00+08:00`);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

/** The current Manila wall clock as a datetime-local value. */
export const manilaNowLocal = (now = new Date()) =>
  now.toLocaleString("sv-SE", { timeZone: "Asia/Manila" }).slice(0, 16).replace(" ", "T");
