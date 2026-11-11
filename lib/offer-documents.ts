// Pre-employment Documents: the seven an Offer's checklist tracks, and the rules for requesting them.
// No database or server imports, so the request dialog (a client component) can use it.
import { isValidDate } from "./offer-terms";

export const PRE_EMPLOYMENT_DOCUMENTS = [
  { type: "resume", label: "Resume", hint: "Resume or CV" },
  { type: "valid-id", label: "Valid government ID", hint: "Any government-issued ID" },
  { type: "nbi", label: "NBI clearance", hint: "Not older than 6 months" },
  { type: "health", label: "Health certificate", hint: "From the city health office" },
  { type: "sss", label: "SSS number", hint: "E-1 form or SSS ID" },
  { type: "philhealth", label: "PhilHealth number", hint: "MDR or PhilHealth ID" },
  { type: "pagibig", label: "Pag-IBIG MID and TIN", hint: "For payroll deductions and tax" },
] as const;

export type DocumentType = (typeof PRE_EMPLOYMENT_DOCUMENTS)[number]["type"];
export const DOCUMENT_TYPES: DocumentType[] = PRE_EMPLOYMENT_DOCUMENTS.map((document) => document.type);
export const DOCUMENT_COUNT = DOCUMENT_TYPES.length;
export const documentLabel = (type: DocumentType) => PRE_EMPLOYMENT_DOCUMENTS.find((document) => document.type === type)!.label;

export type DocumentStatus = "Submitted" | "Requested" | "Not requested";

// Order matters: PhilHealth must be tried before the general "health" certificate.
const MATCHERS: [DocumentType, RegExp][] = [
  ["nbi", /\bnbi\b/],
  ["philhealth", /phil\s*-?\s*health/],
  ["pagibig", /pag\s*-?\s*ibig|\bhdmf\b|\bmid\b|\btin\b/],
  ["sss", /\bsss\b|social security/],
  ["resume", /r[eé]sum[eé]|\bcv\b|curriculum/],
  ["health", /health|medical/],
  ["valid-id", /\bid\b|identification|identity|passport|driver'?s? licen[cs]e|umid|national id/],
];

/** Which of the seven an Application Document answers, read from what it was submitted for and its file name. */
export function matchDocumentType(...labels: (string | null | undefined)[]): DocumentType | null {
  for (const label of labels) {
    const text = label?.toLowerCase().trim();
    if (!text) continue;
    const found = MATCHERS.find(([, pattern]) => pattern.test(text));
    if (found) return found[0];
  }
  return null;
}

/** A Requested document is overdue once its due date has passed. Nothing happens automatically; it is only flagged. */
export const isDocumentOverdue = (status: DocumentStatus, dueDate: string | null, today: string) =>
  status === "Requested" && dueDate !== null && dueDate < today;

export type DocumentRequestInput = { types: DocumentType[]; dueDate: string; message?: string };
export const MESSAGE_LIMIT = 500;

/** Why a request cannot be sent, or undefined when it can. The module and the dialog share it. */
export function requestProblem(input: unknown, today: string): string | undefined {
  const { types, dueDate, message } = (input && typeof input === "object" ? input : {}) as Partial<DocumentRequestInput>;
  if (!Array.isArray(types) || types.length === 0 || types.some((type) => !DOCUMENT_TYPES.includes(type)) || new Set(types).size !== types.length) return "Choose at least one document to request.";
  if (!isValidDate(dueDate)) return "Choose the date they should submit by.";
  if (dueDate < today) return "The due date can't be in the past.";
  if (message !== undefined && (typeof message !== "string" || message.trim().length > MESSAGE_LIMIT)) return `Keep the message under ${MESSAGE_LIMIT} characters.`;
  return undefined;
}

/** "5 Nov 2026" from a calendar date. */
const dayOf = (date: string) => new Date(`${date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** A suggested due date: five days before the start date, but never in the past. */
export function defaultDueDate(startDate: string, today: string): string {
  const due = new Date(`${startDate}T00:00:00Z`);
  due.setUTCDate(due.getUTCDate() - 5);
  const iso = due.toISOString().slice(0, 10);
  return iso < today ? today : iso;
}

/** The message the dialog starts with; Staff can change it. */
export const defaultMessage = (applicantName: string, dueDate: string) =>
  `Hi ${applicantName.split(" ")[0]}, please upload these before ${dayOf(dueDate).replace(/ \d{4}$/, "")} so we can prepare your first day. Thank you!`;

/** The email that goes to the Applicant: the documents asked for, the due date and Staff's message. */
export function requestEmail(details: { applicantName: string; role: string; types: DocumentType[]; dueDate: string; message?: string }): { title: string; body: string } {
  const message = details.message?.trim();
  return {
    title: `Documents we need for your ${details.role} job offer`,
    body: [
      `Dear ${details.applicantName},`,
      `To prepare for your start as ${details.role}, please submit the following by ${dayOf(details.dueDate)} on your application page on the Careers site:`,
      details.types.map((type) => `- ${documentLabel(type)}`).join("\n"),
      ...(message ? [message] : []),
      "Thank you.",
    ].join("\n\n"),
  };
}

/** The activity line, e.g. "Valid government ID, NBI clearance · due 5 Nov 2026". */
export const requestSummary = (types: DocumentType[], dueDate: string) => `${types.map(documentLabel).join(", ")} · due ${dayOf(dueDate)}`;
