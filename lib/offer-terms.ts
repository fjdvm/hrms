// Offer terms and their rules. No database or server imports, so the Draft form (a client component) can use it.

export const OFFER_STATUSES = ["Draft", "Sent", "Accepted", "Declined"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];
/** What the list shows: an Offer on a Withdrawn Application reads as Withdrawn, whatever it was. */
export type OfferDisplayStatus = OfferStatus | "Withdrawn";
export type OfferTab = "All" | OfferDisplayStatus;
export const OFFER_TABS: OfferTab[] = ["All", "Draft", "Sent", "Accepted", "Declined", "Withdrawn"];

export const EMPLOYMENT_TYPES = ["Full-time", "Part-time", "Contractual"] as const;
export const PROBATION_PERIODS = ["None", "3 months", "6 months"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export type ProbationPeriod = (typeof PROBATION_PERIODS)[number];

/** The terms Staff fill in. Dates are calendar dates, "YYYY-MM-DD". */
export type OfferTerms = {
  monthlySalary: number;
  startDate: string;
  employmentType: EmploymentType;
  schedule: string;
  probation: ProbationPeriod;
  reportsTo: string;
};

const manilaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });

/** Whether the terms may be saved; the Draft form and the module both use it. */
export function termsProblems(terms: unknown, today = manilaToday()): Partial<Record<keyof OfferTerms, string>> {
  const input = (terms && typeof terms === "object" ? terms : {}) as Record<string, unknown>;
  const problems: Partial<Record<keyof OfferTerms, string>> = {};
  const { monthlySalary, startDate, employmentType, schedule, probation, reportsTo } = input;
  if (!Number.isSafeInteger(monthlySalary) || (monthlySalary as number) <= 0 || (monthlySalary as number) > 2_147_483_647) problems.monthlySalary = "Enter the monthly salary in whole pesos.";
  if (typeof startDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !new Date(`${startDate}T00:00:00Z`).toISOString().startsWith(startDate)) problems.startDate = "Choose a start date.";
  else if (startDate < today) problems.startDate = "The start date can't be in the past.";
  if (!EMPLOYMENT_TYPES.includes(employmentType as EmploymentType)) problems.employmentType = "Choose an employment type.";
  if (typeof schedule !== "string" || schedule.trim() === "") problems.schedule = "Enter the work schedule.";
  if (!PROBATION_PERIODS.includes(probation as ProbationPeriod)) problems.probation = "Choose a probation period.";
  if (typeof reportsTo !== "string" || reportsTo.trim() === "") problems.reportsTo = "Choose who they report to.";
  return problems;
}
