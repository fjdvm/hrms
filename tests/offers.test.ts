import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OfferError, offersFor, type OfferTerms } from "@/lib/offers";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const staff = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const terms: OfferTerms = { monthlySalary: 19000, startDate: "2099-11-03", employmentType: "Full-time", schedule: "Mon-Sat, 6 AM-2 PM", probation: "6 months", reportsTo: "Paolo Garcia" };
const names = async (): Promise<string[] | null> => ["Paolo Garcia", "Liza Bautista"];
const offers = (sessionHandle: string | undefined = handle, staffNames = names) => offersFor(sessionHandle, db, staffNames);

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

async function seed(index: number, status = "Offer") {
  await db.query(`INSERT INTO job_postings
    (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
    VALUES ($1,'Cashier','Retail','','','Full time','Cainta branch','[]','[]','open')`, [`posting-${index}`]);
  await db.query(`INSERT INTO applicant_profiles VALUES ($1,'Live profile name',$2)`, [`person-${index}`, `person${index}@example.test`]);
  return (await db.query<{ id: number }>(`INSERT INTO applications
    (applicant_id,job_posting_id,reference_number,status,profile_snapshot,documents_snapshot,consented_at)
    VALUES ($1,$2,$3,$4,$5::jsonb,'[]',now()) RETURNING id`,
    [`person-${index}`, `posting-${index}`, `REF-${index}`, status, JSON.stringify({ fullName: `Applicant ${index}` })])).rows[0].id;
}

it("refuses every operation without the Recruitment and Hiring Module", async () => {
  const other = portal.signIn(staff, ["Attendance"]);
  const id = await seed(1);
  await expect(offers(other).list()).rejects.toMatchObject({ reason: "denied" });
  await expect(offers(other).create(id, terms)).rejects.toMatchObject({ reason: "denied" });
  await expect(offers("unknown-handle").candidates()).rejects.toBeInstanceOf(OfferError);
  portal.unavailable = true;
  await expect(offers().list()).rejects.toMatchObject({ reason: "unavailable" });
});

it("offers only Applications at Offer with no Offer yet in the New offer picker", async () => {
  const atOffer = await seed(1);
  await seed(2, "Interview");
  const taken = await seed(3);
  await seed(4, "Withdrawn");
  await offers().create(taken, terms);
  expect(await offers().candidates()).toEqual([
    { applicationId: atOffer, applicantName: "Applicant 1", applicantEmail: "person1@example.test", role: "Cashier", branch: "Cainta branch" },
  ]);
});

it("saves a Draft with every term and the branch from the Job Posting", async () => {
  const applicationId = await seed(1);
  const id = await offers().create(applicationId, { ...terms, schedule: "  Mon-Sat  ", reportsTo: " Paolo Garcia " });
  expect(await offers().read(id)).toEqual({
    id, applicationId, applicantName: "Applicant 1", applicantEmail: "person1@example.test", role: "Cashier",
    branch: "Cainta branch", status: "Draft", ...terms, schedule: "Mon-Sat",
  });
  expect(await offers().candidates()).toEqual([]);
});

it("refuses a Draft for an Application not at Offer, with an Offer already, or unknown", async () => {
  const early = await seed(1, "Interview");
  const ready = await seed(2);
  await expect(offers().create(early, terms)).rejects.toMatchObject({ reason: "conflict" });
  await offers().create(ready, terms);
  await expect(offers().create(ready, terms)).rejects.toMatchObject({ reason: "conflict" });
  await expect(offers().create(9999, terms)).rejects.toMatchObject({ reason: "not-found" });
});

it("rejects terms outside the fixed lists, a past start date and an empty schedule", async () => {
  const id = await seed(1);
  for (const bad of [
    { monthlySalary: 0 }, { monthlySalary: 1.5 }, { startDate: "2020-01-01" }, { startDate: "2099-02-30" },
    { employmentType: "Intern" }, { probation: "1 month" }, { schedule: "  " }, { reportsTo: "" },
  ]) {
    await expect(offers().create(id, { ...terms, ...bad } as OfferTerms)).rejects.toMatchObject({ reason: "validation" });
  }
  expect((await offers().list()).counts.All).toBe(0);
});

it("lists the Staff names for the Reports to picker and fails when the Portal cannot answer", async () => {
  expect(await offers().staff()).toEqual(["Paolo Garcia", "Liza Bautista"]);
  await expect(offers(handle, async () => null).staff()).rejects.toMatchObject({ reason: "unavailable" });
});

it("edits a Draft and keeps the branch and the Application", async () => {
  const id = await offers().create(await seed(1), terms);
  await offers().update(id, { ...terms, monthlySalary: 21000, probation: "None" });
  expect(await offers().read(id)).toMatchObject({ monthlySalary: 21000, probation: "None", branch: "Cainta branch" });
  await expect(offers().update(id, { ...terms, monthlySalary: -1 })).rejects.toMatchObject({ reason: "validation" });
  await expect(offers().update(9999, terms)).rejects.toMatchObject({ reason: "not-found" });
});

it("deletes a Draft and returns its Application to the picker", async () => {
  const applicationId = await seed(1);
  const id = await offers().create(applicationId, terms);
  await offers().delete(id);
  expect((await offers().list()).counts.All).toBe(0);
  expect((await offers().candidates()).map((item) => item.applicationId)).toEqual([applicationId]);
  await expect(offers().delete(id)).rejects.toMatchObject({ reason: "not-found" });
});

it("locks terms once sent: a sent Offer can be neither edited nor deleted", async () => {
  const id = await offers().create(await seed(1), terms);
  await db.query(`UPDATE hrms_offers SET status = 'Sent', sent_at = now(), reply_by = '2099-10-01'`);
  await expect(offers().update(id, terms)).rejects.toMatchObject({ reason: "conflict" });
  await expect(offers().delete(id)).rejects.toMatchObject({ reason: "conflict" });
});

it("counts tabs that match the list and keeps Withdrawn Offers under Withdrawn only", async () => {
  const draft = await offers().create(await seed(1), terms);
  const sent = await offers().create(await seed(2), terms);
  const accepted = await offers().create(await seed(3), terms);
  const declined = await offers().create(await seed(4), terms);
  const withdrawn = await offers().create(await seed(5), terms);
  await db.query(`UPDATE hrms_offers SET status = 'Sent', sent_at = now(), reply_by = '2099-10-01' WHERE id = $1`, [sent]);
  await db.query(`UPDATE hrms_offers SET status = 'Accepted' WHERE id = $1`, [accepted]);
  await db.query(`UPDATE hrms_offers SET status = 'Declined' WHERE id = $1`, [declined]);
  await db.query(`UPDATE hrms_offers SET status = 'Sent' WHERE id = $1`, [withdrawn]);
  await db.query(`UPDATE applications SET status = 'Withdrawn' WHERE applicant_id = 'person-5'`);

  const all = await offers().list();
  expect(all.counts).toEqual({ All: 4, Draft: 1, Sent: 1, Accepted: 1, Declined: 1, Withdrawn: 1 });
  expect(all.waiting).toBe(1);
  expect(all.rows.map((row) => row.id).sort()).toEqual([draft, sent, accepted, declined].sort());
  for (const tab of ["Draft", "Sent", "Accepted", "Declined", "Withdrawn"] as const) {
    expect((await offers().list(tab)).rows).toHaveLength(1);
  }
  expect((await offers().list("Withdrawn")).rows[0]).toMatchObject({ id: withdrawn, status: "Withdrawn" });
  await expect(offers().list("Bogus" as never)).rejects.toMatchObject({ reason: "validation" });
});

it("shows applicant, role, salary, start date and the sent dates on each row", async () => {
  const id = await offers().create(await seed(1), terms);
  expect((await offers().list()).rows).toEqual([{
    id, applicationId: expect.any(Number), applicantName: "Applicant 1", applicantEmail: "person1@example.test", role: "Cashier",
    monthlySalary: 19000, startDate: "2099-11-03", sentAt: null, replyBy: null, status: "Draft",
  }]);
});

it("blocks editing and deleting a Draft whose Application withdrew", async () => {
  const id = await offers().create(await seed(1), terms);
  await db.query(`UPDATE applications SET status = 'Withdrawn'`);
  await expect(offers().update(id, terms)).rejects.toMatchObject({ reason: "conflict" });
  await expect(offers().delete(id)).rejects.toMatchObject({ reason: "conflict" });
});
