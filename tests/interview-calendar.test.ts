import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applicationsFor } from "@/lib/applications";
import { manilaWeek } from "@/lib/dashboard";
import { interviewsSummary } from "@/lib/dashboard-data";
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
  portal.directory = [{ id: "bea", username: "bea", name: "Bea Santos", modules: ["Job Postings", "Applications", "Interviews", "Offers"] }];
  handle = portal.signIn(staff, ["Job Postings", "Applications", "Interviews", "Offers"]);
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

async function seed(index: number, status = "Interview", postingId = `posting-${index}`, name = `Applicant ${index}`) {
  await db.query(`INSERT INTO job_postings
    (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
    VALUES ($1,$2,'Retail','','','Full time','Manila','[]','[]','open') ON CONFLICT (id) DO NOTHING`, [postingId, `Job ${postingId}`]);
  await db.query(`INSERT INTO applicant_profiles VALUES ($1,'x',$2)`, [`person-${index}`, `person${index}@example.test`]);
  return (await db.query<{ id: number }>(`INSERT INTO applications
    (applicant_id,job_posting_id,reference_number,status,profile_snapshot,documents_snapshot,consented_at,created_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,'[]',now(),now()) RETURNING id`,
    [`person-${index}`, postingId, `REF-${index}`, status, JSON.stringify({ fullName: name })])).rows[0].id;
}
async function book(applicationId: number, startsAt: string, endsAt: string, interviewerId = "bea", type = "Online") {
  return (await db.query<{ id: number }>(`INSERT INTO hrms_application_interviews
    (application_id, starts_at, ends_at, type, interviewer_name, interviewer_id, location, meeting_link)
    VALUES ($1,$2,$3,$4,$5,$6,'','https://meet.example/x') RETURNING id`,
    [applicationId, startsAt, endsAt, type, interviewerId === "bea" ? "Bea Santos" : "Cy Reyes", interviewerId])).rows[0].id;
}
const RANGE = { from: "2099-01-05T00:00:00Z", to: "2099-01-12T00:00:00Z" };
const at = (day: number, hour: number) => new Date(Date.UTC(2099, 0, day, hour)).toISOString();

it("returns Interviews in the range with Interviewer, colour, type, Application and Job Posting", async () => {
  const id = await seed(1);
  const interviewId = await book(id, at(6, 2), at(6, 3), "bea", "In person");
  await book(await seed(2), at(20, 2), at(20, 3)); // outside the range
  const { interviews } = await applicationsFor(handle, db).calendar(RANGE);
  expect(interviews).toEqual([expect.objectContaining({
    id: interviewId, applicationId: id, applicantName: "Applicant 1", jobPostingId: "posting-1", jobPostingTitle: "Job posting-1",
    interviewerId: "bea", interviewerName: "Bea Santos", type: "In person", status: "Scheduled",
    startsAt: new Date(at(6, 2)), endsAt: new Date(at(6, 3)), colour: expect.stringMatching(/^#[0-9a-f]{6}$/) })]);
});

it("gives each Interviewer their stable colour", async () => {
  await book(await seed(1), at(6, 2), at(6, 3), "bea");
  await book(await seed(2), at(6, 4), at(6, 5), "cy");
  await book(await seed(3), at(7, 2), at(7, 3), "bea");
  const { interviews } = await applicationsFor(handle, db).calendar(RANGE);
  const colours = Object.fromEntries(interviews.map((i) => [i.applicantName, i.colour]));
  expect(colours["Applicant 1"]).toBe(colours["Applicant 3"]);
  expect(colours["Applicant 1"]).not.toBe(colours["Applicant 2"]);
});

it("filters by Interviewer and by Job Posting", async () => {
  await book(await seed(1, "Interview", "posting-a"), at(6, 2), at(6, 3), "bea");
  await book(await seed(2, "Interview", "posting-a"), at(6, 4), at(6, 5), "cy");
  await book(await seed(3, "Interview", "posting-b"), at(7, 2), at(7, 3), "bea");
  const applications = applicationsFor(handle, db);
  const names = async (filter: object) => (await applications.calendar({ ...RANGE, ...filter })).interviews.map((i) => i.applicantName);
  expect(await names({ interviewerId: "bea" })).toEqual(["Applicant 1", "Applicant 3"]);
  expect(await names({ jobPostingId: "posting-a" })).toEqual(["Applicant 1", "Applicant 2"]);
  expect(await names({ interviewerId: "bea", jobPostingId: "posting-b" })).toEqual(["Applicant 3"]);
});

it("includes finished Interviews marked Passed or Not passed", async () => {
  const passed = await seed(1, "Offer");
  const failed = await seed(2, "Rejected");
  const p = await book(passed, at(6, 2), at(6, 3));
  const f = await book(failed, at(6, 4), at(6, 5));
  await db.query("UPDATE hrms_application_interviews SET result = 'Passed', score = 4 WHERE id = $1", [p]);
  await db.query("UPDATE hrms_application_interviews SET result = 'Not passed', score = 1 WHERE id = $1", [f]);
  const { interviews } = await applicationsFor(handle, db).calendar(RANGE);
  expect(interviews.map((i) => [i.applicantName, i.status])).toEqual([["Applicant 1", "Passed"], ["Applicant 2", "Not passed"]]);
});

it("excludes Interviews whose Application left the Interview Stage without a result", async () => {
  await book(await seed(1, "Rejected"), at(6, 2), at(6, 3));
  await book(await seed(2, "Offer"), at(6, 4), at(6, 5));
  await book(await seed(3, "Interview"), at(6, 6), at(6, 7));
  const { interviews, conflicts } = await applicationsFor(handle, db).calendar(RANGE);
  expect(interviews.map((i) => i.applicantName)).toEqual(["Applicant 3"]);
  expect(conflicts).toEqual([]);
});

it("reports overlapping Interviews of one Interviewer with both applicants named", async () => {
  const a = await seed(1), b = await seed(2);
  await book(a, at(6, 2), at(6, 4));
  await book(b, at(6, 3), at(6, 5));
  const { conflicts } = await applicationsFor(handle, db).calendar(RANGE);
  expect(conflicts).toHaveLength(1);
  expect(conflicts[0]).toMatchObject({ interviewerId: "bea", interviewerName: "Bea Santos" });
  expect([conflicts[0].first.applicantName, conflicts[0].second.applicantName].sort()).toEqual(["Applicant 1", "Applicant 2"]);
});

it("allows back-to-back Interviews and different Interviewers at the same time", async () => {
  await book(await seed(1), at(6, 2), at(6, 3), "bea");
  await book(await seed(2), at(6, 3), at(6, 4), "bea");
  await book(await seed(3), at(6, 2), at(6, 4), "cy");
  expect((await applicationsFor(handle, db).calendar(RANGE)).conflicts).toEqual([]);
});

it("keeps a conflict visible when the Job Posting filter hides one side", async () => {
  await book(await seed(1, "Interview", "posting-a"), at(6, 2), at(6, 4));
  await book(await seed(2, "Interview", "posting-b"), at(6, 3), at(6, 5));
  const { interviews, conflicts } = await applicationsFor(handle, db).calendar({ ...RANGE, jobPostingId: "posting-a" });
  expect(interviews).toHaveLength(1);
  expect(conflicts).toHaveLength(1);
});

it("rejects an invalid range or filter and denies Staff without Interviews", async () => {
  const applications = applicationsFor(handle, db);
  await expect(applications.calendar({ from: "nope", to: RANGE.to })).rejects.toMatchObject({ reason: "validation" });
  await expect(applications.calendar({ from: RANGE.to, to: RANGE.from })).rejects.toMatchObject({ reason: "validation" });
  const other = portal.signIn({ ...staff, username: "zed" }, []);
  await expect(applicationsFor(other, db).calendar(RANGE)).rejects.toMatchObject({ reason: "denied" });
});

it("agrees with the Dashboard's Interviews this week", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2099-01-07T02:00:00Z")); // Wed 10:00 Manila; week Mon 5th to Sun 11th
    await book(await seed(1), at(6, 2), at(6, 3));
    await book(await seed(2, "Rejected"), at(6, 4), at(6, 5)); // dropped
    const done = await seed(3, "Offer");
    await db.query("UPDATE hrms_application_interviews SET result = 'Passed', score = 4 WHERE id = $1", [await book(done, at(7, 2), at(7, 3))]);
    await book(await seed(4), at(13, 2), at(13, 3)); // next week
    const applications = applicationsFor(handle, db);
    const { week } = manilaWeek(new Date());
    const calendar = await applications.calendar({ from: week.from.toISOString(), to: week.to.toISOString() });
    expect(calendar.interviews).toHaveLength(2);
    expect((await interviewsSummary(new Date(), db)).thisWeek).toBe(calendar.interviews.length);
    expect((await applications.interviewJobs()).totals.interviewsThisWeek).toBe(calendar.interviews.length);
  } finally { vi.useRealTimers(); }
});
