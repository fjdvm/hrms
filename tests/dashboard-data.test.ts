import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it } from "vitest";
import { dashboardRange } from "@/lib/dashboard";
import { applicantSourcesSummary, applicantsByJobSummary, applicantsSummary, dashboardSummaryFor, hiringPipelineSummary, interviewsSummary, needsAttentionSummary, offersSummary, openJobsSummary, timeToHireSummary, upcomingInterviewsSummary } from "@/lib/dashboard-data";

const NOW = new Date("2026-10-28T12:05:00Z");
const RANGE = dashboardRange("this-month", NOW);

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec("CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)");
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  await db.exec('CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);');
});

afterEach(() => db.close());

async function post(id: string, status: string, location: string, openings: number | null) {
  await db.query(
    `INSERT INTO job_postings (id, title, department, description, requirements, employment_type, location, deadline, required_documents, screening_criteria, status, openings)
     VALUES ($1, $1, 'People', 'd', 'r', 'Full-time', $2, '2030-01-01T00:00:00Z', '[]', '[]', $3, $4)`,
    [id, location, status, openings],
  );
}

it("counts only Open Job Postings, with their openings and distinct locations", async () => {
  await post("a", "open", "Antipolo", 2);
  await post("b", "open", "Antipolo", 5);
  await post("c", "open", "Cainta", 1);
  await post("d", "draft", "Manila", 9);
  await post("e", "closed", "Manila", 9);
  await post("f", "filled", "Pasig", 9);
  expect(await openJobsSummary(db)).toEqual({ count: 3, openings: 8, locations: 2 });
});

it("adds no openings for a posting that does not say how many", async () => {
  await post("a", "open", "Antipolo", null);
  await post("b", "open", "Cainta", 4);
  expect(await openJobsSummary(db)).toEqual({ count: 2, openings: 4, locations: 2 });
});

it("is all zero when no Job Posting is Open", async () => {
  await post("a", "draft", "Antipolo", 3);
  expect(await openJobsSummary(db)).toEqual({ count: 0, openings: 0, locations: 0 });
});

it("fills the summary with Open jobs for Staff who hold Recruitment and Hiring", async () => {
  await post("a", "open", "Antipolo", 2);
  expect(await dashboardSummaryFor(["/dashboard", "/job-postings"], RANGE, NOW, db)).toEqual({
    openJobs: { count: 1, openings: 2, locations: 1 },
    applicants: { current: 0, previous: 0 },
    hiringPipeline: { applied: 0, screening: 0, interview: 0, offer: 0, hired: 0 },
    needsAttention: { toReview: { count: 0, oldestAppliedAt: null }, toSchedule: { count: 0, topJob: null }, resultsToRecord: 0 },
    applicantSources: [],
    applicantsByJob: { total: 0, jobs: [] },
    interviews: { thisWeek: 0, today: 0 },
    upcomingInterviews: [],
    offers: { current: { accepted: 0, decided: 0 }, previous: { accepted: 0, decided: 0 } },
    timeToHire: { current: { hires: 0, averageDays: null }, previous: { hires: 0, averageDays: null } },
  });
});

it("does not read the database for Staff who do not hold Recruitment and Hiring", async () => {
  const unreachable = { query: () => Promise.reject(new Error("must not be queried")) };
  expect(await dashboardSummaryFor(["/dashboard", "/attendance"], RANGE, NOW, unreachable)).toEqual({});
});

let received = 0;
async function receive(appliedAt: string, status = "Received", job = "a"): Promise<number> {
  received += 1;
  await db.query("INSERT INTO applicant_profiles VALUES ($1, 'Someone', $2)", [`p${received}`, `p${received}@example.test`]);
  await db.query(
    `INSERT INTO applications (applicant_id, job_posting_id, reference_number, status, profile_snapshot, documents_snapshot, consented_at, created_at)
     VALUES ($1, $4, $1, $2, '{"fullName":"Someone"}', '[]', $3, $3)`,
    [`p${received}`, status, appliedAt, job],
  );
  return (await db.query<{ id: number }>("SELECT max(id)::int AS id FROM applications")).rows[0].id;
}

async function addByHr(appliedAt: string) {
  received += 1;
  await db.query(
    `INSERT INTO hrms_manual_applications (full_name, email, mobile, address, job_posting_id, expected_salary, available_from, added_by_name, applied_at)
     VALUES ('Walk-in', $1, '0917', 'Antipolo', 'a', 1000, '2026-11-01', 'Ada', $2)`,
    [`w${received}@example.test`, appliedAt],
  );
}

it("counts Applications received in the range and in the Previous period, on Manila days", async () => {
  await post("a", "open", "Antipolo", 1);
  await receive("2026-09-30T16:00:00Z"); // 1 Oct 00:00 Manila: first moment of the range
  await receive("2026-10-28T15:59:00Z"); // 28 Oct 23:59 Manila: last moment
  await receive("2026-10-28T16:00:00Z"); // 29 Oct Manila: after the range
  await receive("2026-09-28T15:59:00Z"); // 28 Sep 23:59 Manila: last moment of the Previous period
  await receive("2026-08-31T16:00:00Z"); // 1 Sep 00:00 Manila: first moment of the Previous period
  await receive("2026-08-31T15:59:00Z"); // 31 Aug Manila: before it
  await receive("2026-09-28T16:00:00Z"); // 29 Sep Manila: past the Previous period's 28 Sep end
  expect(await applicantsSummary(RANGE, db)).toEqual({ current: 2, previous: 2 });
});

it("counts HR-added, rejected and withdrawn Applications too", async () => {
  await post("a", "open", "Antipolo", 1);
  await receive("2026-10-05T08:00:00Z");
  await receive("2026-10-06T08:00:00Z", "Rejected");
  await receive("2026-10-07T08:00:00Z", "Withdrawn");
  await addByHr("2026-10-08T08:00:00Z");
  expect(await applicantsSummary(RANGE, db)).toEqual({ current: 4, previous: 0 });
});

/** An Application received at `appliedAt` that reached the given Stages at the given times. */
async function moved(appliedAt: string, history: [stage: string, at: string][], status = "Received") {
  const id = await receive(appliedAt, status);
  for (const [stage, at] of history) {
    await db.query("INSERT INTO hrms_application_stage_history (application_id, stage, reached_at) VALUES ($1, $2, $3)", [id, stage, at]);
  }
  return id;
}

async function interview(startsAt: string) {
  const id = await receive("2026-10-01T00:00:00Z", "Interview");
  await db.query(
    `INSERT INTO hrms_application_interviews (application_id, starts_at, ends_at, type, interviewer_name, location)
     VALUES ($1, $2, ($2::timestamptz + interval '1 hour'), 'Online', 'Ada', 'Zoom')`,
    [id, startsAt],
  );
}

it("counts this Manila week's interviews, finished ones included, and today's", async () => {
  await post("a", "open", "Antipolo", 1);
  await interview("2026-10-25T15:59:00Z"); // Sun 25 Oct 23:59 Manila: last week
  await interview("2026-10-25T16:00:00Z"); // Mon 26 Oct 00:00 Manila: first moment of the week
  await interview("2026-10-27T16:00:00Z"); // Wed 28 Oct 00:00 Manila: today
  await interview("2026-10-28T03:00:00Z"); // Wed 28 Oct 11:00 Manila: today, already finished
  await interview("2026-10-28T15:59:00Z"); // Wed 28 Oct 23:59 Manila: today
  await interview("2026-11-01T15:59:00Z"); // Sun 1 Nov 23:59 Manila: last moment of the week
  await interview("2026-11-01T16:00:00Z"); // Mon 2 Nov 00:00 Manila: next week
  expect(await interviewsSummary(NOW, db)).toEqual({ thisWeek: 5, today: 3 });
});

it("counts no interviews when none is stored", async () => {
  expect(await interviewsSummary(NOW, db)).toEqual({ thisWeek: 0, today: 0 });
});

it("counts decided offers by decision date: accepted when Hired, not accepted when Rejected after Offer", async () => {
  await post("a", "open", "Antipolo", 1);
  await moved("2026-09-01T00:00:00Z", [["Offer", "2026-10-02T00:00:00Z"], ["Hired", "2026-10-10T00:00:00Z"]]); // accepted
  await moved("2026-09-01T00:00:00Z", [["Offer", "2026-10-02T00:00:00Z"], ["Hired", "2026-10-11T00:00:00Z"]]); // accepted
  await moved("2026-09-01T00:00:00Z", [["Offer", "2026-10-03T00:00:00Z"], ["Rejected", "2026-10-12T00:00:00Z"]], "Rejected"); // not accepted
  await moved("2026-09-01T00:00:00Z", [["Offer", "2026-10-03T00:00:00Z"]]); // still waiting: in neither number
  await moved("2026-09-01T00:00:00Z", [["Interview", "2026-10-03T00:00:00Z"], ["Rejected", "2026-10-12T00:00:00Z"]], "Rejected"); // never reached Offer
  await moved("2026-08-01T00:00:00Z", [["Offer", "2026-09-02T00:00:00Z"], ["Hired", "2026-09-10T00:00:00Z"]]); // Previous period
  expect(await offersSummary(RANGE, db)).toEqual({
    current: { accepted: 2, decided: 3 },
    previous: { accepted: 1, decided: 1 },
  });
});

it("dates a decided offer by when it was decided, not when it was made", async () => {
  await post("a", "open", "Antipolo", 1);
  await moved("2026-09-01T00:00:00Z", [["Offer", "2026-09-28T00:00:00Z"], ["Hired", "2026-10-05T00:00:00Z"]]); // offered in Sep, hired in Oct
  expect(await offersSummary(RANGE, db)).toEqual({
    current: { accepted: 1, decided: 1 },
    previous: { accepted: 0, decided: 0 },
  });
});

it("averages whole Manila days from applying to being Hired, in the range and in the Previous period", async () => {
  await post("a", "open", "Antipolo", 1);
  await moved("2026-10-01T00:00:00Z", [["Hired", "2026-10-11T00:00:00Z"]]); // 10 days
  await moved("2026-09-20T00:00:00Z", [["Hired", "2026-10-15T00:00:00Z"]]); // 25 days
  await moved("2026-09-20T00:00:00Z", [["Offer", "2026-10-02T00:00:00Z"]]); // not hired
  await moved("2026-08-01T00:00:00Z", [["Hired", "2026-09-12T00:00:00Z"]]); // Previous period, 42 days
  await moved("2026-09-01T00:00:00Z", [["Hired", "2026-11-20T00:00:00Z"]]); // after the range
  expect(await timeToHireSummary(RANGE, db)).toEqual({
    current: { hires: 2, averageDays: 17.5 },
    previous: { hires: 1, averageDays: 42 },
  });
});

it("counts the days between Manila dates, not between instants", async () => {
  await post("a", "open", "Antipolo", 1);
  // Applied 1 Oct 23:00 Manila, hired 2 Oct 01:00 Manila: two hours apart, one calendar day.
  await moved("2026-10-01T15:00:00Z", [["Hired", "2026-10-01T17:00:00Z"]]);
  expect((await timeToHireSummary(RANGE, db)).current).toEqual({ hires: 1, averageDays: 1 });
});

it("has no average when nobody was Hired", async () => {
  expect(await timeToHireSummary(RANGE, db)).toEqual({
    current: { hires: 0, averageDays: null },
    previous: { hires: 0, averageDays: null },
  });
});

it("reads interviews still to start this Manila week, with applicant and Job Posting, soonest first", async () => {
  await post("a", "open", "Antipolo", 1);
  await interview("2026-10-28T12:05:00Z"); // exactly now: already started
  await interview("2026-11-01T15:59:00Z"); // Sun 1 Nov 23:59 Manila: last moment of the week
  await interview("2026-10-28T13:00:00Z"); // later today
  await interview("2026-11-01T16:00:00Z"); // next Monday: not this week
  await interview("2026-10-28T03:00:00Z"); // finished
  const rows = await upcomingInterviewsSummary(NOW, db);
  expect(rows.map((r) => r.startsAt)).toEqual(["2026-10-28T13:00:00.000Z", "2026-11-01T15:59:00.000Z"]);
  expect(rows[0]).toMatchObject({ type: "Online", applicantName: expect.any(String), jobPostingTitle: expect.any(String) });
});

it("reads no upcoming interviews when none is stored", async () => {
  expect(await upcomingInterviewsSummary(NOW, db)).toEqual([]);
});

it("ranks the top five Job Postings by Applications in the range, closed and filled ones included, with the total of all", async () => {
  for (const [id, status] of [["a", "open"], ["b", "closed"], ["c", "filled"], ["d", "open"], ["e", "open"], ["f", "open"]]) await post(id, status, "Antipolo", 1);
  for (const [job, n] of [["b", 3], ["a", 2], ["c", 2], ["d", 1], ["e", 1], ["f", 1]] as const) {
    for (let i = 0; i < n; i++) await receive("2026-10-10T08:00:00Z", "Received", job);
  }
  const { total, jobs } = await applicantsByJobSummary(RANGE, db);
  expect(total).toBe(10);
  expect(jobs.map((j) => [j.id, j.count])).toEqual([["b", 3], ["a", 2], ["c", 2], ["d", 1], ["e", 1]]); // ties by title
});

it("counts only the range, on Manila days, not the Previous period", async () => {
  await post("a", "open", "Antipolo", 1);
  await receive("2026-09-30T16:00:00Z"); // 1 Oct 00:00 Manila: in
  await receive("2026-10-28T15:59:00Z"); // 28 Oct 23:59 Manila: in
  await receive("2026-10-28T16:00:00Z"); // after
  await receive("2026-09-30T15:59:00Z"); // Previous period
  expect(await applicantsByJobSummary(RANGE, db)).toEqual({ total: 2, jobs: [{ id: "a", title: "a", count: 2 }] });
});

it("reads no jobs when no Application was received", async () => {
  expect(await applicantsByJobSummary(RANGE, db)).toEqual({ total: 0, jobs: [] });
});

it("counts Applications in the range that ever reached each Stage, even if later Rejected", async () => {
  await post("a", "open", "Antipolo", 1);
  await moved("2026-10-05T08:00:00Z", [["Screening", "2026-10-06T08:00:00Z"], ["Interview", "2026-10-08T08:00:00Z"], ["Offer", "2026-10-10T08:00:00Z"], ["Hired", "2026-10-12T08:00:00Z"]]);
  await moved("2026-10-06T08:00:00Z", [["Screening", "2026-10-07T08:00:00Z"], ["Interview", "2026-10-09T08:00:00Z"], ["Rejected", "2026-10-11T08:00:00Z"]], "Rejected");
  await moved("2026-10-07T08:00:00Z", []);
  expect(await hiringPipelineSummary(RANGE, db)).toEqual({ applied: 3, screening: 2, interview: 2, offer: 1, hired: 1 });
});

it("reads Applied as the Applicants card does, and leaves out Applications outside the range", async () => {
  await post("a", "open", "Antipolo", 1);
  await moved("2026-10-05T08:00:00Z", [["Screening", "2026-10-06T08:00:00Z"]]);
  await moved("2026-09-30T15:59:00Z", [["Screening", "2026-10-02T08:00:00Z"]]); // Previous period
  await moved("2026-10-28T16:00:00Z", [["Screening", "2026-10-29T08:00:00Z"]]); // after
  await receive("2026-10-08T08:00:00Z", "Withdrawn");
  await addByHr("2026-10-09T08:00:00Z");
  const pipeline = await hiringPipelineSummary(RANGE, db);
  expect(pipeline.applied).toBe((await applicantsSummary(RANGE, db)).current);
  expect(pipeline).toEqual({ applied: 3, screening: 1, interview: 0, offer: 0, hired: 0 });
});

it("reads an empty pipeline when no Application was received", async () => {
  expect(await hiringPipelineSummary(RANGE, db)).toEqual({ applied: 0, screening: 0, interview: 0, offer: 0, hired: 0 });
});

/** An Interview for an existing Application, ending an hour after it starts. */
async function bookInterview(applicationId: number, startsAt: string, result: "Passed" | "Not passed" | null = null) {
  await db.query(
    `INSERT INTO hrms_application_interviews (application_id, starts_at, ends_at, type, interviewer_name, location, score, result)
     VALUES ($1, $2, ($2::timestamptz + interval '1 hour'), 'Online', 'Ada', 'Zoom', $3, $4)`,
    [applicationId, startsAt, result ? 4 : null, result],
  );
}

it("counts Applications at New to review, with when the oldest was received, whatever the range", async () => {
  await post("a", "open", "Antipolo", 1);
  await receive("2026-08-02T08:00:00Z"); // far outside the range: still waiting
  await receive("2026-10-20T08:00:00Z");
  await receive("2026-10-21T08:00:00Z", "Screening");
  await receive("2026-10-22T08:00:00Z", "Withdrawn");
  expect((await needsAttentionSummary(NOW, db)).toReview).toEqual({ count: 2, oldestAppliedAt: "2026-08-02T08:00:00.000Z" });
});

it("counts Applications at Interview with no Interview booked, and names the Job Posting with the most", async () => {
  await post("a", "open", "Antipolo", 1);
  await post("b", "closed", "Antipolo", 1);
  await receive("2026-10-01T08:00:00Z", "Interview", "a");
  await receive("2026-10-02T08:00:00Z", "Interview", "b");
  await receive("2026-10-03T08:00:00Z", "Interview", "b");
  const booked = await receive("2026-10-04T08:00:00Z", "Interview", "a");
  await bookInterview(booked, "2026-11-20T08:00:00Z");
  await receive("2026-10-05T08:00:00Z", "Screening", "a");
  expect((await needsAttentionSummary(NOW, db)).toSchedule).toEqual({ count: 3, topJob: { title: "b", count: 2 } });
});

it("breaks a tie for the most waiting by Job Posting title", async () => {
  await post("a", "open", "Antipolo", 1);
  await post("b", "open", "Antipolo", 1);
  await receive("2026-10-01T08:00:00Z", "Interview", "b");
  await receive("2026-10-02T08:00:00Z", "Interview", "a");
  expect((await needsAttentionSummary(NOW, db)).toSchedule.topJob).toEqual({ title: "a", count: 1 });
});

it("counts Interviews that ended with no result, not the ones still to come or already decided", async () => {
  await post("a", "open", "Antipolo", 1);
  await bookInterview(await receive("2026-10-01T08:00:00Z", "Interview"), "2026-10-20T08:00:00Z"); // ended, no result
  await bookInterview(await receive("2026-10-01T08:00:00Z", "Interview"), "2026-10-21T08:00:00Z", "Passed"); // decided
  await bookInterview(await receive("2026-10-01T08:00:00Z", "Interview"), "2026-10-28T11:05:00Z"); // ends 12:05 = NOW: ended
  await bookInterview(await receive("2026-10-01T08:00:00Z", "Interview"), "2026-10-28T11:06:00Z"); // ends after NOW
  await bookInterview(await receive("2026-10-01T08:00:00Z", "Interview"), "2026-11-02T08:00:00Z"); // still to come
  expect((await needsAttentionSummary(NOW, db)).resultsToRecord).toBe(2);
});

it("reads nothing to act on when nothing is waiting", async () => {
  expect(await needsAttentionSummary(NOW, db)).toEqual({ toReview: { count: 0, oldestAppliedAt: null }, toSchedule: { count: 0, topJob: null }, resultsToRecord: 0 });
});

async function addFrom(appliedAt: string, source: string | null, referredBy: string | null = null): Promise<number> {
  received += 1;
  await db.query(
    `INSERT INTO hrms_manual_applications (full_name, email, mobile, address, job_posting_id, expected_salary, available_from, added_by_name, applied_at, source, referred_by)
     VALUES ('Someone', $1, '0917', 'Antipolo', 'a', 1000, '2026-11-01', 'Ada', $2, $3, $4)`,
    [`s${received}@example.test`, appliedAt, source, referredBy],
  );
  return (await db.query<{ id: number }>("SELECT min(id)::int AS id FROM hrms_manual_applications")).rows[0].id;
}

it("counts Applications in the range per Source, with those that ever reached Hired", async () => {
  await post("a", "open", "Antipolo", 1);
  await receive("2026-10-05T08:00:00Z"); // Careers page
  const hired = await receive("2026-10-06T08:00:00Z"); // Careers page, hired
  await db.query("INSERT INTO hrms_application_stage_history (application_id, stage, reached_at) VALUES ($1, 'Hired', $2)", [hired, "2026-10-20T08:00:00Z"]);
  await addFrom("2026-10-07T08:00:00Z", "Facebook");
  await addFrom("2026-10-08T08:00:00Z", "Referral", "Paolo");
  await addFrom("2026-10-09T08:00:00Z", null); // before Sources were recorded
  const rows = await applicantSourcesSummary(RANGE, db);
  expect([...rows].sort((a, b) => a.source.localeCompare(b.source))).toEqual([
    { source: "Careers page", count: 2, hired: 1 },
    { source: "Facebook", count: 1, hired: 0 },
    { source: "Referral", count: 1, hired: 0 },
    { source: "Unspecified", count: 1, hired: 0 },
  ]);
});

it("counts Sources only for Applications received in the range, on Manila days", async () => {
  await post("a", "open", "Antipolo", 1);
  await addFrom("2026-09-30T16:00:00Z", "Walk-in"); // 1 Oct 00:00 Manila: in
  await addFrom("2026-10-28T15:59:00Z", "Walk-in"); // 28 Oct 23:59 Manila: in
  await addFrom("2026-10-28T16:00:00Z", "Walk-in"); // after
  await addFrom("2026-09-30T15:59:00Z", "Walk-in"); // before
  expect(await applicantSourcesSummary(RANGE, db)).toEqual([{ source: "Walk-in", count: 2, hired: 0 }]);
});

it("reads no Sources when no Application was received", async () => {
  expect(await applicantSourcesSummary(RANGE, db)).toEqual([]);
});
