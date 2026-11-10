import { gatewayDocumentFiles, type DocumentFiles } from "@/lib/document-files";
import { MANUAL_SOURCES, type ApplicationSource, type ManualSource } from "./application-sources";
import { database, type Database } from "./database";
import { accessFor } from "./portal/access";

export type ApplicationStage = "New" | "Screening" | "Interview" | "Offer" | "Hired" | "Rejected" | "Withdrawn";
export type ApplicationListItem = {
  id: number;
  applicantName: string;
  applicantEmail: string;
  jobPostingId: string;
  jobPostingTitle: string;
  location: string;
  appliedAt: Date;
  stage: ApplicationStage;
  nextStep: string;
  source: ApplicationSource;
};
type SubmittedDocument = { id: number; name: string; size: number; contentType: string; uploadedAt: Date | null; requiredFor: string };
export type ApplicationDocument = (SubmittedDocument & { status: "Submitted"; downloadUrl: string })
  | { requiredFor: string; status: "Requested" };
export type InterviewInput = { startsAt: string; endsAt: string; type: "Online" | "In person"; interviewerName: string; location: string };
export type ApplicationInterview = Omit<InterviewInput, "startsAt" | "endsAt"> & { id: number; startsAt: Date; endsAt: Date; score: number | null; result: "Passed" | "Not passed" | null };
export type ApplicationNote = { id: number; text: string; authorName: string; createdAt: Date };
export type ApplicationActivity = {
  interviewId?: number;
  id: number;
  fromStage: ApplicationStage;
  toStage: ApplicationStage;
  actorName: string;
  reason: string | null;
  occurredAt: Date;
};
export type ApplicationProfile = Omit<ApplicationListItem, "nextStep"> & {
  interviews: ApplicationInterview[];
  documents: ApplicationDocument[];
  notes: ApplicationNote[];
  stageDates: Partial<Record<ApplicationStage, Date>>;
  activity: ApplicationActivity[];
  mobile: string | null;
  address: string | null;
  expectedSalary: number | null;
  availableFrom: string | null;
  referredBy: string | null;
};
export type ManualApplicantInput = { fullName: string; email: string; mobile: string; address: string; jobPostingId: string; expectedSalary: number; availableFrom: string; source: ManualSource; referredBy?: string };
export type ApplicationTab = "All" | Exclude<ApplicationStage, "Withdrawn">;
export type ApplicationFilters = { jobPostingId?: string; stage?: ApplicationTab; search?: string };
export type ApplicationJobPostingOption = { id: string; title: string; applicationCount: number };
export type ApplicationPage = { jobPostingOptions: ApplicationJobPostingOption[]; newThisWeek: number; stageCounts: Record<ApplicationTab, number>; rows: ApplicationListItem[]; total: number; page: number; pageSize: 25 };

export class ApplicationError extends Error {
  constructor(public readonly reason: "denied" | "invalid" | "unavailable" | "validation" | "not-found" | "conflict") {
    super(`Application: ${reason}`);
  }
}

const nextSteps: Record<ApplicationStage, string> = {
  New: "Review application",
  Screening: "Schedule interview",
  Interview: "Awaiting result",
  Offer: "Awaiting offer decision",
  Hired: "Hired",
  Rejected: "In talent pool",
  Withdrawn: "Withdrawn by applicant",
};

// Careers ids are positive; HR-added Applications count down from -1.
const validId = (id: unknown) => Number.isInteger(id) && id !== 0 && Math.abs(id as number) <= 2_147_483_647;

/** Server-side boundary. Recheck the Portal on every operation, including repeated reads. */
export function applicationsFor(sessionHandle: string | undefined, db: Database = database, files: DocumentFiles = gatewayDocumentFiles()) {
  async function read({ page = 1, stage = "All", search = "", jobPostingId }: ApplicationFilters & { page?: number } = {}, paginated = true): Promise<ApplicationPage> {
    const access = await accessFor(sessionHandle).check("Recruitment and Hiring");
    if (access.decision !== "allowed") throw new ApplicationError(access.decision);
    if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger((page - 1) * 25)
      || !["All", "New", "Screening", "Interview", "Offer", "Hired", "Rejected"].includes(stage)
      || typeof search !== "string"
      || (jobPostingId !== undefined && (typeof jobPostingId !== "string" || jobPostingId.trim() === ""))) {
      throw new ApplicationError("validation");
    }
    // One statement keeps rows and counts on the same snapshot, even for an empty page.
    const { rows } = await db.query<{ total: number; new_this_week: number; stage_counts: Record<ApplicationTab, number>; job_posting_options: ApplicationJobPostingOption[]; items: (Omit<ApplicationListItem, "nextStep" | "appliedAt"> & { appliedAt: string; nextInterviewAt: string | null })[] }>(`
      WITH searched AS (
        SELECT * FROM public.hrms_all_applications
        WHERE ($4::text IS NULL OR job_posting_id = $4)
          AND (strpos(lower(applicant_name), lower($3::text)) > 0
            OR strpos(lower(applicant_email), lower($3::text)) > 0)
      )
      SELECT (SELECT COALESCE(jsonb_agg(to_jsonb(options) ORDER BY options.title, options.id), '[]'::jsonb)
        FROM (
          SELECT j.id, j.title, count(a.id)::integer AS "applicationCount"
          FROM public.job_postings j
          LEFT JOIN public.hrms_all_applications a ON a.job_posting_id = j.id
          WHERE j.status = 'open'
          GROUP BY j.id, j.title
        ) options) AS job_posting_options,
        (SELECT count(*)::integer FROM searched WHERE ($2::text = 'All' OR stage = $2)) AS total,
        (SELECT count(*)::integer FROM public.hrms_all_applications
          WHERE applied_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
            AND applied_at <= CURRENT_TIMESTAMP) AS new_this_week,
        (SELECT jsonb_build_object(
          'All', count(*)::integer,
          'New', count(*) FILTER (WHERE stage = 'New')::integer,
          'Screening', count(*) FILTER (WHERE stage = 'Screening')::integer,
          'Interview', count(*) FILTER (WHERE stage = 'Interview')::integer,
          'Offer', count(*) FILTER (WHERE stage = 'Offer')::integer,
          'Hired', count(*) FILTER (WHERE stage = 'Hired')::integer,
          'Rejected', count(*) FILTER (WHERE stage = 'Rejected')::integer
        ) FROM searched) AS stage_counts,
        COALESCE(jsonb_agg(to_jsonb(items) ORDER BY items."appliedAt" DESC, items.id DESC)
          FILTER (WHERE items.id IS NOT NULL), '[]'::jsonb) AS items
      FROM (
        SELECT id, applicant_name AS "applicantName", applicant_email AS "applicantEmail",
          job_posting_id AS "jobPostingId", job_posting_title AS "jobPostingTitle",
          location, applied_at AS "appliedAt", stage, source,
          (SELECT min(i.starts_at) FROM public.hrms_application_interviews i
            WHERE i.application_id = searched.id AND i.starts_at >= CURRENT_TIMESTAMP
              AND i.result IS NULL) AS "nextInterviewAt"
        FROM searched
        WHERE ($2::text = 'All' OR stage = $2)
        ORDER BY applied_at DESC, id DESC LIMIT $5 OFFSET $1
      ) items`, [(page - 1) * 25, stage, search, jobPostingId ?? null, paginated ? 25 : null]);
    return {
      rows: rows[0].items.map(({ nextInterviewAt, ...item }) => ({ ...item, appliedAt: new Date(item.appliedAt),
        nextStep: item.stage === "Interview" && nextInterviewAt
          ? `Interview · ${new Date(nextInterviewAt).toLocaleString("en-US", { timeZone: "Asia/Manila", year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
          : nextSteps[item.stage] })),
      jobPostingOptions: rows[0].job_posting_options,
      newThisWeek: rows[0].new_this_week, stageCounts: rows[0].stage_counts, total: rows[0].total, page, pageSize: 25,
    };
  }

  async function recordChange(id: number, fromStage: ApplicationStage, toStage: ApplicationStage, actorName: string, reason?: string, interview?: InterviewInput) {
      // One statement is one transaction: a failed history/activity insert rolls back the status.
      // PostgreSQL rechecks this status predicate after waiting for a concurrent writer.
      const { rows } = await db.query<{ moved: boolean; exists: boolean }>(`
        WITH moved_careers AS (
          UPDATE public.applications SET status = $3, updated_at = statement_timestamp()
          WHERE id = $1 AND status = $2
          RETURNING id, applicant_id, updated_at
        ), moved_manual AS (
          UPDATE public.hrms_manual_applications SET status = $3, updated_at = statement_timestamp()
          WHERE id = $1 AND status = $4
          RETURNING id, NULL::text AS applicant_id, updated_at
        ), moved AS (
          SELECT * FROM moved_careers UNION ALL SELECT * FROM moved_manual
        ), interview AS (
          INSERT INTO public.hrms_application_interviews
            (application_id, starts_at, ends_at, type, interviewer_name, location)
          SELECT id, $7::timestamptz, $8::timestamptz, $9, $10, $11 FROM moved WHERE $7::timestamptz IS NOT NULL
          RETURNING id
        ), history AS (
          INSERT INTO public.hrms_application_stage_history (application_id, stage, reached_at)
          SELECT id, $3, updated_at FROM moved WHERE $2 <> $3
        ), notification AS (
          INSERT INTO public.hrms_application_notifications (id, payload)
          SELECT 'application.stage:' || m.id || ':' || $3, jsonb_build_object(
            'sendingApp', 'hrms', 'targetApp', 'careers', 'userIds', jsonb_build_array(m.applicant_id),
            'type', 'application.' || lower($3), 'title', 'Application update: ' || $3,
            'body', CASE WHEN $3 = 'Rejected'
              THEN 'Thank you for your interest. Your Application was not selected.'
              ELSE 'Your Application has moved to ' || $3 || '.' END,
            'idempotencyKey', 'application.stage:' || m.id || ':' || $3)
          FROM moved m WHERE $2 <> $3 AND $3 IN ('Interview', 'Offer', 'Hired', 'Rejected')
            AND m.applicant_id IS NOT NULL
            AND EXISTS (SELECT 1 FROM neon_auth."user" u WHERE u.id::text = m.applicant_id)
          ON CONFLICT (id) DO NOTHING
        ), activity AS (
          INSERT INTO public.hrms_application_activity
            (application_id, from_stage, to_stage, actor_name, reason, occurred_at, interview_id)
          SELECT id, $4, $3, $5, $6, updated_at, (SELECT id FROM interview) FROM moved
        )
        SELECT EXISTS(SELECT 1 FROM moved) AS moved,
          EXISTS(SELECT 1 FROM public.hrms_all_applications WHERE id = $1) AS exists`,
      [id, fromStage === "New" ? "Received" : fromStage, toStage, fromStage, actorName, reason ?? null, interview?.startsAt ?? null, interview?.endsAt ?? null, interview?.type ?? null, interview?.interviewerName.trim() ?? null, interview?.location.trim() ?? null]);
      if (!rows[0].moved) throw new ApplicationError(rows[0].exists ? "conflict" : "not-found");
  }

  return {
    /** Records a walk-in or referral on an Open Job Posting in HRMS' own table; applied date is today. */
    async addApplicant(input: ManualApplicantInput): Promise<number> {
      const access = await accessFor(sessionHandle).check("Recruitment and Hiring");
      if (access.decision !== "allowed") throw new ApplicationError(access.decision);
      const text = (value: unknown) => typeof value === "string" && value.trim() !== "";
      const date = (value: unknown) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);
      if (!input || !["fullName", "email", "mobile", "address", "jobPostingId"].every((key) => text(input[key as keyof ManualApplicantInput]))
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
        || typeof input.expectedSalary !== "number" || !Number.isFinite(input.expectedSalary) || input.expectedSalary < 0
        || !date(input.availableFrom)
        || !MANUAL_SOURCES.includes(input.source)
        || (input.source === "Referral" ? !text(input.referredBy) : input.referredBy !== undefined && input.referredBy !== "")) throw new ApplicationError("validation");
      const email = input.email.trim();
      try {
        // One statement checks the posting and both sources; the unique index settles HR-side races.
        const { rows } = await db.query<{ id: number | null; posting_status: string | null }>(`
          WITH posting AS (
            SELECT status FROM public.job_postings WHERE id = $5
          ), inserted AS (
            INSERT INTO public.hrms_manual_applications
              (full_name, email, mobile, address, job_posting_id, expected_salary, available_from, added_by_name, source, referred_by)
            SELECT $1, $2, $3, $4, $5, $6, $7::date, $8, $9, $10 FROM posting
            WHERE status = 'open' AND NOT EXISTS (
              SELECT 1 FROM public.hrms_all_applications a
              WHERE a.job_posting_id = $5 AND lower(a.applicant_email) = lower($2))
            RETURNING id
          )
          SELECT (SELECT id FROM inserted) AS id, (SELECT status FROM posting) AS posting_status`,
        [input.fullName.trim(), email, input.mobile.trim(), input.address.trim(), input.jobPostingId,
          input.expectedSalary, input.availableFrom, access.staff.name, input.source,
          input.source === "Referral" ? input.referredBy!.trim() : null]);
        if (rows[0].id !== null) return rows[0].id;
        throw new ApplicationError(rows[0].posting_status === null ? "not-found" : "conflict");
      } catch (error) {
        if ((error as { code?: string }).code === "23505") throw new ApplicationError("conflict");
        throw error;
      }
    },
    async addNote(id: number, text: string): Promise<void> {
      const access = await accessFor(sessionHandle).check("Recruitment and Hiring");
      if (access.decision !== "allowed") throw new ApplicationError(access.decision);
      if (!validId(id)
        || typeof text !== "string" || text.trim() === "") throw new ApplicationError("validation");
      const { rows } = await db.query<{ id: number }>(`
        INSERT INTO public.hrms_application_notes (application_id, text, author_name)
        SELECT id, $2, $3 FROM public.hrms_all_applications WHERE id = $1
        RETURNING id`, [id, text.trim(), access.staff.name]);
      if (!rows[0]) throw new ApplicationError("not-found");
    },
    /** The caller supplies the Stage they reviewed, so stale actions cannot advance it twice. */
    async moveStage(id: number, fromStage: ApplicationStage, toStage: ApplicationStage, reason?: string): Promise<void> {
      const access = await accessFor(sessionHandle).check("Recruitment and Hiring");
      if (access.decision !== "allowed") throw new ApplicationError(access.decision);
      const forward: Partial<Record<ApplicationStage, ApplicationStage>> = {
        New: "Screening", Screening: "Interview", Interview: "Offer", Offer: "Hired",
      };
      if (!validId(id)
        || !Object.hasOwn(forward, fromStage)
        || (toStage !== "Rejected" && forward[fromStage] !== toStage)
        || (reason !== undefined && (typeof reason !== "string" || toStage !== "Rejected"))) {
        throw new ApplicationError("validation");
      }
      await recordChange(id, fromStage, toStage, access.staff.name, reason);
    },
    async scheduleInterview(id: number, fromStage: ApplicationStage, interview: InterviewInput): Promise<void> {
      const access = await accessFor(sessionHandle).check("Recruitment and Hiring");
      if (access.decision !== "allowed") throw new ApplicationError(access.decision);
      const timestamp = (value: unknown) => typeof value === "string" && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));
      if (!validId(id)
        || !["Screening", "Interview"].includes(fromStage) || !interview
        || !timestamp(interview.startsAt) || !timestamp(interview.endsAt)
        || Date.parse(interview.endsAt) <= Date.parse(interview.startsAt)
        || !["Online", "In person"].includes(interview.type)
        || typeof interview.interviewerName !== "string" || !interview.interviewerName.trim()
        || typeof interview.location !== "string" || !interview.location.trim()) throw new ApplicationError("validation");
      await recordChange(id, fromStage, "Interview", access.staff.name, undefined, interview);
    },
    async recordInterviewResult(id: number, interviewId: number, outcome: { score: number; result: "Passed" | "Not passed" }): Promise<void> {
      const access = await accessFor(sessionHandle).check("Recruitment and Hiring");
      if (access.decision !== "allowed") throw new ApplicationError(access.decision);
      if (!validId(id) || !(Number.isSafeInteger(interviewId) && interviewId > 0 && interviewId <= 2_147_483_647)
        || !outcome || !Number.isInteger(outcome.score) || outcome.score < 1 || outcome.score > 5
        || !["Passed", "Not passed"].includes(outcome.result)) throw new ApplicationError("validation");
      // Keep the private result and its Staff activity in the same atomic statement.
      // The database clock enforces the start-time boundary for every caller.
      const { rows } = await db.query<{ recorded: boolean; exists: boolean }>(`
        WITH recorded AS (
          UPDATE public.hrms_application_interviews SET score = $3, result = $4
          WHERE application_id = $1 AND id = $2 AND starts_at <= statement_timestamp()
          RETURNING id, application_id
        ), activity AS (
          INSERT INTO public.hrms_application_activity
            (application_id, from_stage, to_stage, actor_name, reason, interview_id, occurred_at)
          SELECT a.id, a.stage, a.stage, $5, $6, r.id, statement_timestamp()
          FROM recorded r JOIN public.hrms_all_applications a ON a.id = r.application_id
        )
        SELECT EXISTS(SELECT 1 FROM recorded) AS recorded,
          EXISTS(SELECT 1 FROM public.hrms_application_interviews WHERE application_id = $1 AND id = $2) AS exists`,
      [id, interviewId, outcome.score, outcome.result, access.staff.name,
        `Interview result: ${outcome.result} (score: ${outcome.score}/5)`]);
      if (!rows[0].recorded) throw new ApplicationError(rows[0].exists ? "conflict" : "not-found");
    },
    async downloadDocument(id: number, documentId: number): Promise<Response> {
      const access = await accessFor(sessionHandle).check("Recruitment and Hiring");
      if (access.decision !== "allowed") throw new ApplicationError(access.decision);
      if (![id, documentId].every((value) => Number.isInteger(value) && value > 0 && value <= 2_147_483_647)) {
        throw new ApplicationError("validation");
      }
      // Resolve storage only for a snapshot member owned by the same Applicant.
      const { rows } = await db.query<SubmittedDocument & { fileId: string | null }>(`
        SELECT snapshot->>'name' AS name, (snapshot->>'size')::integer AS size,
          snapshot->>'contentType' AS "contentType", d.file_id AS "fileId"
        FROM public.applications a
        CROSS JOIN LATERAL jsonb_array_elements(a.documents_snapshot) snapshot
        JOIN public.applicant_documents d ON d.id = $2 AND d.applicant_id = a.applicant_id
        WHERE a.id = $1 AND snapshot->>'id' = $2::text`, [id, documentId]);
      const document = rows[0];
      if (!document) throw new ApplicationError("not-found");
      if (!document.fileId) {
        console.error("Application Document has no File", { id, documentId });
        throw new ApplicationError("not-found");
      }
      try {
        return new Response(null, { status: 307, headers: {
          Location: await files.viewUrl(document.fileId),
          "Cache-Control": "private, no-store",
        } });
      } catch {
        console.error("Application Document File unavailable", { id, documentId });
        throw new ApplicationError("not-found");
      }
    },
    async readProfile(id: number): Promise<ApplicationProfile> {
      const access = await accessFor(sessionHandle).check("Recruitment and Hiring");
      if (access.decision !== "allowed") throw new ApplicationError(access.decision);
      if (!validId(id)) throw new ApplicationError("validation");
      // Careers snapshots use phone/location. Older snapshots omit email and the
      // optional salary/availability fields; only email has a legacy identity fallback.
      const { rows } = await db.query<Omit<ApplicationProfile, "documents" | "notes" | "stageDates" | "activity" | "interviews"> & { interviews: (Omit<ApplicationInterview, "startsAt" | "endsAt"> & { startsAt: string; endsAt: string })[]; stage_dates: Partial<Record<ApplicationStage, string>>; activity: (Omit<ApplicationActivity, "occurredAt"> & { occurredAt: string })[]; documents_snapshot: SubmittedDocument[]; required_documents: string[] }>(`
        SELECT a.documents_snapshot, j.required_documents, a.id,
          COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', i.id, 'startsAt', i.starts_at, 'endsAt', i.ends_at, 'type', i.type,
            'interviewerName', i.interviewer_name, 'location', i.location, 'score', i.score, 'result', i.result
          ) ORDER BY i.starts_at DESC, i.id DESC) FROM public.hrms_application_interviews i
            WHERE i.application_id = a.id), '[]'::jsonb) AS interviews,
          jsonb_build_object('New', a.created_at) || COALESCE((
            SELECT jsonb_object_agg(h.stage, h.reached_at)
            FROM public.hrms_application_stage_history h WHERE h.application_id = a.id
          ), '{}'::jsonb) || COALESCE((
            SELECT jsonb_build_object('Interview', COALESCE(
              min(i.starts_at) FILTER (WHERE i.starts_at >= CURRENT_TIMESTAMP AND i.result IS NULL),
              max(i.starts_at)))
            FROM public.hrms_application_interviews i WHERE i.application_id = a.id
            HAVING count(*) > 0
          ), '{}'::jsonb) AS stage_dates,
          COALESCE((SELECT jsonb_agg(jsonb_build_object(
            'id', e.id, 'fromStage', e.from_stage, 'toStage', e.to_stage,
            'actorName', e.actor_name, 'reason', e.reason, 'occurredAt', e.occurred_at
          ) || CASE WHEN e.interview_id IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('interviewId', e.interview_id) END ORDER BY e.occurred_at DESC, e.id DESC)
            FROM public.hrms_application_activity e WHERE e.application_id = a.id), '[]'::jsonb) AS activity, a.full_name AS "applicantName",
          a.email AS "applicantEmail", a.mobile, a.address,
          a.expected_salary AS "expectedSalary", a.available_from AS "availableFrom",
          a.job_posting_id AS "jobPostingId", j.title AS "jobPostingTitle", j.location,
          a.created_at AS "appliedAt", a.stage, a.source, a.referred_by AS "referredBy"
        FROM (
          SELECT c.id, c.documents_snapshot, c.job_posting_id, c.created_at,
            CASE WHEN c.status = 'Received' THEN 'New' ELSE c.status END AS stage,
            c.profile_snapshot->>'fullName' AS full_name,
            COALESCE(c.profile_snapshot->>'email', p.email) AS email,
            c.profile_snapshot->>'phone' AS mobile,
            c.profile_snapshot->>'location' AS address,
            (c.profile_snapshot->>'expectedSalary')::double precision AS expected_salary,
            c.profile_snapshot->>'availableFrom' AS available_from,
            'Careers page'::text AS source, NULL::text AS referred_by
          FROM public.applications c
          LEFT JOIN public.applicant_profiles p ON p.applicant_id = c.applicant_id
          UNION ALL
          SELECT m.id, '[]'::jsonb, m.job_posting_id, m.applied_at, m.status, m.full_name, m.email,
            m.mobile, m.address, m.expected_salary, m.available_from::text,
            COALESCE(m.source, 'Unspecified'), m.referred_by
          FROM public.hrms_manual_applications m
        ) a
        JOIN public.job_postings j ON j.id = a.job_posting_id
        WHERE a.id = $1`, [id]);
      if (!rows[0]) throw new ApplicationError("not-found");
      const { documents_snapshot, required_documents, stage_dates, activity, interviews, ...profile } = rows[0];
      const { rows: notes } = await db.query<ApplicationNote>(`
        SELECT id, text, author_name AS "authorName", created_at AS "createdAt"
        FROM public.hrms_application_notes WHERE application_id = $1
        ORDER BY created_at DESC, id DESC`, [id]);
      const { rows: documentMetadata } = documents_snapshot.length ? await db.query<{ id: number; contentType: string; uploadedAt: string }>(`
        SELECT id, content_type AS "contentType", created_at AS "uploadedAt"
        FROM public.applicant_documents WHERE applicant_id = (
          SELECT applicant_id FROM public.applications WHERE id = $1
        ) AND id = ANY($2::integer[])`, [id, documents_snapshot.map((document) => document.id)]) : { rows: [] };
      return { ...profile, notes,
        interviews: interviews.map((item) => ({ ...item, startsAt: new Date(item.startsAt), endsAt: new Date(item.endsAt) })),
        stageDates: Object.fromEntries(Object.entries(stage_dates).map(([stage, date]) => [stage, new Date(date)])),
        activity: activity.map((entry) => ({ ...entry, occurredAt: new Date(entry.occurredAt) })),
        documents: [
        ...documents_snapshot.map((document): ApplicationDocument => {
          const metadata = documentMetadata.find((item) => item.id === document.id);
          return { ...document, contentType: metadata?.contentType ?? document.contentType,
            uploadedAt: metadata ? new Date(metadata.uploadedAt) : null, status: "Submitted",
            downloadUrl: `/api/applications/${id}/documents/${document.id}` };
        }),
        ...required_documents.filter((required) => !documents_snapshot.some((document) => document.requiredFor === required))
          .map((requiredFor): ApplicationDocument => ({ requiredFor, status: "Requested" })),
      ] };
    },
    list: (filters: ApplicationFilters & { page?: number } = {}) => read(filters),
    async exportCsv({ jobPostingId, stage, search }: ApplicationFilters = {}): Promise<string> {
      const { rows } = await read({ jobPostingId, stage, search }, false);
      const records = [
        ["name", "email", "Job Posting", "location", "Source", "applied date", "Stage", "Next step"],
        ...rows.map((row) => [row.applicantName, row.applicantEmail, row.jobPostingTitle,
          row.location, row.source, row.appliedAt.toISOString(), row.stage, row.nextStep]),
      ];
      return records.map((record) => record.map((value) => /[",\r\n]/.test(value)
        ? `"${value.replaceAll('"', '""')}"` : value).join(",")).join("\r\n") + "\r\n";
    },
  };
}
