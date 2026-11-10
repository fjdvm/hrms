import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { applicationsFor } from "@/lib/applications";
import { jobPostingsFor } from "@/lib/job-postings";
import { deliverStaffNotifications } from "@/lib/staff-notifications";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
let sends: { body: Record<string, unknown> & { userIds: string[] }; key: string | null }[];
let gatewayDown = false;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY, email text, "emailVerified" boolean);`);
  portal = new FakePortal();
  portal.directory = [
    { id: "hr-1", username: "ada", modules: ["Recruitment and Hiring", "Dashboard"] },
    { id: "hr-2", username: "bo", modules: ["Recruitment and Hiring"] },
    { id: "pay-1", username: "cy", modules: ["Payroll & ESS"] },
  ];
  handle = portal.signIn({ name: "Ada", username: "ada", email: "ada@example.test", role: "HR Officer" }, ["Recruitment and Hiring"]);
  const boundary = portalFetch(portal);
  sends = [];
  gatewayDown = false;
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "hrms-key");
  vi.stubEnv("NOTIFICATIONS_APP", "HRMS");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).startsWith("https://gateway.test")) return boundary(input, init);
    if (gatewayDown) return Response.json({}, { status: 503 });
    if (!String(input).endsWith("/notifications/notifications")) return Response.json({}, { status: 201 });
    sends.push({ body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get("idempotency-key") });
    return Response.json({}, { status: 202 });
  });
});
afterEach(async () => { await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function insertPosting(status = "open", keepQueue = false) {
  await db.query(`INSERT INTO job_postings (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status,deadline)
    VALUES ('p1','Cashier','Retail','d','r','Full time','Manila','[]','[]',$1,'2031-01-01')`, [status]);
  if (!keepQueue) await db.query("DELETE FROM hrms_staff_notifications"); // seeding is not the event under test
}
async function careersApplication() {
  await db.query(`INSERT INTO applicant_profiles VALUES ('person-1','Live name','p1@example.test')`);
  return (await db.query<{ id: number }>(`INSERT INTO applications (applicant_id,job_posting_id,reference_number,status,profile_snapshot,documents_snapshot,consented_at,created_at)
    VALUES ('person-1','p1','REF-1','Received','{"fullName":"Kristine Aquino"}','[]',now(),now()) RETURNING id`)).rows[0].id;
}

it("notifies every Recruitment and Hiring user, and only them, when a Careers application arrives", async () => {
  await insertPosting();
  const id = await careersApplication();
  await deliverStaffNotifications(db);
  expect(sends).toHaveLength(1);
  expect(sends[0].body).toMatchObject({
    sendingApp: "HRMS", targetApp: "HRMS", type: "application.received", link: `/applicants/${id}`,
    title: "New application: Kristine Aquino", idempotencyKey: `application.received:${id}`,
  });
  expect([...sends[0].body.userIds].sort()).toEqual(["hr-1", "hr-2"]);
});

it("notifies when HR adds an applicant by hand", async () => {
  await insertPosting();
  await applicationsFor(handle, db).addApplicant({ fullName: "Walk In", email: "w@example.test", mobile: "09", address: "Manila", jobPostingId: "p1", expectedSalary: 1, availableFrom: "2031-02-01", source: "Walk-in" });
  await deliverStaffNotifications(db);
  expect(sends.map((s) => s.body.type)).toEqual(["application.received"]);
  expect(sends[0].body.title).toBe("New application: Walk In");
});

it("notifies when a posting is published and when it is closed, once each", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({ title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire", deadline: new Date("2031-01-01") });
  await postings.publish(draft.id);
  await postings.close(draft.id);
  await deliverStaffNotifications(db);
  await deliverStaffNotifications(db);
  expect(sends.map((s) => s.body.type).sort()).toEqual(["job-posting.closed", "job-posting.published"]);
  expect(sends.find((s) => s.body.type === "job-posting.closed")?.body.title).toBe("Job posting closed: Recruiter");
});

it("notifies when a posting is created already open", async () => {
  await insertPosting("open", true);
  await deliverStaffNotifications(db);
  expect(sends.map((s) => s.body.type)).toEqual(["job-posting.published"]);
});

it("never fails the application insert when the notification cannot be built", async () => {
  await insertPosting();
  await db.query("DROP TABLE hrms_staff_notifications CASCADE");
  await expect(careersApplication()).resolves.toBeTypeOf("number");
});

it("does not notify for drafts or for edits that keep the status", async () => {
  await insertPosting("draft");
  await db.query(`UPDATE job_postings SET title = 'Renamed', status = 'draft'`);
  await deliverStaffNotifications(db);
  expect(sends).toHaveLength(0);
});

it("keeps the notification and retries when the gateway is down, without duplicates", async () => {
  await insertPosting();
  await careersApplication();
  gatewayDown = true;
  await deliverStaffNotifications(db);
  expect(sends).toHaveLength(0);
  await db.query(`UPDATE hrms_staff_notifications SET next_attempt_at = now() - interval '1 second'`);
  gatewayDown = false;
  await deliverStaffNotifications(db);
  await deliverStaffNotifications(db);
  expect(sends).toHaveLength(1);
});

it("keeps the notification when the Portal cannot list recipients", async () => {
  await insertPosting();
  await careersApplication();
  portal.unavailable = true;
  await deliverStaffNotifications(db);
  expect(sends).toHaveLength(0);
  portal.unavailable = false;
  await db.query(`UPDATE hrms_staff_notifications SET next_attempt_at = now() - interval '1 second'`);
  await deliverStaffNotifications(db);
  expect(sends).toHaveLength(1);
});

it("retires a notification nobody is entitled to see", async () => {
  await insertPosting();
  await careersApplication();
  portal.directory = [];
  await deliverStaffNotifications(db);
  expect(sends).toHaveLength(0);
  expect((await db.query(`SELECT 1 FROM hrms_staff_notifications WHERE delivered_at IS NULL`)).rows).toHaveLength(0);
});
