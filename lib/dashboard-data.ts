import { database, type Database } from "./database";
import { manilaWeek, type DashboardRange, type DashboardSummary } from "./dashboard";

/** Open Job Postings, read from the shared database: how many, their openings in total and their distinct locations. */
export async function openJobsSummary(db: Database = database): Promise<NonNullable<DashboardSummary["openJobs"]>> {
  const { rows } = await db.query<{ count: number; openings: number; locations: number }>(
    `SELECT count(*)::int AS count, coalesce(sum(openings), 0)::int AS openings, count(DISTINCT location)::int AS locations
     FROM public.job_postings WHERE status = 'open'`,
  );
  return rows[0];
}

/** Applications received (every one in the shared list, whatever its Stage) in the range and in its Previous period. */
export async function applicantsSummary(range: DashboardRange, db: Database = database): Promise<NonNullable<DashboardSummary["applicants"]>> {
  const { rows } = await db.query<{ current: number; previous: number }>(
    `SELECT count(*) FILTER (WHERE applied_at >= $1 AND applied_at < $2)::int AS current,
            count(*) FILTER (WHERE applied_at >= $3 AND applied_at < $4)::int AS previous
     FROM public.hrms_all_applications`,
    [range.from.toISOString(), range.to.toISOString(), range.previous.from.toISOString(), range.previous.to.toISOString()],
  );
  return rows[0];
}

/** Applications received in the range (counted as in applicantsSummary) per Job Posting, whatever its status: the total and the top five, ties by title. */
export async function applicantsByJobSummary(range: DashboardRange, db: Database = database): Promise<NonNullable<DashboardSummary["applicantsByJob"]>> {
  const params = [range.from.toISOString(), range.to.toISOString()];
  const [top, total] = await Promise.all([
    db.query<{ id: string; title: string; count: number }>(
      `SELECT job_posting_id AS id, min(job_posting_title) AS title, count(*)::int AS count
       FROM public.hrms_all_applications
       WHERE applied_at >= $1 AND applied_at < $2
       GROUP BY job_posting_id
       ORDER BY count DESC, min(job_posting_title), job_posting_id
       LIMIT 5`,
      params,
    ),
    db.query<{ total: number }>(`SELECT count(*)::int AS total FROM public.hrms_all_applications WHERE applied_at >= $1 AND applied_at < $2`, params),
  ]);
  return { total: total.rows[0].total, jobs: top.rows };
}

/**
 * Applications received in the range (counted as in applicantsSummary), and how many of them ever reached each later
 * Stage according to stage history, so one later Rejected still counts. "Applied" has no history row: it is every Application.
 */
export async function hiringPipelineSummary(range: DashboardRange, db: Database = database): Promise<NonNullable<DashboardSummary["hiringPipeline"]>> {
  const reached = (stage: string) =>
    `count(*) FILTER (WHERE EXISTS (SELECT 1 FROM public.hrms_application_stage_history h WHERE h.application_id = a.id AND h.stage = '${stage}'))::int`;
  const { rows } = await db.query<NonNullable<DashboardSummary["hiringPipeline"]>>(
    `SELECT count(*)::int AS applied,
            ${reached("Screening")} AS screening,
            ${reached("Interview")} AS interview,
            ${reached("Offer")} AS offer,
            ${reached("Hired")} AS hired
     FROM public.hrms_all_applications a
     WHERE a.applied_at >= $1 AND a.applied_at < $2`,
    [range.from.toISOString(), range.to.toISOString()],
  );
  return rows[0];
}

/**
 * Interviews starting this Manila week, finished ones included, and the ones starting today. The only place that
 * reads interviews for the Dashboard: change it when real interview data lands somewhere else.
 */
export async function interviewsSummary(now: Date, db: Database = database): Promise<NonNullable<DashboardSummary["interviews"]>> {
  const { week, today } = manilaWeek(now);
  const { rows } = await db.query<{ this_week: number; today: number }>(
    `SELECT count(*) FILTER (WHERE starts_at >= $1 AND starts_at < $2)::int AS this_week,
            count(*) FILTER (WHERE starts_at >= $3 AND starts_at < $4)::int AS today
     FROM public.hrms_application_interviews`,
    [week.from.toISOString(), week.to.toISOString(), today.from.toISOString(), today.to.toISOString()],
  );
  return { thisWeek: rows[0].this_week, today: rows[0].today };
}

/** Interviews still to start this Manila week (after now, before next Monday), with the applicant and Job Posting each belongs to. */
export async function upcomingInterviewsSummary(now: Date, db: Database = database): Promise<NonNullable<DashboardSummary["upcomingInterviews"]>> {
  const { week } = manilaWeek(now);
  const { rows } = await db.query<{ id: number; applicant_name: string; job_posting_title: string; type: "Online" | "In person"; starts_at: string }>(
    `SELECT i.id::int AS id, a.applicant_name, a.job_posting_title, i.type, i.starts_at
     FROM public.hrms_application_interviews i
     JOIN public.hrms_all_applications a ON a.id = i.application_id
     WHERE i.starts_at > $1 AND i.starts_at < $2
     ORDER BY i.starts_at, i.id`,
    [now.toISOString(), week.to.toISOString()],
  );
  return rows.map((r) => ({ id: r.id, applicantName: r.applicant_name, jobPostingTitle: r.job_posting_title, type: r.type, startsAt: new Date(r.starts_at).toISOString() }));
}

/**
 * Decided offers by decision date, in the range and in its Previous period. An Application that reached Offer is
 * decided once it reaches Hired (accepted) or Rejected (not accepted) at or after that; the first such Stage is
 * its decision. Offers still waiting are in neither number.
 */
export async function offersSummary(range: DashboardRange, db: Database = database): Promise<NonNullable<DashboardSummary["offers"]>> {
  const { rows } = await db.query<{ cur_accepted: number; cur_decided: number; prev_accepted: number; prev_decided: number }>(
    `WITH decisions AS (
       SELECT DISTINCT ON (o.application_id) h.stage = 'Hired' AS accepted, h.reached_at AS decided_at
       FROM public.hrms_application_stage_history o
       JOIN public.hrms_application_stage_history h
         ON h.application_id = o.application_id AND h.stage IN ('Hired', 'Rejected') AND h.reached_at >= o.reached_at
       WHERE o.stage = 'Offer'
       ORDER BY o.application_id, h.reached_at
     )
     SELECT count(*) FILTER (WHERE accepted AND decided_at >= $1 AND decided_at < $2)::int AS cur_accepted,
            count(*) FILTER (WHERE decided_at >= $1 AND decided_at < $2)::int AS cur_decided,
            count(*) FILTER (WHERE accepted AND decided_at >= $3 AND decided_at < $4)::int AS prev_accepted,
            count(*) FILTER (WHERE decided_at >= $3 AND decided_at < $4)::int AS prev_decided
     FROM decisions`,
    [range.from.toISOString(), range.to.toISOString(), range.previous.from.toISOString(), range.previous.to.toISOString()],
  );
  const r = rows[0];
  return {
    current: { accepted: r.cur_accepted, decided: r.cur_decided },
    previous: { accepted: r.prev_accepted, decided: r.prev_decided },
  };
}

/** Applications Hired in the range and in its Previous period, with the mean whole Manila days from applying to being Hired. */
export async function timeToHireSummary(range: DashboardRange, db: Database = database): Promise<NonNullable<DashboardSummary["timeToHire"]>> {
  const { rows } = await db.query<{ cur_hires: number; cur_days: number | null; prev_hires: number; prev_days: number | null }>(
    `WITH hires AS (
       SELECT h.reached_at,
              greatest((h.reached_at AT TIME ZONE 'Asia/Manila')::date - (a.applied_at AT TIME ZONE 'Asia/Manila')::date, 0) AS days
       FROM public.hrms_application_stage_history h
       JOIN public.hrms_all_applications a ON a.id = h.application_id
       WHERE h.stage = 'Hired'
     )
     SELECT count(*) FILTER (WHERE reached_at >= $1 AND reached_at < $2)::int AS cur_hires,
            (avg(days) FILTER (WHERE reached_at >= $1 AND reached_at < $2))::float8 AS cur_days,
            count(*) FILTER (WHERE reached_at >= $3 AND reached_at < $4)::int AS prev_hires,
            (avg(days) FILTER (WHERE reached_at >= $3 AND reached_at < $4))::float8 AS prev_days
     FROM hires`,
    [range.from.toISOString(), range.to.toISOString(), range.previous.from.toISOString(), range.previous.to.toISOString()],
  );
  const r = rows[0];
  return {
    current: { hires: r.cur_hires, averageDays: r.cur_days },
    previous: { hires: r.prev_hires, averageDays: r.prev_days },
  };
}

/** The summary data for the Modules a Staff member holds; a Module they do not hold is never read. */
export async function dashboardSummaryFor(
  permittedPages: readonly string[],
  range: DashboardRange,
  now: Date = new Date(),
  db: Database = database,
): Promise<DashboardSummary> {
  if (!permittedPages.includes("/job-postings")) return {};
  const [openJobs, applicants, hiringPipeline, applicantsByJob, interviews, upcomingInterviews, offers, timeToHire] = await Promise.all([
    openJobsSummary(db),
    applicantsSummary(range, db),
    hiringPipelineSummary(range, db),
    applicantsByJobSummary(range, db),
    interviewsSummary(now, db),
    upcomingInterviewsSummary(now, db),
    offersSummary(range, db),
    timeToHireSummary(range, db),
  ]);
  return { openJobs, applicants, hiringPipeline, applicantsByJob, interviews, upcomingInterviews, offers, timeToHire };
}
