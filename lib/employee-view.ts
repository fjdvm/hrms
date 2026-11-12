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

/** "Valid until 28 Apr 2027", else the upload date, else a gap. */
export function documentSummary(document: EmployeeDocument) {
  if (!isSubmitted(document)) return NOT_PROVIDED;
  if (document.validUntil) return `Valid until ${formatEmployeeDate(document.validUntil)}`;
  return document.uploadedAt ? formatEmployeeDate(document.uploadedAt) : "Submitted";
}

export const ONBOARDING_ROW_URL = (employeeId: number) => `/employee-onboarding#employee-${employeeId}`;

export function headerSubtitle(employee: EmployeeDetail) {
  const { position, branch, startDate, status } = employee.employment;
  return `${employee.employeeNumber} · ${position} · ${branch} · ${status === "Onboarding" ? "starts" : "started"} ${formatEmployeeDate(startDate)}`;
}
