import { EMPLOYMENT_TYPES, OFFER_TABS, PROBATION_PERIODS, termsProblems, type OfferDisplayStatus, type OfferTab, type OfferTerms } from "./offers";

export const OFFER_BADGE = {
  Draft: "secondary",
  Sent: "success",
  Accepted: "success",
  Declined: "destructive",
  Withdrawn: "secondary",
} as const satisfies Record<OfferDisplayStatus, "secondary" | "success" | "destructive">;

/** "₱19,000" */
export const formatPeso = (amount: number) => `₱${amount.toLocaleString("en-US")}`;

/** "3 Nov 2026" from a calendar date ("2026-11-03") or an instant, in Manila time. */
export function formatOfferDate(value: string | Date) {
  const date = typeof value === "string" ? new Date(`${value}T00:00:00Z`) : value;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: typeof value === "string" ? "UTC" : "Asia/Manila" });
}

/** "3 waiting for a reply", or "Nothing waiting for a reply". */
export const formatWaiting = (waiting: number) => (waiting === 0 ? "Nothing waiting for a reply" : `${waiting} waiting for a reply`);

export const offerTabFromParam = (value: string | undefined): OfferTab => OFFER_TABS.find((tab) => tab === value) ?? "All";
export const offersHref = (tab: OfferTab) => (tab === "All" ? "/offers" : `/offers?tab=${tab}`);

export const TERM_FIELDS = ["monthlySalary", "startDate", "employmentType", "schedule", "probation", "reportsTo"] as const;
export type OfferFormErrors = Partial<Record<(typeof TERM_FIELDS)[number], string>>;

/** Reads the Draft form. The salary is typed as text so a bad entry shows an error instead of vanishing. */
export function readOfferForm(values: Record<(typeof TERM_FIELDS)[number], string>): { terms?: OfferTerms; errors: OfferFormErrors } {
  const salary = values.monthlySalary.replaceAll(",", "").trim();
  const candidate = {
    monthlySalary: /^\d+$/.test(salary) ? Number(salary) : Number.NaN,
    startDate: values.startDate.trim(),
    employmentType: values.employmentType,
    schedule: values.schedule,
    probation: values.probation,
    reportsTo: values.reportsTo,
  };
  const errors = termsProblems(candidate);
  return Object.keys(errors).length > 0 ? { errors } : { terms: candidate as OfferTerms, errors };
}

export { EMPLOYMENT_TYPES, PROBATION_PERIODS };
