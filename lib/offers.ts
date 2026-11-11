import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import { listStaffNames } from "./portal/client";

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

export type OfferListItem = {
  id: number;
  applicationId: number;
  applicantName: string;
  applicantEmail: string;
  role: string;
  monthlySalary: number;
  startDate: string;
  sentAt: Date | null;
  replyBy: string | null;
  status: OfferDisplayStatus;
};
export type OfferPage = {
  rows: OfferListItem[];
  counts: Record<OfferTab, number>;
  /** Sent Offers still waiting for a reply; Withdrawn ones are not counted. */
  waiting: number;
};
export type OfferDraft = OfferTerms & {
  id: number;
  applicationId: number;
  applicantName: string;
  applicantEmail: string;
  role: string;
  branch: string;
  status: OfferDisplayStatus;
};
export type OfferCandidate = { applicationId: number; applicantName: string; applicantEmail: string; role: string; branch: string };

export class OfferError extends Error {
  constructor(public readonly reason: "denied" | "invalid" | "unavailable" | "validation" | "not-found" | "conflict") {
    super(`Offer: ${reason}`);
  }
}

const validId = (id: unknown) => Number.isInteger(id) && (id as number) > 0 && (id as number) <= 2_147_483_647;
const validApplicationId = (id: unknown) => Number.isInteger(id) && id !== 0 && Math.abs(id as number) <= 2_147_483_647;
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

type OfferRow = {
  id: number; applicationId: number; applicantName: string; applicantEmail: string; role: string; branch: string;
  monthlySalary: number; startDate: string; employmentType: EmploymentType; schedule: string; probation: ProbationPeriod;
  reportsTo: string; sentAt: string | null; replyBy: string | null; status: OfferDisplayStatus;
};

const SELECT_OFFERS = `
  SELECT o.id, o.application_id AS "applicationId", a.applicant_name AS "applicantName",
    a.applicant_email AS "applicantEmail", a.job_posting_title AS role, o.branch,
    o.monthly_salary AS "monthlySalary", o.start_date::text AS "startDate",
    o.employment_type AS "employmentType", o.schedule, o.probation, o.reports_to AS "reportsTo",
    o.sent_at AS "sentAt", o.reply_by::text AS "replyBy",
    CASE WHEN a.stage = 'Withdrawn' THEN 'Withdrawn' ELSE o.status END AS status
  FROM public.hrms_offers o
  JOIN public.hrms_all_applications a ON a.id = o.application_id`;

/** Server-side boundary. Recheck the Portal on every operation, including repeated reads. */
export function offersFor(sessionHandle: string | undefined, db: Database = database, staffNames: () => Promise<string[] | null> = listStaffNames) {
  async function authorise() {
    const access = await accessFor(sessionHandle).check("Recruitment and Hiring");
    if (access.decision !== "allowed") throw new OfferError(access.decision);
    return access.staff;
  }

  const values = (terms: OfferTerms) => [terms.monthlySalary, terms.startDate, terms.employmentType, terms.schedule.trim(), terms.probation, terms.reportsTo.trim()];

  return {
    /** Every Offer in one tab, with all tab counts from the same snapshot. */
    async list(tab: OfferTab = "All"): Promise<OfferPage> {
      await authorise();
      if (!OFFER_TABS.includes(tab)) throw new OfferError("validation");
      const { rows } = await db.query<Omit<OfferRow, "sentAt"> & { sentAt: string | null; createdAt: string }>(
        `${SELECT_OFFERS} ORDER BY o.created_at DESC, o.id DESC`);
      const counts = Object.fromEntries(OFFER_TABS.map((name) => [name, 0])) as Record<OfferTab, number>;
      for (const row of rows) {
        counts[row.status] += 1;
        // A Withdrawn Application's Offer shows under Withdrawn only, never All.
        if (row.status !== "Withdrawn") counts.All += 1;
      }
      return {
        counts, waiting: counts.Sent,
        rows: rows.filter((row) => (tab === "All" ? row.status !== "Withdrawn" : row.status === tab))
          .map((row) => ({ id: row.id, applicationId: row.applicationId, applicantName: row.applicantName,
            applicantEmail: row.applicantEmail, role: row.role, monthlySalary: row.monthlySalary, startDate: row.startDate,
            sentAt: row.sentAt ? new Date(row.sentAt) : null, replyBy: row.replyBy, status: row.status })),
      };
    },
    /** Applications at the Offer Stage with no Offer yet: the New offer picker. */
    async candidates(): Promise<OfferCandidate[]> {
      await authorise();
      const { rows } = await db.query<OfferCandidate>(`
        SELECT a.id AS "applicationId", a.applicant_name AS "applicantName", a.applicant_email AS "applicantEmail",
          a.job_posting_title AS role, a.location AS branch
        FROM public.hrms_all_applications a
        WHERE a.stage = 'Offer' AND NOT EXISTS (SELECT 1 FROM public.hrms_offers o WHERE o.application_id = a.id)
        ORDER BY a.applied_at DESC, a.id DESC`);
      return rows;
    },
    /** One candidate for a new Draft, or not-found when the Application is not at Offer or already has an Offer. */
    async candidate(applicationId: number): Promise<OfferCandidate> {
      if (!validApplicationId(applicationId)) { await authorise(); throw new OfferError("validation"); }
      const found = (await this.candidates()).find((item) => item.applicationId === applicationId);
      if (!found) throw new OfferError("not-found");
      return found;
    },
    async read(id: number): Promise<OfferDraft> {
      await authorise();
      if (!validId(id)) throw new OfferError("validation");
      const { rows } = await db.query<OfferRow>(`${SELECT_OFFERS} WHERE o.id = $1`, [id]);
      if (!rows[0]) throw new OfferError("not-found");
      const { sentAt, replyBy, ...draft } = rows[0];
      void sentAt; void replyBy;
      return draft;
    },
    /** Names for the "Reports to" picker. */
    async staff(): Promise<string[]> {
      await authorise();
      const names = await staffNames();
      if (!names) throw new OfferError("unavailable");
      return names;
    },
    /** Saves a Draft for an Application at the Offer Stage that has no Offer. The branch comes from the Job Posting. */
    async create(applicationId: number, terms: OfferTerms): Promise<number> {
      const staff = await authorise();
      if (!validApplicationId(applicationId) || Object.keys(termsProblems(terms)).length > 0) throw new OfferError("validation");
      try {
        const { rows } = await db.query<{ id: number | null; known: boolean }>(`
          WITH inserted AS (
            INSERT INTO public.hrms_offers
              (application_id, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
            SELECT a.id, $2, $3::date, $4, $5, $6, $7, a.location, $8
            FROM public.hrms_all_applications a
            WHERE a.id = $1 AND a.stage = 'Offer'
              AND NOT EXISTS (SELECT 1 FROM public.hrms_offers o WHERE o.application_id = a.id)
            RETURNING id
          )
          SELECT (SELECT id FROM inserted) AS id,
            EXISTS (SELECT 1 FROM public.hrms_all_applications WHERE id = $1) AS known`,
        [applicationId, ...values(terms), staff.name]);
        if (rows[0].id !== null) return rows[0].id;
        throw new OfferError(rows[0].known ? "conflict" : "not-found");
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new OfferError("conflict");
        throw error;
      }
    },
    /** Edits a Draft. Once sent the terms are locked, and a Withdrawn Application's Offer allows no action. */
    async update(id: number, terms: OfferTerms): Promise<void> {
      await authorise();
      if (!validId(id) || Object.keys(termsProblems(terms)).length > 0) throw new OfferError("validation");
      const { rows } = await db.query<{ updated: boolean; known: boolean }>(`
        WITH updated AS (
          UPDATE public.hrms_offers o SET monthly_salary = $2, start_date = $3::date, employment_type = $4,
            schedule = $5, probation = $6, reports_to = $7, updated_at = clock_timestamp()
          FROM public.hrms_all_applications a
          WHERE o.id = $1 AND o.status = 'Draft' AND a.id = o.application_id AND a.stage <> 'Withdrawn'
          RETURNING o.id
        )
        SELECT EXISTS (SELECT 1 FROM updated) AS updated,
          EXISTS (SELECT 1 FROM public.hrms_offers WHERE id = $1) AS known`, [id, ...values(terms)]);
      if (!rows[0].updated) throw new OfferError(rows[0].known ? "conflict" : "not-found");
    },
    /** Deletes a Draft; its Application goes back to the New offer picker. */
    async delete(id: number): Promise<void> {
      await authorise();
      if (!validId(id)) throw new OfferError("validation");
      const { rows } = await db.query<{ deleted: boolean; known: boolean }>(`
        WITH deleted AS (
          DELETE FROM public.hrms_offers o
          USING public.hrms_all_applications a
          WHERE o.id = $1 AND o.status = 'Draft' AND a.id = o.application_id AND a.stage <> 'Withdrawn'
          RETURNING o.id
        )
        SELECT EXISTS (SELECT 1 FROM deleted) AS deleted,
          EXISTS (SELECT 1 FROM public.hrms_offers WHERE id = $1) AS known`, [id]);
      if (!rows[0].deleted) throw new OfferError(rows[0].known ? "conflict" : "not-found");
    },
  };
}
