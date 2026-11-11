import { randomUUID } from "node:crypto";
import { database, type Database } from "./database";
import { retryJobPostingAudit } from "./job-posting-audit";
import { hiredEmail } from "./offer-reply";
import { accessFor } from "./portal/access";
import { listStaffNames } from "./portal/client";
import { isValidDate } from "./offer-terms";
import { OFFER_ANSWERS, replyEmail, type OfferAnswer, type OfferReply } from "./offer-reply";
import {
  DOCUMENT_COUNT, PRE_EMPLOYMENT_DOCUMENTS, matchDocumentType, requestEmail, requestProblem, requestSummary,
  type DocumentRequestInput, type DocumentStatus, type DocumentType,
} from "./offer-documents";

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
export type OfferActivityKind = "sent" | "accepted" | "declined" | "reply-by-extended" | "email-scheduled" | "email-sent" | "documents-requested" | "hired";
export type OfferActivity = { kind: OfferActivityKind; actorName: string | null; detail: string | null; occurredAt: Date };
export type OfferStageName = "New" | "Screening" | "Interview" | "Offer" | "Hired" | "Rejected" | "Withdrawn";
/** Everything the Offer page shows. */
export type OfferDetail = OfferDraft & {
  sentAt: Date | null;
  replyBy: string | null;
  /** When the Applicant's reply came in, once there is one. */
  repliedAt: Date | null;
  stage: OfferStageName;
  stageDates: Partial<Record<OfferStageName, Date>>;
  activity: OfferActivity[];
};
export type OfferDocument = {
  type: DocumentType;
  label: string;
  hint: string;
  status: DocumentStatus;
  /** Informational: when Staff asked for it to be submitted by. */
  dueDate: string | null;
  /** "application" when the Applicant already sent it with the Application, "upload" when they sent it for the Offer. */
  source: "application" | "upload" | null;
  file: { name: string; downloadUrl: string | null } | null;
};
export type OfferChecklist = {
  items: OfferDocument[];
  submitted: number;
  total: number;
  /** Documents may be requested from Sent onward, never on a Draft, Declined or Withdrawn Offer. */
  canRequest: boolean;
};
export type EmployeeRecord = {
  id: number; employeeNumber: string; name: string; email: string; position: string; department: string | null;
  branch: string; startDate: string; status: "Onboarding" | "Active";
};
export type EmployeeList = { rows: EmployeeRecord[]; onboarding: number };
export type OfferCandidate ={ applicationId: number; applicantName: string; applicantEmail: string; role: string; branch: string };

export class OfferError extends Error {
  /** `detail` says why a conflict happened when the caller needs to tell its user (the Careers endpoint does). */
  constructor(public readonly reason: "denied" | "invalid" | "unavailable" | "validation" | "not-found" | "conflict", public readonly detail?: "withdrawn" | "draft" | "already-answered" | "declined") {
    super(`Offer: ${reason}`);
  }
}

const manilaToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const validId = (id: unknown) => Number.isInteger(id) && (id as number) > 0 && (id as number) <= 2_147_483_647;
const validApplicationId = (id: unknown) => Number.isInteger(id) && id !== 0 && Math.abs(id as number) <= 2_147_483_647;

export type OfferRow = {
  id: number; applicationId: number; applicantName: string; applicantEmail: string; role: string; branch: string;
  monthlySalary: number; startDate: string; employmentType: EmploymentType; schedule: string; probation: ProbationPeriod;
  reportsTo: string; sentAt: string | null; replyBy: string | null; repliedAt: string | null; status: OfferDisplayStatus;
};

export const SELECT_OFFERS = `
  SELECT o.id, o.application_id AS "applicationId", a.applicant_name AS "applicantName",
    a.applicant_email AS "applicantEmail", a.job_posting_title AS role, o.branch,
    o.monthly_salary AS "monthlySalary", o.start_date::text AS "startDate",
    o.employment_type AS "employmentType", o.schedule, o.probation, o.reports_to AS "reportsTo",
    o.sent_at AS "sentAt", o.reply_by::text AS "replyBy", o.replied_at AS "repliedAt",
    CASE WHEN a.stage = 'Withdrawn' THEN 'Withdrawn' ELSE o.status END AS status
  FROM public.hrms_offers o
  JOIN public.hrms_all_applications a ON a.id = o.application_id`;

/** Who a reply is recorded for: Staff, or the Applicant through the Careers endpoint (which also tells Staff). */
export type ReplyActor = { actorName: string; notifyStaff: boolean };

/**
 * The one place an Offer reply is written, for Staff and for the Applicant alike: status, Stage (a decline moves the
 * Application to Rejected), history, the queued email and, when `notifyStaff`, the Staff Notification. One statement or nothing.
 * The caller has already checked the times; this refuses anything but a Sent Offer.
 */
export async function applyReply(db: Database, offer: OfferRow, answer: OfferAnswer, repliedAt: Date, sendAt: Date | null, who: ReplyActor): Promise<void> {
  if (offer.status !== "Sent") throw new OfferError("conflict");
  const first = offer.applicantName.trim().split(/\s+/)[0] || offer.applicantName;
  const notice = { title: `Offer ${answer.toLowerCase()}: ${offer.applicantName}`, body: `${first} ${answer.toLowerCase()} the ${offer.role} offer.` };
  const email = replyEmail(answer, { applicantName: offer.applicantName, role: offer.role, startDate: offer.startDate });
  const payload = { to: offer.applicantEmail, app: "careers", title: email.title, body: email.body };
  const kind = answer === "Accepted" ? "accepted" : "declined";
  const { rows } = await db.query<{ recorded: boolean }>(`
    WITH replied AS (
      UPDATE public.hrms_offers o SET status = $2, replied_at = $3::timestamptz, updated_at = clock_timestamp()
      FROM public.hrms_all_applications a
      WHERE o.id = $1 AND o.status = 'Sent' AND a.id = o.application_id AND a.stage = 'Offer'
      RETURNING o.id, o.application_id
    ), moved_careers AS (
      UPDATE public.applications SET status = 'Rejected', updated_at = statement_timestamp()
      WHERE id = (SELECT application_id FROM replied) AND status = 'Offer' AND $2 = 'Declined'
      RETURNING id, applicant_id, updated_at
    ), moved_manual AS (
      UPDATE public.hrms_manual_applications SET status = 'Rejected', updated_at = statement_timestamp()
      WHERE id = (SELECT application_id FROM replied) AND status = 'Offer' AND $2 = 'Declined'
      RETURNING id, NULL::text AS applicant_id, updated_at
    ), moved AS (
      SELECT * FROM moved_careers UNION ALL SELECT * FROM moved_manual
    ), history AS (
      INSERT INTO public.hrms_application_stage_history (application_id, stage, reached_at)
      SELECT id, 'Rejected', updated_at FROM moved
    ), stage_activity AS (
      INSERT INTO public.hrms_application_activity (application_id, from_stage, to_stage, actor_name, reason, occurred_at)
      SELECT id, 'Offer', 'Rejected', $4, 'Declined the offer', updated_at FROM moved
    ), notification AS (
      INSERT INTO public.hrms_application_notifications (id, payload)
      SELECT 'application.stage:' || m.id || ':Rejected', jsonb_build_object(
        'sendingApp', 'hrms', 'targetApp', 'careers', 'userIds', jsonb_build_array(m.applicant_id),
        'type', 'application.rejected', 'title', 'Application update: Rejected',
        'body', 'Thank you for your interest. Your Application was not selected.',
        'idempotencyKey', 'application.stage:' || m.id || ':Rejected')
      FROM moved m WHERE m.applicant_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM neon_auth."user" u WHERE u.id::text = m.applicant_id)
      ON CONFLICT (id) DO NOTHING
    ), activity AS (
      INSERT INTO public.hrms_offer_activity (offer_id, kind, actor_name, detail, occurred_at)
      SELECT id, $5, $4, 'Reply received', $3::timestamptz FROM replied
      UNION ALL SELECT id, 'email-scheduled', NULL, $6, clock_timestamp() FROM replied
    ), email AS (
      INSERT INTO public.hrms_offer_emails (id, offer_id, payload, next_attempt_at)
      SELECT 'offer.' || $5 || ':' || id, id, $7::jsonb, COALESCE($8::timestamptz, clock_timestamp()) FROM replied
    ), staff_notice AS (
      INSERT INTO public.hrms_staff_notifications (id, payload)
      SELECT 'offer.' || $5 || ':' || id, jsonb_build_object('type', 'offer.' || $5, 'title', $10::text, 'body', $11::text, 'link', '/offers/' || id)
      FROM replied WHERE $9::boolean
      ON CONFLICT (id) DO NOTHING
    )
    SELECT EXISTS (SELECT 1 FROM replied) AS recorded`,
  [offer.id, answer, repliedAt.toISOString(), who.actorName, kind, `Email to ${offer.applicantEmail}`, JSON.stringify(payload), sendAt?.toISOString() ?? null,
  who.notifyStaff, notice.title, notice.body]);
  if (!rows[0].recorded) throw new OfferError("conflict");
}

/** The seven Pre-employment Documents with their status, read straight from the database (no Staff check). */
export async function readChecklist(db: Database, id: number): Promise<OfferChecklist> {
    if (!validId(id)) throw new OfferError("validation");
    const { rows } = await db.query<{ applicationId: number; status: OfferStatus; stage: OfferStageName; snapshot: { id: number; name?: string; requiredFor?: string }[] }>(`
      SELECT o.application_id AS "applicationId", o.status, a.stage,
        COALESCE((SELECT c.documents_snapshot FROM public.applications c WHERE c.id = o.application_id), '[]'::jsonb) AS snapshot
      FROM public.hrms_offers o JOIN public.hrms_all_applications a ON a.id = o.application_id WHERE o.id = $1`, [id]);
    if (!rows[0]) throw new OfferError("not-found");
    const { rows: stored } = await db.query<{ type: DocumentType; status: "Requested" | "Submitted"; dueDate: string | null; fileName: string | null }>(`
      SELECT document_type AS type, status, due_date::text AS "dueDate", file_name AS "fileName"
      FROM public.hrms_offer_documents WHERE offer_id = $1`, [id]);
    const { applicationId, status, stage, snapshot } = rows[0];
    const items = PRE_EMPLOYMENT_DOCUMENTS.map((document): OfferDocument => {
      const base = { type: document.type, label: document.label, hint: document.hint };
      const row = stored.find((item) => item.type === document.type);
      if (row) {
        return { ...base, status: row.status, dueDate: row.dueDate, source: row.status === "Submitted" ? "upload" : null,
          file: row.status === "Submitted" ? { name: row.fileName ?? document.label, downloadUrl: null } : null };
      }
      const sent = snapshot.find((item) => matchDocumentType(item.requiredFor, item.name) === document.type);
      if (sent) {
        return { ...base, status: "Submitted", dueDate: null, source: "application",
          file: { name: sent.name ?? document.label, downloadUrl: `/api/applications/${applicationId}/documents/${sent.id}` } };
      }
      return { ...base, status: "Not requested", dueDate: null, source: null, file: null };
    });
    return { items, submitted: items.filter((item) => item.status === "Submitted").length, total: DOCUMENT_COUNT,
      canRequest: (status === "Sent" || status === "Accepted") && stage !== "Withdrawn" };
}

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
      const { sentAt, replyBy, repliedAt, ...draft } = rows[0];
      void sentAt; void replyBy; void repliedAt;
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
      const { sentAt, repliedAt, stageDates, activity, ...rest } = rows[0];
      return {
        ...rest, sentAt: sentAt ? new Date(sentAt) : null, repliedAt: repliedAt ? new Date(repliedAt) : null,
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
    /**
     * Records the Applicant's reply to a Sent Offer. It is final. Declining moves the Application to Rejected
     * with its history, accepting leaves the Stage at Offer. The reply email is queued for `sendAt` (null: now)
     * and cannot be edited or cancelled. A Withdrawn Application's Offer allows nothing. One statement or nothing.
     */
    async recordReply(id: number, reply: OfferReply): Promise<void> {
      const staff = await authorise();
      const repliedAt = new Date(reply.repliedAt);
      const sendAt = reply.sendAt === null ? null : new Date(reply.sendAt);
      const now = Date.now();
      if (!validId(id) || !OFFER_ANSWERS.includes(reply.answer) || !Number.isFinite(repliedAt.getTime()) || repliedAt.getTime() > now + 60_000
        || (sendAt !== null && (!Number.isFinite(sendAt.getTime()) || sendAt.getTime() < now - 60_000))) throw new OfferError("validation");
      const { rows: found } = await db.query<OfferRow>(`${SELECT_OFFERS} WHERE o.id = $1`, [id]);
      const offer = found[0];
      if (!offer) throw new OfferError("not-found");
      if (offer.status !== "Sent") throw new OfferError("conflict");
      if (offer.sentAt && repliedAt < new Date(offer.sentAt)) throw new OfferError("validation");
      await applyReply(db, offer, reply.answer, repliedAt, sendAt, { actorName: staff.name, notifyStaff: false });
    },
    /**
     * The seven Pre-employment Documents with their status. One the Applicant already sent with the Application
     * starts Submitted, unless Staff have since requested it again.
     */
    async documents(id: number): Promise<OfferChecklist> {
      await authorise();
      return readChecklist(db, id);
    },
    /**
     * Asks the Applicant for documents: the chosen rows become Requested (a Submitted one is reset), the history records
     * it, and one email with the documents, due date and message is queued to go out at once. All of it or none.
     */
    async requestDocuments(id: number, input: DocumentRequestInput): Promise<void> {
      const staff = await authorise();
      if (!validId(id) || requestProblem(input, manilaToday())) throw new OfferError("validation");
      const { rows: found } = await db.query<{ status: OfferStatus; stage: OfferStageName; name: string; email: string; role: string }>(`
        SELECT o.status, a.stage, a.applicant_name AS name, a.applicant_email AS email, a.job_posting_title AS role
        FROM public.hrms_offers o JOIN public.hrms_all_applications a ON a.id = o.application_id WHERE o.id = $1`, [id]);
      const offer = found[0];
      if (!offer) throw new OfferError("not-found");
      if (!(offer.status === "Sent" || offer.status === "Accepted") || offer.stage === "Withdrawn") throw new OfferError("conflict");
      const message = input.message?.trim() || undefined;
      const email = requestEmail({ applicantName: offer.name, role: offer.role, types: input.types, dueDate: input.dueDate, message });
      const { rows } = await db.query<{ requested: boolean }>(`
        WITH ok AS (
          SELECT o.id FROM public.hrms_offers o JOIN public.hrms_all_applications a ON a.id = o.application_id
          WHERE o.id = $1 AND o.status IN ('Sent', 'Accepted') AND a.stage <> 'Withdrawn'
        ), upserted AS (
          INSERT INTO public.hrms_offer_documents (offer_id, document_type, status, due_date, message, requested_at, requested_by_name)
          SELECT ok.id, type, 'Requested', $3::date, $4, clock_timestamp(), $5 FROM ok, unnest($2::text[]) AS type
          ON CONFLICT (offer_id, document_type) DO UPDATE SET status = 'Requested', due_date = EXCLUDED.due_date,
            message = EXCLUDED.message, requested_at = EXCLUDED.requested_at, requested_by_name = EXCLUDED.requested_by_name, submitted_at = NULL
          RETURNING offer_id
        ), activity AS (
          INSERT INTO public.hrms_offer_activity (offer_id, kind, actor_name, detail)
          SELECT ok.id, 'documents-requested', $5, $6 FROM ok WHERE EXISTS (SELECT 1 FROM upserted) RETURNING id, offer_id
        ), queued AS (
          INSERT INTO public.hrms_offer_emails (id, offer_id, payload)
          SELECT 'offer.docs:' || activity.offer_id || ':' || activity.id, activity.offer_id,
            jsonb_build_object('to', $7::text, 'app', 'careers', 'title', $8::text, 'body', $9::text)
          FROM activity
        )
        SELECT EXISTS (SELECT 1 FROM activity) AS requested`,
      [id, input.types, input.dueDate, message ?? null, staff.name, requestSummary(input.types, input.dueDate), offer.email, email.title, email.body]);
      if (!rows[0].requested) throw new OfferError("conflict");
    },
    /**
     * Marks an Accepted Offer's Application as Hired. In one statement: the Application moves to Hired (with history),
     * the Employee record is created with the Offer's terms and links to the same document files, the hired welcome
     * email is queued, and the Job Posting becomes Filled once hires reach its openings (a Closed one stays Closed).
     * If any part fails, none apply. Needs the Offer Accepted and all seven documents Submitted.
     */
    async hire(id: number): Promise<{ employeeId: number }> {
      const staff = await authorise();
      if (!validId(id)) throw new OfferError("validation");
      const checklist = await this.documents(id);
      const { rows: found } = await db.query<OfferRow>(`${SELECT_OFFERS} WHERE o.id = $1`, [id]);
      const offer = found[0];
      if (!offer) throw new OfferError("not-found");
      if (offer.status !== "Accepted" || checklist.submitted < checklist.total) throw new OfferError("conflict");
      const files = checklist.items.map((item) => ({
        type: item.type, source: item.source,
        fileId: item.source === "application" ? item.file?.downloadUrl?.split("/").pop() ?? null : null,
        fileName: item.file?.name ?? null,
      }));
      const { rows: stored } = await db.query<{ type: DocumentType; fileId: string | null }>(
        `SELECT document_type AS type, file_id AS "fileId" FROM public.hrms_offer_documents WHERE offer_id = $1 AND status = 'Submitted'`, [id]);
      for (const row of stored) { const file = files.find((item) => item.type === row.type); if (file) file.fileId = row.fileId; }
      const email = hiredEmail({ applicantName: offer.applicantName, role: offer.role, startDate: offer.startDate });
      const payload = { to: offer.applicantEmail, app: "careers", title: email.title, body: email.body };
      const auditId = randomUUID();
      const event = {
        source: "HRMS", module: "Recruitment and Hiring", action: "job_posting.filled", outcome: "success",
        actor: { type: "user", id: staff.id ?? staff.username, display_name: staff.name },
        customer_description: null, occurred_at: new Date().toISOString(), idempotency_key: auditId,
        description: `${staff.name} performed job_posting.filled.`,
      };
      const { rows } = await db.query<{ employeeId: number | null; filled: boolean }>(`
        WITH ok AS (
          SELECT o.id, o.application_id, o.monthly_salary, o.start_date, o.employment_type, o.schedule, o.probation, o.reports_to, o.branch,
            a.applicant_name, a.applicant_email, a.job_posting_id, a.job_posting_title
          FROM public.hrms_offers o JOIN public.hrms_all_applications a ON a.id = o.application_id
          WHERE o.id = $1 AND o.status = 'Accepted' AND a.stage = 'Offer'
            AND NOT EXISTS (SELECT 1 FROM public.hrms_offer_documents d WHERE d.offer_id = o.id AND d.status = 'Requested')
        ), moved_careers AS (
          UPDATE public.applications SET status = 'Hired', updated_at = statement_timestamp()
          WHERE id = (SELECT application_id FROM ok) AND status = 'Offer'
          RETURNING id, applicant_id, updated_at
        ), moved_manual AS (
          UPDATE public.hrms_manual_applications SET status = 'Hired', updated_at = statement_timestamp()
          WHERE id = (SELECT application_id FROM ok) AND status = 'Offer'
          RETURNING id, NULL::text AS applicant_id, updated_at
        ), moved AS (
          SELECT * FROM moved_careers UNION ALL SELECT * FROM moved_manual
        ), history AS (
          INSERT INTO public.hrms_application_stage_history (application_id, stage, reached_at) SELECT id, 'Hired', updated_at FROM moved
        ), stage_activity AS (
          INSERT INTO public.hrms_application_activity (application_id, from_stage, to_stage, actor_name, occurred_at)
          SELECT id, 'Offer', 'Hired', $2, updated_at FROM moved
        ), notification AS (
          INSERT INTO public.hrms_application_notifications (id, payload)
          SELECT 'application.stage:' || m.id || ':Hired', jsonb_build_object(
            'sendingApp', 'hrms', 'targetApp', 'careers', 'userIds', jsonb_build_array(m.applicant_id),
            'type', 'application.hired', 'title', 'Application update: Hired',
            'body', 'Your Application has moved to Hired.', 'idempotencyKey', 'application.stage:' || m.id || ':Hired')
          FROM moved m WHERE m.applicant_id IS NOT NULL AND EXISTS (SELECT 1 FROM neon_auth."user" u WHERE u.id::text = m.applicant_id)
          ON CONFLICT (id) DO NOTHING
        ), employee AS (
          INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch,
            start_date, monthly_salary, employment_type, schedule, probation, reports_to, hired_by_name)
          SELECT 'BR-EMP-' || lpad(nextval('public.hrms_employee_number_seq')::text, 4, '0'), ok.id, ok.application_id, ok.applicant_name,
            ok.applicant_email, ok.job_posting_title, (SELECT j.department FROM public.job_postings j WHERE j.id = ok.job_posting_id), ok.branch,
            ok.start_date, ok.monthly_salary, ok.employment_type, ok.schedule, ok.probation, ok.reports_to, $2
          FROM ok WHERE EXISTS (SELECT 1 FROM moved)
          RETURNING id
        ), employee_documents AS (
          INSERT INTO public.hrms_employee_documents (employee_id, document_type, source, file_id, file_name)
          SELECT employee.id, f.type, f.source, f."fileId", f."fileName"
          FROM employee, jsonb_to_recordset($3::jsonb) AS f(type text, source text, "fileId" text, "fileName" text)
        ), activity AS (
          INSERT INTO public.hrms_offer_activity (offer_id, kind, actor_name, detail)
          SELECT ok.id, 'hired', $2, 'Employee record created' FROM ok WHERE EXISTS (SELECT 1 FROM employee)
          UNION ALL SELECT ok.id, 'email-scheduled', NULL, 'Welcome email to ' || ok.applicant_email FROM ok WHERE EXISTS (SELECT 1 FROM employee)
        ), email AS (
          INSERT INTO public.hrms_offer_emails (id, offer_id, payload)
          SELECT 'offer.hired:' || ok.id, ok.id, $4::jsonb FROM ok WHERE EXISTS (SELECT 1 FROM employee)
        ), filled AS (
          UPDATE public.job_postings p SET status = 'filled', updated_at = clock_timestamp()
          FROM ok
          WHERE p.id = ok.job_posting_id AND p.status = 'open' AND p.openings IS NOT NULL AND EXISTS (SELECT 1 FROM employee)
            AND (SELECT count(*) FROM public.hrms_all_applications h WHERE h.job_posting_id = p.id AND h.stage = 'Hired') + 1 >= p.openings
          RETURNING p.id, p.title
        ), audit AS (
          INSERT INTO public.hrms_audit_outbox (id, payload)
          SELECT $5, $6::jsonb || jsonb_build_object('target', jsonb_build_object('type', 'job_posting', 'id', id, 'display_name', COALESCE(NULLIF(title, ''), id)))
          FROM filled
        )
        SELECT (SELECT id FROM employee) AS "employeeId", EXISTS (SELECT 1 FROM filled) AS filled`,
      [id, staff.name, JSON.stringify(files), JSON.stringify(payload), auditId, JSON.stringify(event)]);
      if (rows[0].employeeId === null) throw new OfferError("conflict");
      if (rows[0].filled) await retryJobPostingAudit(db, auditId);
      return { employeeId: rows[0].employeeId };
    },
    /** The Hired list: real Employee records, newest first, with tab counts from the same snapshot. */
    async employees(): Promise<EmployeeList> {
      await authorise();
      const { rows } = await db.query<Omit<EmployeeRecord, "startDate"> & { startDate: string }>(`
        SELECT id, employee_number AS "employeeNumber", full_name AS name, email, position, department, branch,
          start_date::text AS "startDate", status
        FROM public.hrms_employees ORDER BY created_at DESC, id DESC`);
      return { rows, onboarding: rows.filter((row) => row.status === "Onboarding").length };
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
