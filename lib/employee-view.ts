import type { EmployeeDetail } from "./employees";
import { formatOfferDate } from "./offer-view";

export const NOT_PROVIDED = "Not provided yet";

/** Dates arrive as "2026-10-12" or as a database timestamp ("2026-10-12 08:00:00+00"); both read as "12 Oct 2026". */
export function formatEmployeeDate(value: string | null | undefined) {
  if (!value) return NOT_PROVIDED;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatOfferDate(value);
  const date = new Date(value.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00"));
  return Number.isNaN(date.getTime()) ? NOT_PROVIDED : formatOfferDate(date);
}

export const orNotProvided = (value: string | null | undefined) => value?.trim() ? value : NOT_PROVIDED;

export function formatBirthday(birthday: string | null, age: number | null) {
  if (!birthday) return NOT_PROVIDED;
  return age === null ? formatEmployeeDate(birthday) : `${formatEmployeeDate(birthday)} · ${age} years old`;
}

export function formatMonthlyPay(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

export type EmployeeDocument = EmployeeDetail["documents"][number];
export const isSubmitted = (document: EmployeeDocument) => document.status === "Submitted";
export const submittedCount = (documents: EmployeeDocument[]) => documents.filter(isSubmitted).length;

export const validUntilLabel = (date: string) => `Valid until ${formatEmployeeDate(date)}`;

/** "Valid until 28 Apr 2027", else the upload date, else a gap. */
export function documentSummary(document: EmployeeDocument) {
  if (!isSubmitted(document)) return NOT_PROVIDED;
  if (document.validUntil) return validUntilLabel(document.validUntil);
  return document.uploadedAt ? formatEmployeeDate(document.uploadedAt) : "Submitted";
}

export const ONBOARDING_ROW_URL = (employeeId: number) => `/employee-onboarding#employee-${employeeId}`;

export function headerSubtitle(employee: EmployeeDetail) {
  const { position, branch, startDate, status } = employee.employment;
  return `${employee.employeeNumber} · ${position} · ${branch} · ${status === "Onboarding" ? "starts" : "started"} ${formatEmployeeDate(startDate)}`;
}

const FIELD_LABELS: Record<string, string> = {
  name: "Full name", email: "Email", birthday: "Birthday", sex: "Sex", civilStatus: "Civil status", mobile: "Mobile", homeAddress: "Home address",
  position: "Position", department: "Department", branch: "Branch", employmentType: "Employment type", startDate: "Start date",
  probationEndDate: "Probation ends", reportsTo: "Reports to", schedule: "Work schedule", relationship: "Relationship",
  sss: "SSS number", philhealth: "PhilHealth number", pagibigMid: "Pag-IBIG MID", tin: "TIN", monthlyPay: "Monthly pay", status: "Status",
  terms: "Terms",
};
export const fieldLabel = (field: string) => FIELD_LABELS[field] ?? field;

/** One audit or history value as text: a gap, a peso amount, a date, "[redacted]" as-is, or the value itself. */
export function formatChangeValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "monthlyPay" && typeof value === "number") return formatMonthlyPay(value);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return formatEmployeeDate(value);
  return String(value);
}

const HIRED_TERMS: [string, string][] = [["position", "Position"], ["department", "Department"], ["branch", "Branch"], ["employmentType", "Employment type"],
  ["reportsTo", "Reports to"], ["schedule", "Schedule"], ["probation", "Probation"], ["monthlyPay", "Monthly pay"]];

/** The Offer's terms behind a "Hired" entry; pay is already absent for roles that cannot see it. */
export function hiredTerms(value: unknown): string[] {
  const terms = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return HIRED_TERMS.filter(([key]) => terms[key] != null && terms[key] !== "").map(([key, label]) => `${label}: ${formatChangeValue(key, terms[key])}`);
}

/** "Position changed from Cashier to Supervisor" style sentence for the Activity tab. */
export function describeActivity(entry: { kind: string; field: string; oldValue: unknown; newValue: unknown }): string {
  const label = fieldLabel(entry.field);
  if (entry.kind === "reveal") return `Viewed ${label}`;
  if (entry.kind === "status") return `Status changed from ${formatChangeValue("status", entry.oldValue)} to ${formatChangeValue("status", entry.newValue)}`;
  return `${label} changed from ${formatChangeValue(entry.field, entry.oldValue)} to ${formatChangeValue(entry.field, entry.newValue)}`;
}
