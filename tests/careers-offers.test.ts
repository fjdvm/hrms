import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST as documents } from "@/app/api/careers/offers/[id]/documents/route";
import { POST as reply } from "@/app/api/careers/offers/[id]/reply/route";
import { database } from "@/lib/database";
import { careersOffersFor } from "@/lib/careers-offers";
import { DOCUMENT_TYPES } from "@/lib/offer-documents";
import { offersFor, type OfferTerms } from "@/lib/offers";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: vi.fn() }));

let db: PGlite;
let portal: FakePortal;
const staff = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const terms: OfferTerms = { monthlySalary: 19000, startDate: "2099-11-03", employmentType: "Full-time", schedule: "Mon-Sat, 6 AM-2 PM", probation: "6 months", reportsTo: "Paolo Garcia" };
const KEY = "careers-key";
const careers = () => careersOffersFor(db);

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
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("CAREERS_CALLER_KEY", KEY);
  vi.spyOn(database, "query").mockImplementation((sql, values) => db.query(sql, values));
});

afterEach(async () => {
  if (!db.closed) await db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function seed(index: number) {
  await db.query(`INSERT INTO job_postings
    (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
    VALUES ($1,'Cashier','Retail','','','Full time','Cainta branch','[]','[]','open')`, [`posting-${index}`]);
  await db.query(`INSERT INTO applicant_profiles VALUES ($1,'Live profile name',$2)`, [`person-${index}`, `person${index}@example.test`]);
  return (await db.query<{ id: number }>(`INSERT INTO applications
    (applicant_id,job_posting_id,reference_number,status,profile_snapshot,documents_snapshot,consented_at)
    VALUES ($1,$2,$3,'Offer',$4::jsonb,'[]',now()) RETURNING id`,
    [`person-${index}`, `posting-${index}`, `REF-${index}`, JSON.stringify({ fullName: `Applicant ${index}` })])).rows[0].id;
}
/** A Sent Offer for `person-<index>`. */
async function sentOffer(index = 1) {
  const handle = portal.signIn(staff, ["Job Postings", "Applications", "Interviews", "Offers"]);
  const applicationId = await seed(index);
  const id = await offersFor(handle, db, async () => ["Paolo Garcia"]).create(applicationId, terms);
  await offersFor(handle, db, async () => ["Paolo Garcia"]).send(id, "2099-10-29");
  await db.query(`UPDATE hrms_offers SET sent_at = now() - interval '2 days' WHERE id = $1`, [id]);
  return { id, applicationId, applicantId: `person-${index}` };
}
const notices = async () => (await db.query<{ id: string; payload: { type: string; title: string; link: string } }>(
  `SELECT id, payload FROM hrms_staff_notifications WHERE id LIKE 'offer.%' ORDER BY id`)).rows;
const stageOf = async (applicationId: number) => (await db.query<{ stage: string }>(`SELECT stage FROM hrms_all_applications WHERE id = $1`, [applicationId])).rows[0].stage;
const upload = (type = "nbi", fileId = "file-1") => ({ type: type as never, fileId, fileName: `${type}.pdf` });

it("accepts for the Applicant: Stage stays Offer, the email goes out at once and Staff are told", async () => {
  const { id, applicationId, applicantId } = await sentOffer();
  await careers().reply(id, applicantId, "Accepted");
  expect(await stageOf(applicationId)).toBe("Offer");
  expect((await db.query<{ status: string; replied: boolean }>(`SELECT status, replied_at IS NOT NULL AS replied FROM hrms_offers WHERE id = $1`, [id])).rows[0]).toEqual({ status: "Accepted", replied: true });
  expect((await db.query<{ due: boolean }>(`SELECT next_attempt_at <= clock_timestamp() AS due FROM hrms_offer_emails WHERE id = $1`, [`offer.accepted:${id}`])).rows).toEqual([{ due: true }]);
  expect(await notices()).toEqual([{ id: `offer.accepted:${id}`, payload: expect.objectContaining({ type: "offer.accepted", title: "Offer accepted: Applicant 1", link: `/offers/${id}` }) }]);
});

it("declines for the Applicant: the Application moves to Rejected with its history and Staff are told", async () => {
  const { id, applicationId, applicantId } = await sentOffer();
  await careers().reply(id, applicantId, "Declined");
  expect(await stageOf(applicationId)).toBe("Rejected");
  expect((await db.query(`SELECT 1 FROM hrms_application_stage_history WHERE application_id = $1 AND stage = 'Rejected'`, [applicationId])).rows).toHaveLength(1);
  expect((await notices()).map((notice) => notice.payload.type)).toEqual(["offer.declined"]);
});

it("keeps replies final and refuses Draft and Withdrawn Offers with a reason", async () => {
  const { id, applicantId } = await sentOffer(1);
  await careers().reply(id, applicantId, "Declined");
  for (const answer of ["Declined", "Accepted"]) {
    await expect(careers().reply(id, applicantId, answer)).rejects.toMatchObject({ reason: "conflict", detail: "already-answered" });
  }
  const second = await sentOffer(2);
  await db.query(`UPDATE applications SET status = 'Withdrawn' WHERE applicant_id = 'person-2'`);
  await expect(careers().reply(second.id, second.applicantId, "Accepted")).rejects.toMatchObject({ reason: "conflict", detail: "withdrawn" });
  const handle = portal.signIn(staff, ["Job Postings", "Applications", "Interviews", "Offers"]);
  const draft = await offersFor(handle, db, async () => ["Paolo Garcia"]).create(await seed(3), terms);
  await expect(careers().reply(draft, "person-3", "Accepted")).rejects.toMatchObject({ reason: "conflict", detail: "draft" });
  expect((await db.query(`SELECT 1 FROM hrms_offer_emails WHERE id LIKE 'offer.accepted:%' OR id LIKE 'offer.declined:%'`)).rows).toHaveLength(1);
});

it("never lets one Applicant answer or upload for another's Offer, and rejects bad input", async () => {
  const { id } = await sentOffer(1);
  await seed(2);
  await expect(careers().reply(id, "person-2", "Accepted")).rejects.toMatchObject({ reason: "not-found" });
  await expect(careers().uploadDocument(id, "person-2", upload())).rejects.toMatchObject({ reason: "not-found" });
  await expect(careers().reply(id, "person-1", "Maybe")).rejects.toMatchObject({ reason: "validation" });
  await expect(careers().reply(id, "", "Accepted")).rejects.toMatchObject({ reason: "validation" });
  await expect(careers().reply(9999, "person-1", "Accepted")).rejects.toMatchObject({ reason: "not-found" });
  for (const bad of [upload("passport"), { ...upload(), fileId: "" }, { ...upload(), fileName: " " }, { ...upload(), fileId: "x".repeat(201) }]) {
    await expect(careers().uploadDocument(id, "person-1", bad)).rejects.toMatchObject({ reason: "validation" });
  }
  expect((await db.query(`SELECT 1 FROM hrms_offers WHERE status <> 'Sent'`)).rows).toHaveLength(0);
});

it("records an upload as Submitted, replaces the earlier file and tells Staff", async () => {
  const { id, applicantId } = await sentOffer();
  const handle = portal.signIn(staff, ["Job Postings", "Applications", "Interviews", "Offers"]);
  await offersFor(handle, db).requestDocuments(id, { types: ["nbi", "sss"], dueDate: "2099-11-30" });
  expect(await careers().uploadDocument(id, applicantId, upload("nbi", "file-1"))).toEqual({ submitted: 1, total: 7 });
  await careers().uploadDocument(id, applicantId, upload("nbi", "file-2"));
  const { rows } = await db.query<{ status: string; fileId: string; dueDate: string }>(`SELECT status, file_id AS "fileId", due_date::text AS "dueDate" FROM hrms_offer_documents WHERE offer_id = $1 AND document_type = 'nbi'`, [id]);
  expect(rows).toEqual([{ status: "Submitted", fileId: "file-2", dueDate: "2099-11-30" }]);
  expect((await notices()).filter((notice) => notice.payload.type === "offer.document")).toHaveLength(2);
  expect(await careers().uploadDocument(id, applicantId, upload("nbi", "file-2"))).toMatchObject({ submitted: 1 });
  expect((await notices()).filter((notice) => notice.payload.type === "offer.document")).toHaveLength(2);
});

it("makes the notification for the 7th document on an Accepted Offer say Ready to hire, once", async () => {
  const { id, applicantId } = await sentOffer();
  await careers().reply(id, applicantId, "Accepted");
  for (const type of DOCUMENT_TYPES.slice(0, 6)) await careers().uploadDocument(id, applicantId, upload(type, `file-${type}`));
  expect((await notices()).some((notice) => notice.payload.type === "offer.ready")).toBe(false);
  await careers().uploadDocument(id, applicantId, upload(DOCUMENT_TYPES[6], "file-last"));
  const ready = (await notices()).filter((notice) => notice.payload.type === "offer.ready");
  expect(ready).toEqual([expect.objectContaining({ payload: expect.objectContaining({ title: "Ready to hire: Applicant 1", link: `/offers/${id}` }) })]);
  expect((await notices()).filter((notice) => notice.payload.type === "offer.document")).toHaveLength(6);
  await careers().uploadDocument(id, applicantId, upload(DOCUMENT_TYPES[6], "file-replacement"));
  expect((await notices()).filter((notice) => notice.payload.type === "offer.ready")).toHaveLength(1);
});

it("does not say Ready to hire for the 7th document while the Offer is only Sent", async () => {
  const { id, applicantId } = await sentOffer();
  for (const type of DOCUMENT_TYPES) await careers().uploadDocument(id, applicantId, upload(type, `file-${type}`));
  expect((await notices()).some((notice) => notice.payload.type === "offer.ready")).toBe(false);
  expect((await notices()).filter((notice) => notice.payload.type === "offer.document")).toHaveLength(7);
});

it("needs only the document type and file id", async () => {
  const { id, applicantId } = await sentOffer();
  expect(await careers().uploadDocument(id, applicantId, { type: "nbi", fileId: "file-1" })).toEqual({ submitted: 1, total: 7 });
  await expect(careers().uploadDocument(id, applicantId, { type: "sss", fileId: "file-2", fileName: " " })).rejects.toMatchObject({ reason: "validation" });
});

it("refuses uploads on a Declined, Withdrawn or Draft Offer", async () => {
  const declined = await sentOffer(1);
  await careers().reply(declined.id, declined.applicantId, "Declined");
  await expect(careers().uploadDocument(declined.id, declined.applicantId, upload())).rejects.toMatchObject({ reason: "conflict", detail: "declined" });
  const withdrawn = await sentOffer(2);
  await db.query(`UPDATE applications SET status = 'Withdrawn' WHERE applicant_id = 'person-2'`);
  await expect(careers().uploadDocument(withdrawn.id, withdrawn.applicantId, upload())).rejects.toMatchObject({ reason: "conflict", detail: "withdrawn" });
  const handle = portal.signIn(staff, ["Job Postings", "Applications", "Interviews", "Offers"]);
  const draft = await offersFor(handle, db, async () => ["Paolo Garcia"]).create(await seed(3), terms);
  await expect(careers().uploadDocument(draft, "person-3", upload())).rejects.toMatchObject({ reason: "conflict", detail: "draft" });
  expect((await db.query(`SELECT 1 FROM hrms_offer_documents`)).rows).toHaveLength(0);
});

const call = (handler: typeof reply, id: number | string, body: unknown, authorization: string | null = `Bearer ${KEY}`) =>
  handler(new Request("http://hrms.test/api/careers/offers/1/reply", {
    method: "POST", headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }), { params: Promise.resolve({ id: String(id) }) });

it("requires the Careers caller key on both routes, and fails closed when none is configured", async () => {
  const { id, applicantId } = await sentOffer();
  for (const handler of [reply, documents]) {
    for (const authorization of [null, "Bearer wrong", "Basic abc", `Bearer ${KEY}x`]) {
      expect((await call(handler, id, { applicantId, answer: "Accepted" }, authorization)).status).toBe(401);
    }
  }
  vi.stubEnv("CAREERS_CALLER_KEY", "");
  expect((await call(reply, id, { applicantId, answer: "Accepted" }, "Bearer ")).status).toBe(401);
  expect((await call(reply, id, { applicantId, answer: "Accepted" }, "Bearer undefined")).status).toBe(401);
  expect((await db.query(`SELECT 1 FROM hrms_offers WHERE status = 'Sent'`)).rows).toHaveLength(1);
});

it("maps outcomes to clear errors", async () => {
  const { id, applicantId } = await sentOffer();
  expect((await call(reply, id, "not json")).status).toBe(400);
  expect((await call(reply, id, { applicantId, answer: "Maybe" })).status).toBe(400);
  expect((await call(reply, 9999, { applicantId, answer: "Accepted" })).status).toBe(404);
  expect((await call(reply, id, { applicantId, answer: "Accepted" })).status).toBe(200);
  const again = await call(reply, id, { applicantId, answer: "Declined" });
  expect(again.status).toBe(409);
  expect(await again.json()).toEqual({ error: "already-answered", message: "This offer has already been answered. A reply is final." });
  const saved = await call(documents, id, { applicantId, type: "nbi", fileId: "file-1" });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ ok: true, submitted: 1, total: 7 });
  expect((await call(documents, id, { applicantId, type: "nope", fileId: "f", fileName: "n" })).status).toBe(400);
});

it("answers 503 when the database is unavailable", async () => {
  const { id, applicantId } = await sentOffer();
  vi.spyOn(database, "query").mockRejectedValue(new Error("down"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await call(reply, id, { applicantId, answer: "Accepted" })).status).toBe(503);
});
