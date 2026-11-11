import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applicationsFor } from "@/lib/applications";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const staff = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  portal = new FakePortal();
  portal.directory = [{ id: "bea", username: "bea", name: "Bea Santos", modules: ["Recruitment and Hiring"] }];
  handle = portal.signIn(staff, ["Recruitment and Hiring"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});

afterEach(async () => {
  if (!db.closed) await db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function seed(index: number, status = "Received", postingStatus = "open", appliedAt = "2026-10-01T08:00:00Z") {
  await db.query(`INSERT INTO job_postings
    (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
    VALUES ($1,'Cashier','Retail','','','Full time','Manila','[]','[]',$2)`, [`posting-${index}`, postingStatus]);
  await db.query(`INSERT INTO applicant_profiles VALUES ($1,'Live profile name',$2)`, [`person-${index}`, `person${index}@example.test`]);
  return (await db.query<{ id: number }>(`INSERT INTO applications
    (applicant_id,job_posting_id,reference_number,status,profile_snapshot,documents_snapshot,consented_at,created_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,'[]',$6,$6) RETURNING id`,
    [`person-${index}`, `posting-${index}`, `REF-${index}`, status, JSON.stringify({ fullName: `Applicant ${index}` }), appliedAt])).rows[0].id;
}


async function book(applicationId: number, startsAt: string, endsAt: string, name = "Bea Santos", type = "Online") {
  return (await db.query<{ id: number }>(`INSERT INTO hrms_application_interviews
    (application_id, starts_at, ends_at, type, interviewer_name, interviewer_id, location)
    VALUES ($1,$2,$3,$4,$5,'bea','') RETURNING id`, [applicationId, startsAt, endsAt, type, name])).rows[0].id;
}

async function addToPosting1(name: string, n: number) {
  await db.query(`INSERT INTO applicant_profiles VALUES ($1,'x',$2)`, [`extra-${n}`, `extra${n}@example.test`]);
  return (await db.query<{ id: number }>(`INSERT INTO applications
    (applicant_id,job_posting_id,reference_number,status,profile_snapshot,documents_snapshot,consented_at,created_at)
    VALUES ($1,'posting-1',$2,'Interview',$3::jsonb,'[]',now(),now()) RETURNING id`, [`extra-${n}`, `REF-E${n}`, JSON.stringify({ fullName: name })])).rows[0].id;
}
const FUTURE = (days: number, hour = 2) => new Date(Date.UTC(2099, 0, 1 + days, hour)).toISOString();

it("lists a job while any Application is in the Interview Stage, whatever the posting status, labelled when not Open", async () => {
  await seed(1, "Interview", "open");
  await seed(2, "Interview", "closed");
  await seed(3, "Interview", "filled");
  await seed(4, "Screening", "open");
  await seed(5, "Offer", "open");
  const { jobs } = await applicationsFor(handle, db).interviewJobs();
  expect(jobs.map(({ jobPostingId, label }) => [jobPostingId, label])).toEqual([
    ["posting-1", null], ["posting-2", "Closed"], ["posting-3", "Filled"]]);
});

it("drops a job when its last Application leaves the Interview Stage", async () => {
  const id = await seed(1, "Interview");
  expect((await applicationsFor(handle, db).interviewJobs()).jobs).toHaveLength(1);
  await db.query("UPDATE applications SET status = 'Rejected' WHERE id = $1", [id]);
  expect((await applicationsFor(handle, db).interviewJobs()).jobs).toEqual([]);
});

it("counts To schedule and Scheduled per job and reports the next upcoming Interview", async () => {
  const a = await seed(1, "Interview");
  const unbooked = await seed(2, "Interview");
  // Two more Applications on posting-1.
  const extra = await addToPosting1("Second Applicant", 1);
  await book(a, FUTURE(5), FUTURE(5, 3));
  await book(extra, FUTURE(2), FUTURE(2, 3));
  const { jobs } = await applicationsFor(handle, db).interviewJobs();
  const job1 = jobs.find((job) => job.jobPostingId === "posting-1")!;
  expect(job1).toMatchObject({ title: "Cashier", toSchedule: 0, scheduled: 2,
    nextInterview: { applicantName: "Second Applicant", startsAt: new Date(FUTURE(2)), interviewerName: "Bea Santos" } });
  expect(jobs.find((job) => job.jobPostingId === "posting-2")).toMatchObject({ toSchedule: 1, scheduled: 0, nextInterview: null });
  expect(unbooked).toBeGreaterThan(0);
});

it("ignores past and result-recorded Interviews for the next Interview", async () => {
  const id = await seed(1, "Interview");
  await book(id, "2020-01-01T01:00:00Z", "2020-01-01T02:00:00Z");
  expect((await applicationsFor(handle, db).interviewJobs()).jobs[0]).toMatchObject({ scheduled: 1, nextInterview: null });
});

it("totals jobs, Interviews this week and Interviews today in Manila time", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    // Wed 2026-11-11 10:00 Manila; week is Mon 9th to Sun 15th.
    vi.setSystemTime(new Date("2026-11-11T02:00:00Z"));
    const ids = [await seed(1, "Interview"), await seed(2, "Interview"), await seed(3, "Interview"), await seed(4, "Interview"), await seed(5, "Interview")];
    await book(ids[0], "2026-11-11T07:00:00Z", "2026-11-11T08:00:00Z"); // today 15:00 Manila
    await book(ids[1], "2026-11-13T01:00:00Z", "2026-11-13T02:00:00Z"); // Fri, this week
    await book(ids[2], "2026-11-16T01:00:00Z", "2026-11-16T02:00:00Z"); // next week
    await book(ids[3], "2026-11-10T16:30:00Z", "2026-11-10T17:30:00Z"); // 00:30 Manila on the 11th: today
    // Finished Interviews still count, matching the Dashboard.
    const done = await seed(6, "Offer");
    const doneId = await book(done, "2026-11-10T01:00:00Z", "2026-11-10T02:00:00Z");
    await db.query("UPDATE hrms_application_interviews SET result = 'Passed', score = 4 WHERE id = $1", [doneId]);
    expect((await applicationsFor(handle, db).interviewJobs()).totals).toEqual({ jobs: 5, interviewsThisWeek: 4, interviewsToday: 2 });
  } finally { vi.useRealTimers(); }
});

it("lists a job's Interview Stage Applications by tab and counts every tab", async () => {
  const booked = await seed(1, "Interview");
  const second = await addToPosting1("Unbooked", 2);
  await seed(3, "Screening");
  const interviewId = await book(booked, FUTURE(1), FUTURE(1, 3), "Bea Santos", "In person");
  const applications = applicationsFor(handle, db);
  const all = await applications.interviewJob("posting-1", "All");
  expect(all.counts).toEqual({ All: 2, "To schedule": 1, Scheduled: 1 });
  expect(all.job).toMatchObject({ jobPostingId: "posting-1", title: "Cashier", label: null });
  expect(all.rows.map((row) => row.applicantName).sort()).toEqual(["Applicant 1", "Unbooked"]);
  expect((await applications.interviewJob("posting-1", "To schedule")).rows).toMatchObject([{ id: second, interview: null }]);
  expect((await applications.interviewJob("posting-1", "Scheduled")).rows).toMatchObject([{ id: booked, applicantEmail: "person1@example.test",
    interview: { id: interviewId, startsAt: new Date(FUTURE(1)), endsAt: new Date(FUTURE(1, 3)), type: "In person", interviewerName: "Bea Santos" } }]);
});

it("removes an Application from the list once a result is recorded or it leaves the Stage", async () => {
  const id = await seed(1, "Interview");
  const interviewId = await book(id, "2020-01-01T01:00:00Z", "2020-01-01T02:00:00Z");
  const applications = applicationsFor(handle, db);
  await applications.recordInterviewResult(id, interviewId, { result: "Passed", score: 4 });
  await expect(applications.interviewJob("posting-1", "All")).rejects.toMatchObject({ reason: "not-found" });
  expect((await applications.interviewJobs()).jobs).toEqual([]);
});

it("keeps a Closed job's Applications listable and labelled", async () => {
  await seed(1, "Interview", "closed");
  expect((await applicationsFor(handle, db).interviewJob("posting-1", "All")).job.label).toBe("Closed");
});

it("rejects unknown tabs and reports not-found for a job with no Interview Stage Applications", async () => {
  await seed(1, "Screening");
  const applications = applicationsFor(handle, db);
  await expect(applications.interviewJob("posting-1", "Passed" as never)).rejects.toMatchObject({ reason: "validation" });
  await expect(applications.interviewJob("posting-1", "All")).rejects.toMatchObject({ reason: "not-found" });
});

it("denies Staff without Recruitment and Hiring", async () => {
  const other = portal.signIn({ ...staff, username: "x", email: "x@example.test" }, []);
  await expect(applicationsFor(other, db).interviewJobs()).rejects.toMatchObject({ reason: "denied" });
  await expect(applicationsFor(other, db).interviewJob("posting-1", "All")).rejects.toMatchObject({ reason: "denied" });
});
