import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { deliverOfferEmails } from "@/lib/offer-emails";
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

it("refuses every operation without the Offers Module", async () => {
  const other = portal.signIn(staff, ["Training"]);
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

it("sends a Draft with a reply-by date: Sent, sent date recorded, terms locked", async () => {
  const id = await offers().create(await seed(1), terms);
  await offers().send(id, "2099-10-29");
  const [row] = (await offers().list("Sent")).rows;
  expect(row).toMatchObject({ id, status: "Sent", replyBy: "2099-10-29", sentAt: expect.any(Date) });
  expect((await offers().list()).waiting).toBe(1);
  await expect(offers().update(id, terms)).rejects.toMatchObject({ reason: "conflict" });
  await expect(offers().delete(id)).rejects.toMatchObject({ reason: "conflict" });
  await expect(offers().send(id, "2099-10-30")).rejects.toMatchObject({ reason: "conflict" });
});

it("requires a real reply-by date that is not in the past to send", async () => {
  const id = await offers().create(await seed(1), terms);
  for (const bad of ["", "2020-01-01", "2099-02-30", "soon"]) {
    await expect(offers().send(id, bad)).rejects.toMatchObject({ reason: "validation" });
  }
  await expect(offers().send(9999, "2099-10-29")).rejects.toMatchObject({ reason: "not-found" });
  expect((await offers().read(id)).status).toBe("Draft");
});

it("queues one offer email to the Applicant carrying every term", async () => {
  const id = await offers().create(await seed(1), terms);
  await offers().send(id, "2099-10-29");
  const { rows } = await db.query<{ payload: { to: string; body: string } }>(`SELECT payload FROM hrms_offer_emails WHERE offer_id = $1`, [id]);
  expect(rows).toHaveLength(1);
  expect(rows[0].payload.to).toBe("person1@example.test");
  for (const text of ["19,000", "3 Nov 2099", "Full-time", "Mon-Sat, 6 AM-2 PM", "6 months", "Paolo Garcia", "29 Oct 2099", "Cainta branch"]) {
    expect(rows[0].payload.body).toContain(text);
  }
});

it("sends the queued email through the gateway with retries, and records it in the activity", async () => {
  const id = await offers().create(await seed(1), terms);
  await offers().send(id, "2099-10-29");
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "key");
  const calls: { url: string; key: string | null }[] = [];
  let fail = true;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, key: new Headers(init.headers).get("idempotency-key") });
    return new Response("{}", { status: fail ? 503 : 200 });
  });
  await deliverOfferEmails(db);
  const sentLogged = async () => (await db.query(`SELECT 1 FROM hrms_offer_activity WHERE kind = 'email-sent'`)).rows.length;
  expect(await sentLogged()).toBe(0);
  await db.query(`UPDATE hrms_offer_emails SET next_attempt_at = now()`);
  fail = false;
  await deliverOfferEmails(db);
  await deliverOfferEmails(db);
  expect(calls.map((call) => call.url)).toEqual(Array(2).fill("https://gateway.test/notifications/emails/app"));
  expect(calls[0].key).toBe(`offer.sent:${id}`);
  expect(await sentLogged()).toBe(1);
});

it("extends the reply-by date only forward, only for a Sent offer", async () => {
  const id = await offers().create(await seed(1), terms);
  await expect(offers().extendReplyBy(id, "2099-11-05")).rejects.toMatchObject({ reason: "conflict" });
  await offers().send(id, "2099-10-29");
  await expect(offers().extendReplyBy(id, "2099-10-29")).rejects.toMatchObject({ reason: "validation" });
  await expect(offers().extendReplyBy(id, "2099-10-20")).rejects.toMatchObject({ reason: "validation" });
  await offers().extendReplyBy(id, "2099-11-05");
  expect((await offers().detail(id)).replyBy).toBe("2099-11-05");
  expect((await offers().detail(id)).activity.map((entry) => entry.kind)).toContain("reply-by-extended");
  await db.query(`UPDATE applications SET status = 'Withdrawn'`);
  await expect(offers().extendReplyBy(id, "2099-12-01")).rejects.toMatchObject({ reason: "conflict" });
  await expect(offers().send(id, "2099-12-01")).rejects.toMatchObject({ reason: "conflict" });
});

it("does not send when the Application withdrew or left Offer", async () => {
  const id = await offers().create(await seed(1), terms);
  await db.query(`UPDATE applications SET status = 'Withdrawn'`);
  await expect(offers().send(id, "2099-10-29")).rejects.toMatchObject({ reason: "conflict" });
  expect((await db.query(`SELECT 1 FROM hrms_offer_emails`)).rows).toHaveLength(0);
});

it("shows the stage tracker dates and activity on the offer page data", async () => {
  const id = await offers().create(await seed(1), terms);
  await offers().send(id, "2099-10-29");
  const detail = await offers().detail(id);
  expect(detail).toMatchObject({ status: "Sent", stage: "Offer", replyBy: "2099-10-29", sentAt: expect.any(Date), reportsTo: "Paolo Garcia" });
  expect(detail.stageDates.New).toBeInstanceOf(Date);
  expect(detail.activity.map((entry) => entry.kind)).toContain("sent");
  expect(detail.activity.find((entry) => entry.kind === "sent")?.actorName).toBe("Ada Okafor");
});

it("refuses send, extend and detail without the Module", async () => {
  const other = portal.signIn(staff, ["Training"]);
  await expect(offers(other).send(1, "2099-10-29")).rejects.toMatchObject({ reason: "denied" });
  await expect(offers(other).extendReplyBy(1, "2099-10-29")).rejects.toMatchObject({ reason: "denied" });
  await expect(offers(other).detail(1)).rejects.toMatchObject({ reason: "denied" });
});

async function sentForReply(index = 1) {
  const applicationId = await seed(index);
  const id = await offers().create(applicationId, terms);
  await offers().send(id, "2099-10-29");
  await db.query(`UPDATE hrms_offers SET sent_at = now() - interval '2 days' WHERE id = $1`, [id]);
  return { id, applicationId };
}
const justNow = () => new Date(Date.now() - 1000).toISOString();
const stageOf = async (applicationId: number) => (await db.query<{ stage: string }>(`SELECT stage FROM hrms_all_applications WHERE id = $1`, [applicationId])).rows[0].stage;

it("records an acceptance with its reply time, leaves the Stage at Offer and queues the confirmation", async () => {
  const { id, applicationId } = await sentForReply();
  const repliedAt = new Date(Date.now() - 3600_000).toISOString();
  await offers().recordReply(id, { answer: "Accepted", repliedAt, sendAt: null });
  const detail = await offers().detail(id);
  expect(detail).toMatchObject({ status: "Accepted", stage: "Offer", repliedAt: new Date(repliedAt) });
  expect(await stageOf(applicationId)).toBe("Offer");
  expect(detail.activity.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["accepted", "email-scheduled"]));
  const { rows } = await db.query<{ id: string; payload: { to: string } }>(`SELECT id, payload FROM hrms_offer_emails WHERE id LIKE 'offer.accepted:%'`);
  expect(rows).toHaveLength(1);
  expect(rows[0].payload.to).toBe("person1@example.test");
});

it("records a decline: the Application moves to Rejected with stage history and a thank-you email", async () => {
  const { id, applicationId } = await sentForReply();
  await offers().recordReply(id, { answer: "Declined", repliedAt: justNow(), sendAt: null });
  expect(await stageOf(applicationId)).toBe("Rejected");
  expect((await offers().detail(id)).status).toBe("Declined");
  expect((await db.query(`SELECT 1 FROM hrms_application_stage_history WHERE application_id = $1 AND stage = 'Rejected'`, [applicationId])).rows).toHaveLength(1);
  expect((await db.query(`SELECT 1 FROM hrms_application_activity WHERE application_id = $1 AND to_stage = 'Rejected'`, [applicationId])).rows).toHaveLength(1);
  expect((await db.query(`SELECT 1 FROM hrms_offer_emails WHERE id = $1`, [`offer.declined:${id}`])).rows).toHaveLength(1);
});

it("queues the reply email for the chosen time, or for now", async () => {
  const first = await sentForReply(1);
  const later = new Date(Date.now() + 3 * 3600_000);
  await offers().recordReply(first.id, { answer: "Accepted", repliedAt: justNow(), sendAt: later.toISOString() });
  const second = await sentForReply(2);
  await offers().recordReply(second.id, { answer: "Accepted", repliedAt: justNow(), sendAt: null });
  const at = async (id: number) => (await db.query<{ due: boolean; at: string }>(
    `SELECT next_attempt_at <= clock_timestamp() AS due, next_attempt_at AS at FROM hrms_offer_emails WHERE id = $1`, [`offer.accepted:${id}`])).rows[0];
  expect((await at(first.id)).due).toBe(false);
  expect(new Date((await at(first.id)).at).getTime()).toBe(later.getTime());
  expect((await at(second.id)).due).toBe(true);
});

it("keeps a reply final: nothing can be recorded twice or changed", async () => {
  const { id, applicationId } = await sentForReply();
  await offers().recordReply(id, { answer: "Declined", repliedAt: justNow(), sendAt: null });
  for (const answer of ["Declined", "Accepted"] as const) {
    await expect(offers().recordReply(id, { answer, repliedAt: justNow(), sendAt: null })).rejects.toMatchObject({ reason: "conflict" });
  }
  await expect(offers().extendReplyBy(id, "2099-12-01")).rejects.toMatchObject({ reason: "conflict" });
  expect((await offers().detail(id)).status).toBe("Declined");
  expect(await stageOf(applicationId)).toBe("Rejected");
  expect((await db.query(`SELECT 1 FROM hrms_offer_emails`)).rows).toHaveLength(2);
});

it("refuses a reply on a Draft, a missing Offer, a future reply time or a send time in the past", async () => {
  const draft = await offers().create(await seed(1), terms);
  await expect(offers().recordReply(draft, { answer: "Accepted", repliedAt: justNow(), sendAt: null })).rejects.toMatchObject({ reason: "conflict" });
  await expect(offers().recordReply(9999, { answer: "Accepted", repliedAt: justNow(), sendAt: null })).rejects.toMatchObject({ reason: "not-found" });
  const { id } = await sentForReply(2);
  const hours = (n: number) => new Date(Date.now() + n * 3600_000).toISOString();
  for (const bad of [
    { answer: "Maybe", repliedAt: justNow(), sendAt: null }, { answer: "Accepted", repliedAt: "nope", sendAt: null },
    { answer: "Accepted", repliedAt: hours(2), sendAt: null }, { answer: "Accepted", repliedAt: hours(-48 * 365), sendAt: null },
    { answer: "Accepted", repliedAt: justNow(), sendAt: hours(-2) }, { answer: "Accepted", repliedAt: justNow(), sendAt: "nope" },
  ]) {
    await expect(offers().recordReply(id, bad as never)).rejects.toMatchObject({ reason: "validation" });
  }
  expect((await offers().read(id)).status).toBe("Sent");
});

it("blocks a reply on a Withdrawn Application's Offer", async () => {
  const { id } = await sentForReply();
  await db.query(`UPDATE applications SET status = 'Withdrawn'`);
  await expect(offers().recordReply(id, { answer: "Accepted", repliedAt: justNow(), sendAt: null })).rejects.toMatchObject({ reason: "conflict" });
  expect((await db.query(`SELECT 1 FROM hrms_offer_emails WHERE id LIKE 'offer.accepted:%'`)).rows).toHaveLength(0);
});

it("replies after the reply-by date still count; nothing expires", async () => {
  const { id } = await sentForReply();
  await db.query(`UPDATE hrms_offers SET reply_by = '2020-01-01'`);
  await offers().recordReply(id, { answer: "Accepted", repliedAt: justNow(), sendAt: null });
  expect((await offers().read(id)).status).toBe("Accepted");
});

it("refuses to record a reply without the Module", async () => {
  const other = portal.signIn(staff, ["Training"]);
  await expect(offers(other).recordReply(1, { answer: "Accepted", repliedAt: justNow(), sendAt: null })).rejects.toMatchObject({ reason: "denied" });
});

// ---- Pre-employment documents (#286) ----

const DUE = "2099-10-20";
async function sentOffer(index = 1) {
  const id = await offers().create(await seed(index), terms);
  await offers().send(id, "2099-10-29");
  return id;
}
const request = (id: number, types: string[], extra: Record<string, unknown> = {}) =>
  offers().requestDocuments(id, { types, dueDate: DUE, ...extra } as never);

it("lists the seven documents, with those the Applicant already sent starting Submitted", async () => {
  const id = await sentOffer();
  await db.query(`UPDATE applications SET documents_snapshot = $1::jsonb WHERE applicant_id = 'person-1'`, [JSON.stringify([
    { id: 11, name: "resume.pdf", requiredFor: "Resume or CV", size: 1, contentType: "application/pdf" },
    { id: 12, name: "id.png", requiredFor: "Valid government ID", size: 1, contentType: "image/png" },
    { id: 13, name: "birth.pdf", requiredFor: "Birth certificate", size: 1, contentType: "application/pdf" },
  ])]);
  const checklist = await offers().documents(id);
  expect(checklist.total).toBe(7);
  expect(checklist.submitted).toBe(2);
  expect(checklist.items.map((item) => [item.type, item.status])).toEqual([
    ["resume", "Submitted"], ["valid-id", "Submitted"], ["nbi", "Not requested"], ["health", "Not requested"],
    ["sss", "Not requested"], ["philhealth", "Not requested"], ["pagibig", "Not requested"],
  ]);
  const resume = checklist.items[0];
  expect(resume).toMatchObject({ source: "application", file: { name: "resume.pdf", downloadUrl: expect.stringMatching(/^\/api\/applications\/\d+\/documents\/11$/) } });
});

it("allows a request from Sent onward, not on a Draft, a Declined offer or a Withdrawn Application", async () => {
  const draft = await offers().create(await seed(1), terms);
  expect((await offers().documents(draft)).canRequest).toBe(false);
  await expect(request(draft, ["nbi"])).rejects.toMatchObject({ reason: "conflict" });

  const sent = await sentOffer(2);
  expect((await offers().documents(sent)).canRequest).toBe(true);
  await request(sent, ["nbi"]);
  await db.query(`UPDATE hrms_offers SET status = 'Accepted' WHERE id = $1`, [sent]);
  expect((await offers().documents(sent)).canRequest).toBe(true);
  await request(sent, ["sss"]);

  const declined = await sentOffer(3);
  await db.query(`UPDATE hrms_offers SET status = 'Declined' WHERE id = $1`, [declined]);
  expect((await offers().documents(declined)).canRequest).toBe(false);
  await expect(request(declined, ["nbi"])).rejects.toMatchObject({ reason: "conflict" });

  const withdrawn = await sentOffer(4);
  await db.query(`UPDATE applications SET status = 'Withdrawn' WHERE applicant_id = 'person-4'`);
  expect((await offers().documents(withdrawn)).canRequest).toBe(false);
  await expect(request(withdrawn, ["nbi"])).rejects.toMatchObject({ reason: "conflict" });
  expect((await db.query(`SELECT 1 FROM hrms_offer_documents WHERE offer_id = ANY($1)`, [[draft, declined, withdrawn]])).rows).toHaveLength(0);
});

it("marks the chosen documents Requested and emails the Applicant at once with documents, due date and message", async () => {
  const id = await sentOffer();
  await request(id, ["nbi", "health"], { message: "  Please bring the originals too.  " });
  const checklist = await offers().documents(id);
  expect(checklist.items.filter((item) => item.status === "Requested").map((item) => [item.type, item.dueDate])).toEqual([["nbi", DUE], ["health", DUE]]);
  expect(checklist.submitted).toBe(0);

  const { rows } = await db.query<{ id: string; payload: { to: string; app: string; title: string; body: string }; next_attempt_at: Date }>(
    `SELECT id, payload, next_attempt_at FROM hrms_offer_emails WHERE id LIKE 'offer.docs:%'`);
  expect(rows).toHaveLength(1);
  expect(rows[0].payload).toMatchObject({ to: "person1@example.test", app: "careers" });
  for (const text of ["NBI clearance", "Health certificate", "20 Oct 2099", "Please bring the originals too."]) expect(rows[0].payload.body).toContain(text);
  expect(rows[0].payload.body).not.toContain("Resume");
  expect(rows[0].next_attempt_at.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

  const activity = (await offers().detail(id)).activity.find((entry) => entry.kind === "documents-requested");
  expect(activity).toMatchObject({ actorName: "Ada Okafor", detail: "NBI clearance, Health certificate · due 20 Oct 2099" });
});

it("resets a Submitted document to Requested when it is requested again", async () => {
  const id = await sentOffer();
  await db.query(`UPDATE applications SET documents_snapshot = $1::jsonb WHERE applicant_id = 'person-1'`, [JSON.stringify([
    { id: 11, name: "resume.pdf", requiredFor: "Resume or CV", size: 1, contentType: "application/pdf" },
  ])]);
  await db.query(`INSERT INTO hrms_offer_documents (offer_id, document_type, status, file_id, file_name, submitted_at) VALUES ($1, 'nbi', 'Submitted', 'f1', 'nbi.pdf', now())`, [id]);
  const before = await offers().documents(id);
  expect(before.items.filter((item) => item.status === "Submitted").map((item) => item.type)).toEqual(["resume", "nbi"]);

  await request(id, ["resume", "nbi"]);
  const after = await offers().documents(id);
  expect(after.submitted).toBe(0);
  expect(after.items.slice(0, 3).map((item) => [item.type, item.status, item.file])).toEqual([["resume", "Requested", null], ["valid-id", "Not requested", null], ["nbi", "Requested", null]]);
  expect((await db.query(`SELECT submitted_at FROM hrms_offer_documents WHERE document_type = 'nbi'`)).rows[0]).toEqual({ submitted_at: null });
  expect((await db.query(`SELECT id FROM hrms_offer_emails WHERE id LIKE 'offer.docs:%'`)).rows).toHaveLength(1);
  await request(id, ["resume"]);
  expect((await db.query(`SELECT id FROM hrms_offer_emails WHERE id LIKE 'offer.docs:%'`)).rows).toHaveLength(2);
});

it("rejects an empty, unknown or repeated choice, a bad or past due date and an unknown Offer, and changes nothing", async () => {
  const id = await sentOffer();
  for (const bad of [{ types: [] }, { types: ["passport"] }, { types: ["nbi", "nbi"] }, { dueDate: "" }, { dueDate: "2020-01-01" }, { dueDate: "2099-02-30" }, { message: "x".repeat(501) }]) {
    await expect(offers().requestDocuments(id, { types: ["nbi"], dueDate: DUE, ...bad } as never)).rejects.toMatchObject({ reason: "validation" });
  }
  await expect(request(9999, ["nbi"])).rejects.toMatchObject({ reason: "not-found" });
  expect((await db.query(`SELECT 1 FROM hrms_offer_documents`)).rows).toHaveLength(0);
  expect((await db.query(`SELECT 1 FROM hrms_offer_emails WHERE id LIKE 'offer.docs:%'`)).rows).toHaveLength(0);
});

it("keeps an overdue due date visible with no automatic change", async () => {
  const id = await sentOffer();
  await request(id, ["nbi"]);
  await db.query(`UPDATE hrms_offer_documents SET due_date = '2020-01-01'`);
  const nbi = (await offers().documents(id)).items.find((item) => item.type === "nbi");
  expect(nbi).toMatchObject({ status: "Requested", dueDate: "2020-01-01" });
  expect((await offers().detail(id)).status).toBe("Sent");
});

it("records the documents email in the activity once delivered", async () => {
  const id = await sentOffer();
  await request(id, ["nbi"]);
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "key");
  vi.stubGlobal("fetch", async () => new Response("{}", { status: 200 }));
  await deliverOfferEmails(db);
  const details = (await db.query<{ detail: string }>(`SELECT detail FROM hrms_offer_activity WHERE kind = 'email-sent' ORDER BY id`)).rows.map((row) => row.detail);
  expect(details).toEqual(["Offer email sent", "Documents email sent"]);
});

it("refuses documents and requests without the Module", async () => {
  const other = portal.signIn(staff, ["Training"]);
  await expect(offers(other).documents(1)).rejects.toMatchObject({ reason: "denied" });
  await expect(offers(other).requestDocuments(1, { types: ["nbi"], dueDate: DUE })).rejects.toMatchObject({ reason: "denied" });
});

// ---- Mark as hired (#287) ----

/** An Accepted offer; `docs` of the seven are Submitted (resume and ID came with the Application). */
async function acceptedOffer(index = 1, docs = 7, openings: number | null = null) {
  const { id, applicationId } = await sentForReply(index);
  await db.query(`UPDATE job_postings SET openings = $2 WHERE id = $1`, [`posting-${index}`, openings]);
  await db.query(`UPDATE applications SET documents_snapshot = $1::jsonb WHERE id = $2`, [JSON.stringify([
    { id: 11, name: "resume.pdf", requiredFor: "Resume or CV" }, { id: 12, name: "id.png", requiredFor: "Valid government ID" },
  ]), applicationId]);
  await offers().recordReply(id, { answer: "Accepted", repliedAt: justNow(), sendAt: null });
  const missing = ["nbi", "health", "sss", "philhealth", "pagibig"];
  await request(id, missing);
  for (const type of missing.slice(0, Math.max(0, docs - 2))) {
    await db.query(`UPDATE hrms_offer_documents SET status = 'Submitted', file_id = $3, file_name = $3 || '.pdf' WHERE offer_id = $1 AND document_type = $2`, [id, type, `file-${type}`]);
  }
  return { id, applicationId };
}
const count = async (sql: string) => (await db.query(sql)).rows.length;

it("hires in one step: Hired Stage, an Employee record with details, terms and the same document files, and a welcome email", async () => {
  const { id, applicationId } = await acceptedOffer();
  const { employeeId } = await offers().hire(id);
  expect(await stageOf(applicationId)).toBe("Hired");
  const employee = (await db.query(`SELECT * FROM hrms_employees WHERE id = $1`, [employeeId])).rows[0] as Record<string, unknown>;
  expect(employee).toMatchObject({ full_name: "Applicant 1", email: "person1@example.test", position: "Cashier", branch: "Cainta branch",
    monthly_salary: 19000, employment_type: "Full-time", probation: "6 months", reports_to: "Paolo Garcia", status: "Onboarding", employee_number: "BR-EMP-0001" });
  const documents = (await db.query<{ document_type: string; source: string; file_id: string | null }>(
    `SELECT document_type, source, file_id FROM hrms_employee_documents WHERE employee_id = $1 ORDER BY document_type`, [employeeId])).rows;
  expect(documents).toHaveLength(7);
  expect(documents.find((d) => d.document_type === "resume")).toMatchObject({ source: "application", file_id: "11" });
  expect(documents.find((d) => d.document_type === "nbi")).toMatchObject({ source: "upload", file_id: "file-nbi" });
  const email = (await db.query<{ payload: { to: string; title: string } }>(`SELECT payload FROM hrms_offer_emails WHERE id = $1`, [`offer.hired:${id}`])).rows;
  expect(email).toHaveLength(1);
  expect(email[0].payload.to).toBe("person1@example.test");
  expect(email[0].payload.title).not.toBe((await db.query<{ payload: { title: string } }>(`SELECT payload FROM hrms_offer_emails WHERE id = $1`, [`offer.accepted:${id}`])).rows[0].payload.title);
  expect((await offers().detail(id)).activity.map((entry) => entry.kind)).toContain("hired");
});

it("lists the Hired employees as Onboarding, newest first", async () => {
  const first = await acceptedOffer(1);
  const second = await acceptedOffer(2);
  await offers().hire(first.id);
  await offers().hire(second.id);
  const list = await offers().employees();
  expect(list.onboarding).toBe(2);
  expect(list.rows.map((row) => [row.name, row.employeeNumber, row.status, row.startDate])).toEqual([
    ["Applicant 2", "BR-EMP-0002", "Onboarding", "2099-11-03"], ["Applicant 1", "BR-EMP-0001", "Onboarding", "2099-11-03"],
  ]);
  expect(list.rows[0]).toMatchObject({ position: "Cashier", department: "Retail", branch: "Cainta branch" });
});

it("stays locked until the offer is Accepted and all seven documents are Submitted", async () => {
  const partial = await acceptedOffer(1, 4);
  await expect(offers().hire(partial.id)).rejects.toMatchObject({ reason: "conflict" });
  const waiting = await sentForReply(2);
  await expect(offers().hire(waiting.id)).rejects.toMatchObject({ reason: "conflict" });
  const declined = await sentForReply(3);
  await offers().recordReply(declined.id, { answer: "Declined", repliedAt: justNow(), sendAt: null });
  await expect(offers().hire(declined.id)).rejects.toMatchObject({ reason: "conflict" });
  await expect(offers().hire(9999)).rejects.toMatchObject({ reason: "not-found" });
  expect(await count(`SELECT 1 FROM hrms_employees`)).toBe(0);
  expect(await stageOf(partial.applicationId)).toBe("Offer");
});

it("blocks hiring a Withdrawn Application and a document that was requested again", async () => {
  const withdrawn = await acceptedOffer(1);
  await db.query(`UPDATE applications SET status = 'Withdrawn' WHERE id = $1`, [withdrawn.applicationId]);
  await expect(offers().hire(withdrawn.id)).rejects.toMatchObject({ reason: "conflict" });
  const again = await acceptedOffer(2);
  await request(again.id, ["nbi"]);
  await expect(offers().hire(again.id)).rejects.toMatchObject({ reason: "conflict" });
  expect(await count(`SELECT 1 FROM hrms_employees`)).toBe(0);
});

it("cannot hire twice", async () => {
  const { id } = await acceptedOffer();
  await offers().hire(id);
  await expect(offers().hire(id)).rejects.toMatchObject({ reason: "conflict" });
  expect(await count(`SELECT 1 FROM hrms_employees`)).toBe(1);
  expect(await count(`SELECT 1 FROM hrms_offer_emails WHERE id LIKE 'offer.hired:%'`)).toBe(1);
});

it("rolls everything back when any part fails", async () => {
  const { id, applicationId } = await acceptedOffer(1, 7, 1);
  await db.exec(`CREATE FUNCTION boom() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'forced failure'; END $$;
    CREATE TRIGGER fail_hired_email BEFORE INSERT ON hrms_offer_emails FOR EACH ROW WHEN (NEW.id LIKE 'offer.hired:%') EXECUTE FUNCTION boom();`);
  await expect(offers().hire(id)).rejects.toThrow(/forced failure/);
  expect(await stageOf(applicationId)).toBe("Offer");
  expect(await count(`SELECT 1 FROM hrms_employees`)).toBe(0);
  expect(await count(`SELECT 1 FROM hrms_employee_documents`)).toBe(0);
  expect(await count(`SELECT 1 FROM hrms_offer_emails WHERE id LIKE 'offer.hired:%'`)).toBe(0);
  expect((await db.query<{ status: string }>(`SELECT status FROM job_postings WHERE id = 'posting-1'`)).rows[0].status).toBe("open");
  expect(await count(`SELECT 1 FROM hrms_audit_outbox`)).toBe(0);
  expect((await offers().detail(id)).activity.map((entry) => entry.kind)).not.toContain("hired");
});

it("fills the Job Posting only when hires reach its openings, and a Closed posting stays Closed", async () => {
  const postingStatus = async (n: number) => (await db.query<{ status: string }>(`SELECT status FROM job_postings WHERE id = $1`, [`posting-${n}`])).rows[0].status;
  const noLimit = await acceptedOffer(1, 7, null);
  await offers().hire(noLimit.id);
  expect(await postingStatus(1)).toBe("open");
  const two = await acceptedOffer(2, 7, 2);
  await offers().hire(two.id);
  expect(await postingStatus(2)).toBe("open");
  const three = await acceptedOffer(3, 7, 1);
  await db.query(`UPDATE job_postings SET status = 'closed' WHERE id = 'posting-3'`);
  await offers().hire(three.id);
  expect(await postingStatus(3)).toBe("closed");
  const one = await acceptedOffer(4, 7, 1);
  await offers().hire(one.id);
  expect(await postingStatus(4)).toBe("filled");
  expect(await count(`SELECT 1 FROM hrms_audit_outbox WHERE payload->>'action' = 'job_posting.filled'`)).toBe(1);
});

it("refuses hiring and the Hired list without the Module", async () => {
  const other = portal.signIn(staff, ["Training"]);
  await expect(offers(other).hire(1)).rejects.toMatchObject({ reason: "denied" });
  await expect(offers(other).employees()).rejects.toMatchObject({ reason: "denied" });
});

it("opens Offers to the Offers Module alone, not to the other hiring Modules", async () => {
  for (const holder of ["Job Postings", "Applications", "Interviews"]) {
    await expect(offers(portal.signIn(staff, [holder])).list()).rejects.toMatchObject({ reason: "denied" });
  }
  await expect(offers(portal.signIn(staff, ["Offers"])).list()).resolves.toBeDefined();
});
