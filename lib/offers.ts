import { database, type Database } from "./database";
import { accessFor } from "./portal/access";
import { listStaffNames } from "./portal/client";
import { isValidDate } from "./offer-terms";

import {
  EMPLOYMENT_TYPES, OFFER_STATUSES, OFFER_TABS, PROBATION_PERIODS, termsProblems,
  type EmploymentType, type OfferDisplayStatus, type OfferStatus, type OfferTab, type OfferTerms, type ProbationPeriod,
} from "./offer-terms";

export { EMPLOYMENT_TYPES, OFFER_STATUSES, OFFER_TABS, PROBATION_PERIODS, termsProblems };
export type { EmploymentType, OfferDisplayStatus, OfferStatus, OfferTab, OfferTerms, ProbationPeriod };

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
export type OfferActivityKind = "sent" | "reply-by-extended" | "email-scheduled" | "email-sent";
export type OfferActivity = { kind: OfferActivityKind; actorName: string | null; detail: string | null; occurredAt: Date };
export type OfferStageName = "New" | "Screening" | "Interview" | "Offer" | "Hired" | "Rejected" | "Withdrawn";
/** Everything the Offer page shows. */
export type OfferDetail = OfferDraft & {
  sentAt: Date | null;
  replyBy: string | null;
  stage: OfferStageName;
  stageDates: Partial<Record<OfferStageName, Date>>;
  activity: OfferActivity[];
};
export type OfferCandidate = { applicationId: number; applicantName: string; applicantEmail: string; role: string; branch: string };

export class OfferError extends Error {
  constructor(public readonly reason: "denied" | "invalid" | "unavailable" | "validation" | "not-found" | "conflict") {
    super(`Offer: ${reason}`);
  }
}

const manilaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const validId = (id: unknown) => Number.isInteger(id) && (id as number) > 0 && (id as number) <= 2_147_483_647;
const validApplicationId = (id: unknown) => Number.isInteger(id) && id !== 0 && Math.abs(id as number) <= 2_147_483_647;

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
    /** The Offer page: terms, dates, stage dates and history. */
    async detail(id: number): Promise<OfferDetail> {
      await authorise();
      if (!validId(id)) throw new OfferError("validation");
      const { rows } = await db.query<OfferRow & { stage: OfferStageName; stageDates: Record<string, string>; activity: (Omit<OfferActivity, "occurredAt"> & { occurredAt: string })[] }>(`
        SELECT x.*, a.stage,
          jsonb_build_object('New', a.applied_at) || COALESCE((SELECT jsonb_object_agg(h.stage, h.reached_at)
            FROM public.hrms_application_stage_history h WHERE h.application_id = a.id), '{}'::jsonb) AS "stageDates",
          COALESCE((SELECT jsonb_agg(jsonb_build_object('kind', e.kind, 'actorName', e.actor_name, 'detail', e.detail, 'occurredAt', e.occurred_at)
            ORDER BY e.occurred_at DESC, e.id DESC) FROM public.hrms_offer_activity e WHERE e.offer_id = x.id), '[]'::jsonb) AS activity
        FROM (${SELECT_OFFERS} WHERE o.id = $1) x
        JOIN public.hrms_all_applications a ON a.id = x."applicationId"`, [id]);
      if (!rows[0]) throw new OfferError("not-found");
      const { sentAt, stageDates, activity, ...rest } = rows[0];
      return {
        ...rest, sentAt: sentAt ? new Date(sentAt) : null,
        stageDates: Object.fromEntries(Object.entries(stageDates).map(([stage, date]) => [stage, new Date(date)])),
        activity: activity.map((entry) => ({ ...entry, occurredAt: new Date(entry.occurredAt) })),
      };
    },
    /**
     * Sends a Draft: it becomes Sent with a reply-by date, its terms lock, and the Applicant's email
     * (every term) is queued in the outbox. All of it happens in one statement or none.
     */
    async send(id: number, replyBy: string): Promise<void> {
      const staff = await authorise();
      if (!validId(id) || !isValidDate(replyBy) || replyBy < manilaToday()) throw new OfferError("validation");
      const { rows } = await db.query<{ sent: boolean; known: boolean }>(`
        WITH sent AS (
          UPDATE public.hrms_offers o SET status = 'Sent', sent_at = clock_timestamp(), reply_by = $2::date, updated_at = clock_timestamp()
          FROM public.hrms_all_applications a
          WHERE o.id = $1 AND o.status = 'Draft' AND a.id = o.application_id AND a.stage = 'Offer'
          RETURNING o.id, o.monthly_salary, o.start_date, o.employment_type, o.schedule, o.probation, o.reports_to, o.branch, o.reply_by,
            a.applicant_name, a.applicant_email, a.job_posting_title
        ), activity AS (
          INSERT INTO public.hrms_offer_activity (offer_id, kind, actor_name, detail)
          SELECT id, 'sent', $3, 'Reply by ' || to_char(reply_by, 'FMDD Mon YYYY') FROM sent
          UNION ALL SELECT id, 'email-scheduled', NULL, 'Offer email to ' || applicant_email FROM sent
        ), email AS (
          INSERT INTO public.hrms_offer_emails (id, offer_id, payload)
          SELECT 'offer.sent:' || id, id, jsonb_build_object('to', applicant_email, 'app', 'careers',
            'title', 'Your job offer: ' || job_posting_title,
            'body', 'Dear ' || applicant_name || E',\n\nWe are pleased to offer you the position of ' || job_posting_title || ' at Bren Raphael''s (' || branch || E').\n\n'
              || E'Monthly salary: PHP ' || to_char(monthly_salary, 'FM999,999,999') || E'\n'
              || E'Start date: ' || to_char(start_date, 'FMDD Mon YYYY') || E'\n'
              || E'Employment type: ' || employment_type || E'\n'
              || E'Schedule: ' || schedule || E'\n'
              || E'Probation: ' || probation || E'\n'
              || E'Reports to: ' || reports_to || E'\n\n'
              || E'Please reply by ' || to_char(reply_by, 'FMDD Mon YYYY') || '.')
          FROM sent
        )
        SELECT EXISTS (SELECT 1 FROM sent) AS sent, EXISTS (SELECT 1 FROM public.hrms_offers WHERE id = $1) AS known`,
      [id, replyBy, staff.name]);
      if (!rows[0].sent) throw new OfferError(rows[0].known ? "conflict" : "not-found");
    },
    /** Gives a Sent Offer more time. The new date must be later than the current one; nothing expires either way. */
    async extendReplyBy(id: number, replyBy: string): Promise<void> {
      const staff = await authorise();
      if (!validId(id) || !isValidDate(replyBy) || replyBy < manilaToday()) throw new OfferError("validation");
      const { rows } = await db.query<{ updated: boolean; status: string | null; stage: string | null }>(`
        WITH cur AS (
          SELECT o.id, o.status, o.reply_by, a.stage FROM public.hrms_offers o
          JOIN public.hrms_all_applications a ON a.id = o.application_id WHERE o.id = $1
        ), updated AS (
          UPDATE public.hrms_offers o SET reply_by = $2::date, updated_at = clock_timestamp()
          FROM cur WHERE o.id = cur.id AND cur.status = 'Sent' AND cur.stage <> 'Withdrawn' AND $2::date > cur.reply_by
          RETURNING o.id, cur.reply_by AS previous
        ), activity AS (
          INSERT INTO public.hrms_offer_activity (offer_id, kind, actor_name, detail)
          SELECT id, 'reply-by-extended', $3, to_char(previous, 'FMDD Mon YYYY') || ' to ' || to_char($2::date, 'FMDD Mon YYYY') FROM updated
        )
        SELECT EXISTS (SELECT 1 FROM updated) AS updated, (SELECT status FROM cur) AS status, (SELECT stage FROM cur) AS stage`,
      [id, replyBy, staff.name]);
      const row = rows[0];
      if (row.updated) return;
      if (row.status === null) throw new OfferError("not-found");
      throw new OfferError(row.status === "Sent" && row.stage !== "Withdrawn" ? "validation" : "conflict");
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
