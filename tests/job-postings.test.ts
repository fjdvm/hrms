import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { closeExpiredJobPostings, jobPostingsFor, jobTemplatesFor, retryJobPostingAnnouncements } from "@/lib/job-postings";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

const ada = { name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
let db: PGlite;
let portal: FakePortal;
let handle: string;
let auditRequests: Record<string, unknown>[];

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0001-job-posting-drafts.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0002-job-templates.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0003-job-posting-audit.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0004-job-posting-announcements.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0005-job-posting-first-published.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0006-job-openings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0007-job-salary-range.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0008-job-work-schedule.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0009-job-template-name.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../migrations/0010-job-template-lists.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY, email text, "emailVerified" boolean);
    CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, job_alerts_opt_in boolean);`);
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  vi.stubEnv("CAREERS_URL", "https://careers.test");
  portal = new FakePortal();
  handle = portal.signIn(ada, ["Job Postings", "Applications", "Interviews", "Offers"]);
  auditRequests = [];
  const portalBoundary = portalFetch(portal);
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "hrms-test-key");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith("https://gateway.test")) {
      expect(String(input)).toBe("https://gateway.test/audit/events");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer hrms-test-key");
      auditRequests.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "accepted" }, { status: 201 });
    }
    return portalBoundary(input, init);
  });
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});
afterEach(async () => {
  await db.close();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it("saves an empty Draft and reads it from another module instance", async () => {
  const posting = await jobPostingsFor(handle, db).saveDraft({});
  expect(posting).toMatchObject({ status: "draft", title: "", deadline: null, responsibilities: [], benefits: [], requiredDocuments: [], screeningCriteria: [] });
  expect(posting.id).toBeTruthy();
  expect(await jobPostingsFor(handle, db).read(posting.id)).toEqual(posting);
});

it("edits a Draft, preserving omitted fields and allowing fields to be cleared", async () => {
  const postings = jobPostingsFor(handle, db);
  const saved = await postings.saveDraft({ title: "HR Officer", department: "People", deadline: new Date("2030-01-01T00:00:00Z") });
  const edited = await postings.editDraft(saved.id, { title: "Recruiter", deadline: null, requiredDocuments: ["CV"] });
  expect(edited).toMatchObject({ title: "Recruiter", department: "People", deadline: null, requiredDocuments: ["CV"], status: "draft" });
  expect(await postings.read(saved.id)).toEqual(edited);
  expect(await postings.editDraft(saved.id, {})).toEqual(edited);
});

it("lists all Job Postings, filters by status and searches by title", async () => {
  const postings = jobPostingsFor(handle, db);
  const recruiter = await postings.saveDraft({ title: "Senior Recruiter", department: "People" });
  await postings.saveDraft({ title: "HR Officer" });
  expect(await postings.list()).toHaveLength(2);
  expect(await postings.list({ status: "open" })).toEqual([]);
  expect(await postings.list({ status: "draft", search: "RECRUIT" })).toEqual([{ ...recruiter, applicantCount: 0 }]);
  expect(await postings.read("missing")).toBeUndefined();
});

it("lists a live applicant count per posting, counting every status except Withdrawn", async () => {
  const postings = jobPostingsFor(handle, db);
  const populated = await postings.saveDraft({ title: "Recruiter" });
  const empty = await postings.saveDraft({ title: "No applications" });
  const withdrawnOnly = await postings.saveDraft({ title: "Withdrawn only" });
  const statuses = ["Received", "Interview", "Hired", "Declined", "Expired", "Rejected", "Withdrawn"];
  for (const [index, status] of statuses.entries()) {
    await db.query(`INSERT INTO applications
      (applicant_id, job_posting_id, reference_number, status, profile_snapshot, documents_snapshot, consented_at)
      VALUES ($1, $2, $3, $4, '{}', '[]', now())`, [`applicant-${index}`, populated.id, `APP-${index}`, status]);
  }
  await db.query(`INSERT INTO applications
    (applicant_id, job_posting_id, reference_number, status, profile_snapshot, documents_snapshot, consented_at)
    VALUES ('other', $1, 'APP-OTHER', 'Withdrawn', '{}', '[]', now())`, [withdrawnOnly.id]);
  expect(await postings.list()).toEqual([
    { ...withdrawnOnly, applicantCount: 0 }, { ...empty, applicantCount: 0 }, { ...populated, applicantCount: 6 },
  ]);
  expect(await postings.list({ status: "draft", search: "Recruiter" }))
    .toEqual([{ ...populated, applicantCount: 6 }]);
  await db.query("UPDATE applications SET status = 'Withdrawn' WHERE reference_number = 'APP-0'");
  expect(await jobPostingsFor(handle, db).list({ search: "Recruiter" }))
    .toEqual([{ ...populated, applicantCount: 5 }]);
  expect((await db.query("SELECT status FROM applications ORDER BY id")).rows)
    .toEqual([...statuses.map((status, index) => ({ status: index === 0 ? "Withdrawn" : status })), { status: "Withdrawn" }]);
});

it("deletes a Draft and refuses to edit or delete a missing Job Posting", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({});
  await postings.deleteDraft(draft.id);
  expect(await postings.read(draft.id)).toBeUndefined();
  expect(await postings.list()).toEqual([]);
  await expect(postings.deleteDraft(draft.id)).rejects.toMatchObject({ reason: "not-found" });
  await expect(postings.editDraft(draft.id, { title: "Gone" })).rejects.toMatchObject({ reason: "not-found" });
});

it.each(["open", "closed", "filled"] as const)("preserves an existing %s Job Posting and refuses Draft mutations", async (status) => {
  // External fixture: these postings predate HRMS; publishing is ticket #31.
  await db.query(`INSERT INTO job_postings
    (id,title,department,employment_type,location,description,requirements,required_documents,screening_criteria,deadline,status,responsibilities,benefits)
    VALUES ($1,'Existing role','People','Full time','Manila','Recruitment','', '[]','[]','2030-01-01',$2,'["Legacy responsibility"]','["Legacy benefit"]')`, [status, status]);
  const postings = jobPostingsFor(handle, db);
  const original = await postings.read(status);
  expect(original).toMatchObject({ firstPublishedAt: null, responsibilities: ["Legacy responsibility"], benefits: ["Legacy benefit"] });
  expect(await postings.list({ status })).toEqual([{ ...original, applicantCount: 0 }]);
  await expect(postings.deleteDraft(status)).rejects.toMatchObject({ reason: "not-draft" });
  await expect(postings.editDraft(status, { title: "Changed" })).rejects.toMatchObject({ reason: "not-draft" });
  await expect(postings.editDraft(status, {})).rejects.toMatchObject({ reason: "not-draft" });
  expect(await postings.read(status)).toEqual(original);
});

it("refuses every operation without the Module, then allows them when granted", async () => {
  const allowed = jobPostingsFor(handle, db);
  const draft = await allowed.saveDraft({ title: "Original" });
  const denied = jobPostingsFor(portal.signIn(ada, ["Training"]), db);
  for (const operation of [
    () => denied.saveDraft({}), () => denied.read(draft.id), () => denied.list(),
    () => denied.editDraft(draft.id, { title: "Forbidden" }), () => denied.deleteDraft(draft.id),
  ]) {
    await expect(operation()).rejects.toMatchObject({ reason: "denied" });
  }
  expect(await allowed.list()).toEqual([{ ...draft, applicantCount: 0 }]);
});

it("rechecks the Portal on each operation and fails closed for expired sessions and outages", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({ title: "Original" });
  portal.unavailable = true;
  await expect(postings.editDraft(draft.id, { title: "Forbidden" })).rejects.toMatchObject({ reason: "unavailable" });
  portal.unavailable = false;
  expect(await postings.read(draft.id)).toEqual(draft);
  portal.endSession(handle);
  for (const operation of [
    () => postings.saveDraft({}), () => postings.read(draft.id), () => postings.list(),
    () => postings.editDraft(draft.id, {}), () => postings.deleteDraft(draft.id),
  ]) {
    await expect(operation()).rejects.toMatchObject({ reason: "invalid" });
  }
  await expect(jobPostingsFor(undefined, db).list()).rejects.toMatchObject({ reason: "invalid" });
});

it("saves all fields and treats search text and caller-supplied status as data", async () => {
  const postings = jobPostingsFor(handle, db);
  const fields = {
    title: "100% Recruiter's _role", department: "People", employmentType: "Full time", location: "Manila",
    description: "Hire Staff", requirements: "Experience", requiredDocuments: ["CV", "ID"],
    screeningCriteria: ["Interview"], deadline: new Date("2030-01-01T00:00:00Z"),
  };
  const draft = await postings.saveDraft({ ...fields, ...JSON.parse('{"status":"open"}') });
  expect(draft).toMatchObject({ ...fields, status: "draft" });
  expect(await postings.list({ search: "%" })).toEqual([{ ...draft, applicantCount: 0 }]);
  expect(await postings.list({ search: "' OR TRUE --" })).toEqual([]);
  expect(await postings.editDraft(draft.id, { title: "", ...JSON.parse('{"status":"open"}') }))
    .toMatchObject({ title: "", status: "draft" });
});

const publishable = {
  title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila",
  description: "Hire Staff", deadline: new Date("2030-01-01T00:00:00Z"),
};

it("adds first-published metadata without backfilling historical Open rows", async () => {
  await db.exec("ALTER TABLE job_postings DROP COLUMN first_published_at");
  await db.query(`INSERT INTO job_postings
    (id,title,department,employment_type,location,description,requirements,required_documents,screening_criteria,deadline,status)
    VALUES ('historical','Existing role','People','Full time','Manila','Recruitment','','[]','[]','2030-01-01','open')`);
  const migration = await readFile(new URL("../migrations/0005-job-posting-first-published.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration);
  const postings = jobPostingsFor(handle, db);
  expect(await postings.read("historical")).toMatchObject({ status: "open", firstPublishedAt: null });
  expect(await postings.editOpen("historical", { title: "Edited role" })).toMatchObject({ firstPublishedAt: null });
  expect(await postings.close("historical")).toMatchObject({ firstPublishedAt: null });
});

it.each(["close", "markFilled"] as const)("records first publish once and preserves it through edits and %s", async (operation) => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  expect(draft).toMatchObject({ firstPublishedAt: null });
  expect(await postings.editDraft(draft.id, { title: "Senior Recruiter" })).toMatchObject({ firstPublishedAt: null });
  const before = Date.now();
  const published = await postings.publish(draft.id);
  expect(published.firstPublishedAt).toBeInstanceOf(Date);
  expect(published.firstPublishedAt!.getTime()).toBeGreaterThanOrEqual(before);
  expect(published.firstPublishedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  expect(await postings.editOpen(draft.id, { title: "Recruiter" })).toMatchObject({ firstPublishedAt: published.firstPublishedAt });
  await expect(postings.publish(draft.id)).rejects.toMatchObject({ reason: "not-draft" });
  expect(await postings[operation](draft.id)).toMatchObject({ firstPublishedAt: published.firstPublishedAt });
  expect(await jobPostingsFor(handle, db).read(draft.id)).toMatchObject({ firstPublishedAt: published.firstPublishedAt });
  expect(await postings.list()).toMatchObject([{ firstPublishedAt: published.firstPublishedAt }]);
});

it("publishes a complete Draft into the shared Careers data and edits it immediately", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  expect(await postings.publish(draft.id)).toMatchObject({ status: "open", requirements: "" });
  expect(await postings.editOpen(draft.id, { title: "Senior Recruiter" })).toMatchObject({ title: "Senior Recruiter", status: "open" });
  expect(await jobPostingsFor(handle, db).read(draft.id)).toMatchObject({ title: "Senior Recruiter", status: "open" });
});

it("names every missing publish field and leaves the Draft intact", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({ title: "\u00a0\f" });
  await expect(postings.publish(draft.id)).rejects.toMatchObject({ reason: "validation", fieldErrors: {
    title: expect.any(String), department: expect.any(String), employmentType: expect.any(String),
    location: expect.any(String), description: expect.any(String), deadline: expect.any(String),
  } });
  expect(await postings.read(draft.id)).toEqual(draft);
});

it.each([null, new Date("2000-01-01"), new Date()])("refuses publishing with deadline %s", async (deadline) => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({ ...publishable, deadline });
  await expect(postings.publish(draft.id)).rejects.toMatchObject({ reason: "validation", fieldErrors: { deadline: expect.any(String) } });
  expect(await postings.read(draft.id)).toMatchObject({ status: "draft" });
});

it.each(["close", "markFilled"] as const)("allows %s only from Open and keeps final statuses final", async (operation) => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  await expect(postings[operation](draft.id)).rejects.toMatchObject({ reason: "not-open" });
  await expect(postings.editOpen(draft.id, {})).rejects.toMatchObject({ reason: "not-open" });
  await postings.publish(draft.id);
  await expect(postings.publish(draft.id)).rejects.toMatchObject({ reason: "not-draft" });
  expect(await postings[operation](draft.id)).toMatchObject({ status: operation === "close" ? "closed" : "filled" });
  const final = await postings.read(draft.id);
  for (const action of [() => postings.publish(draft.id), () => postings.close(draft.id),
    () => postings.markFilled(draft.id), () => postings.editOpen(draft.id, { title: "Changed" }),
    () => postings.editDraft(draft.id, {}), () => postings.deleteDraft(draft.id)]) {
    await expect(action()).rejects.toBeDefined();
  }
  expect(await postings.read(draft.id)).toEqual(final);
});

it("refuses incomplete Open edits without changing shared data", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  const open = await postings.publish(draft.id);
  for (const fields of [{ title: " " }, { department: "" }, { employmentType: "" },
    { location: "" }, { description: "" }, { deadline: null }, { deadline: new Date("2000-01-01") },
    { deadline: new Date("invalid") }]) {
    await expect(postings.editOpen(draft.id, fields)).rejects.toMatchObject({ reason: "validation" });
    expect(await postings.read(draft.id)).toEqual(open);
  }
  expect(await postings.editOpen(draft.id, { requirements: "", requiredDocuments: [], screeningCriteria: [] }))
    .toMatchObject({ status: "open", requiredDocuments: [] });
});

it.each(["read", "list", "closeExpired"] as const)("moves expired Open postings to Closed on %s", async (operation) => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  const published = await postings.publish(draft.id);
  // Simulate time passing at the database boundary; no shared database is used.
  await db.query("UPDATE job_postings SET deadline = '2000-01-01' WHERE id = $1", [draft.id]);
  if (operation === "read") await postings.read(draft.id);
  else if (operation === "list") expect(await postings.list({ status: "closed" })).toMatchObject([{ id: draft.id, status: "closed" }]);
  else await postings.closeExpired();
  expect((await db.query("SELECT status FROM job_postings WHERE id = $1", [draft.id])).rows[0]).toEqual({ status: "closed" });
  expect(await jobPostingsFor(handle, db).read(draft.id)).toMatchObject({ status: "closed", firstPublishedAt: published.firstPublishedAt });
  expect(await postings.list({ status: "open" })).toEqual([]);
  await expect(postings.markFilled(draft.id)).rejects.toMatchObject({ reason: "not-open" });
});

it("refuses missing postings and rechecks access on every lifecycle operation", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  for (const id of ["missing", draft.id]) {
    for (const action of [() => postings.publish(id), () => postings.editOpen(id, {}),
      () => postings.close(id), () => postings.markFilled(id)]) {
      if (id === "missing") await expect(action()).rejects.toMatchObject({ reason: "not-found" });
    }
  }
  for (const state of ["denied", "unavailable", "invalid"] as const) {
    portal.unavailable = state === "unavailable";
    const restricted = jobPostingsFor(state === "denied" ? portal.signIn(ada, ["Training"]) : state === "invalid" ? undefined : handle, db);
    for (const action of [() => restricted.publish(draft.id), () => restricted.editOpen(draft.id, {}),
      () => restricted.close(draft.id), () => restricted.markFilled(draft.id), () => restricted.closeExpired()]) {
      await expect(action()).rejects.toMatchObject({ reason: state });
    }
  }
});


it("scheduled maintenance persists deadline closure without a Staff read", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  await postings.publish(draft.id);
  await db.query("UPDATE job_postings SET deadline = '2000-01-01' WHERE id = $1", [draft.id]);
  await closeExpiredJobPostings(db);
  await closeExpiredJobPostings(db);
  expect((await db.query("SELECT status FROM job_postings WHERE id = $1", [draft.id])).rows[0]).toEqual({ status: "closed" });
});

it("explicitly saves all reusable fields without a deadline and persists templates", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({ ...publishable, requirements: "Experience", requiredDocuments: ["CV"], screeningCriteria: ["Interview"] });
  const templates = jobTemplatesFor(handle, db);
  expect(await templates.list()).toEqual([]);
  const saved = await templates.create(draft);
  expect(saved).toMatchObject({ title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", requirements: "Experience", requiredDocuments: ["CV"], screeningCriteria: ["Interview"] });
  expect(saved).not.toHaveProperty("deadline");
  expect(saved).not.toHaveProperty("status");
  expect(await jobTemplatesFor(handle, db).list()).toEqual([saved]);
});

it("starts an editable Draft with independent values and no deadline or template link", async () => {
  const templates = jobTemplatesFor(handle, db);
  const template = await templates.create({ ...publishable, requiredDocuments: ["CV"], screeningCriteria: ["Interview"] });
  const draft = await templates.startPosting(template.id);
  expect(draft).toMatchObject({ title: "Recruiter", status: "draft", deadline: null, requiredDocuments: ["CV"], screeningCriteria: ["Interview"] });
  expect(draft.id).not.toBe(template.id);
  const postings = jobPostingsFor(handle, db);
  await postings.editDraft(draft.id, { title: "One-off", requiredDocuments: [] });
  expect(await templates.list()).toEqual([template]);
  await templates.edit(template.id, { title: "Future role", requiredDocuments: ["ID"] });
  expect(await postings.read(draft.id)).toMatchObject({ title: "One-off", requiredDocuments: [] });
  await templates.delete(template.id);
  expect(await templates.list()).toEqual([]);
  expect(await postings.read(draft.id)).toMatchObject({ title: "One-off", deadline: null });
});

it("patches only reusable template fields and refuses missing templates", async () => {
  const templates = jobTemplatesFor(handle, db);
  const saved = await templates.create({});
  expect(saved).toMatchObject({ title: "", requiredDocuments: [], screeningCriteria: [] });
  expect(await templates.edit(saved.id, {})).toEqual(saved);
  await templates.edit(saved.id, { title: "HR Officer", department: "People" });
  const edited = await templates.edit(saved.id, { title: "", ...JSON.parse('{"deadline":"2030-01-01","status":"open","id":"injected"}') });
  expect(edited).toMatchObject({ id: saved.id, title: "", department: "People" });
  expect(edited).not.toHaveProperty("deadline");
  expect(edited).not.toHaveProperty("status");
  expect(await jobTemplatesFor(handle, db).list()).toEqual([edited]);
  for (const action of [() => templates.edit("missing", {}), () => templates.delete("missing"), () => templates.startPosting("missing")]) {
    await expect(action()).rejects.toMatchObject({ reason: "not-found" });
  }
  expect(await jobPostingsFor(handle, db).list()).toEqual([]);
});

it("rechecks Portal access on every template operation and fails closed", async () => {
  const templates = jobTemplatesFor(handle, db);
  const saved = await templates.create({ title: "Original" });
  const denied = jobTemplatesFor(portal.signIn(ada, ["Training"]), db);
  for (const state of ["denied", "unavailable", "invalid"] as const) {
    portal.unavailable = state === "unavailable";
    if (state === "invalid") portal.endSession(handle);
    const restricted = state === "denied" ? denied : templates;
    for (const action of [() => restricted.create({}), () => restricted.list(),
      () => restricted.edit(saved.id, { title: "Forbidden" }), () => restricted.delete(saved.id),
      () => restricted.startPosting(saved.id)]) {
      await expect(action()).rejects.toMatchObject({ reason: state });
    }
  }
  portal.unavailable = false;
  const freshHandle = portal.signIn(ada, ["Job Postings", "Applications", "Interviews", "Offers"]);
  expect(await jobTemplatesFor(freshHandle, db).list()).toEqual([saved]);
  expect(await jobPostingsFor(freshHandle, db).list()).toEqual([]);
  await expect(jobTemplatesFor(undefined, db).list()).rejects.toMatchObject({ reason: "invalid" });
});

it("adopts the existing Careers template table without losing templates", async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
    await legacy.exec(`CREATE TABLE job_templates (LIKE job_postings INCLUDING ALL);
      ALTER TABLE job_templates DROP COLUMN deadline;
      INSERT INTO job_templates (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
      VALUES ('legacy','Existing role','','','','','','[]','[]','draft');`);
    const migration = await readFile(new URL("../migrations/0002-job-templates.sql", import.meta.url), "utf8");
    await legacy.exec(migration);
    await legacy.exec(migration);
    await legacy.exec(await readFile(new URL("../migrations/0003-job-posting-audit.sql", import.meta.url), "utf8"));
    await legacy.exec(await readFile(new URL("../migrations/0004-job-posting-announcements.sql", import.meta.url), "utf8"));
    await legacy.exec(await readFile(new URL("../migrations/0005-job-posting-first-published.sql", import.meta.url), "utf8"));
    await legacy.exec(await readFile(new URL("../migrations/0006-job-openings.sql", import.meta.url), "utf8"));
    await legacy.exec(await readFile(new URL("../migrations/0007-job-salary-range.sql", import.meta.url), "utf8"));
    await legacy.exec(await readFile(new URL("../migrations/0008-job-work-schedule.sql", import.meta.url), "utf8"));
    await legacy.exec(await readFile(new URL("../migrations/0009-job-template-name.sql", import.meta.url), "utf8"));
    await legacy.exec(await readFile(new URL("../migrations/0010-job-template-lists.sql", import.meta.url), "utf8"));
    const templates = jobTemplatesFor(handle, legacy);
    expect(await templates.list()).toMatchObject([{ id: "legacy", title: "Existing role" }]);
    const saved = await templates.create({ title: "New role" });
    expect(saved).toMatchObject({ title: "New role" });
    expect(await templates.list()).toHaveLength(2);
  } finally {
    await legacy.close();
  }
});


it("delivers a publish with the Portal user id and Staff name", async () => {
  const publisher = portal.signIn({ ...ada, id: "portal-user-42" }, ["Job Postings", "Applications", "Interviews", "Offers"]);
  const postings = jobPostingsFor(publisher, db);
  const draft = await postings.saveDraft(publishable);
  await postings.publish(draft.id);
  await retryJobPostingAnnouncements(db);
  expect(auditRequests.find((event) => event.action === "job_posting.published")).toMatchObject({
    actor: { type: "user", id: "portal-user-42", display_name: "Ada Okafor" },
  });
});

it("delivers Audit Events with the username fallback for each successful Staff action, never for views or refusals", async () => {
  const postings = jobPostingsFor(handle, db);
  const templates = jobTemplatesFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  await postings.editDraft(draft.id, { title: "Senior Recruiter" });
  await postings.publish(draft.id);
  await retryJobPostingAnnouncements(db);
  await postings.editOpen(draft.id, { title: "Recruiter" });
  await postings.close(draft.id);
  await expect(postings.close(draft.id)).rejects.toBeDefined();
  const filled = await postings.saveDraft(publishable);
  await postings.publish(filled.id);
  await retryJobPostingAnnouncements(db);
  await postings.markFilled(filled.id);
  const template = await templates.create({ title: "Recruiter" });
  await templates.edit(template.id, { title: "Senior Recruiter" });
  const copied = await templates.startPosting(template.id);
  await templates.delete(template.id);
  await postings.read(draft.id);
  await postings.list();
  await templates.list();
  expect(auditRequests.map((event) => event.action)).toEqual([
    "job_posting.created", "job_posting.updated", "job_posting.published", "job_posting.updated",
    "job_posting.closed", "job_posting.created", "job_posting.published", "job_posting.filled",
    "job_template.created", "job_template.updated", "job_posting.created", "job_template.deleted",
  ]);
  for (const event of auditRequests) {
    expect(event).toMatchObject({ source: "HRMS", module: "Job Postings", outcome: "success",
      actor: { type: "user", id: "ada", display_name: "Ada Okafor" }, customer_description: null,
      occurred_at: expect.any(String), idempotency_key: expect.any(String) });
  }
  expect(auditRequests[2].metadata).toEqual({ applicants_notified: true });
  expect(auditRequests[0].target).toEqual({ type: "job_posting", id: draft.id, display_name: "Recruiter" });
  expect(auditRequests[10].target).toEqual({ type: "job_posting", id: copied.id, display_name: "Senior Recruiter" });
  expect(auditRequests[11].target).toEqual({ type: "job_template", id: template.id, display_name: "Senior Recruiter" });
  expect(new Set(auditRequests.map((event) => event.idempotency_key)).size).toBe(12);
});

it("keeps a successful publish when audit fails and retries the identical event after a restart", async () => {
  const { retryJobPostingAuditDelivery } = await import("@/lib/job-postings");
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  const boundary = fetch;
  const attempts: unknown[] = [];
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).startsWith("https://gateway.test")) {
      attempts.push(JSON.parse(String(init?.body)));
      return Response.json({ error: "unavailable" }, { status: 503 });
    }
    return boundary(input, init);
  });
  try {
    expect(await postings.publish(draft.id)).toMatchObject({ status: "open" });
    await retryJobPostingAnnouncements(db);
    expect(await jobPostingsFor(handle, db).read(draft.id)).toMatchObject({ status: "open" });
    expect(log).toHaveBeenCalled();
    await db.query("UPDATE hrms_audit_outbox SET next_attempt_at = '2000-01-01'");
    vi.stubGlobal("fetch", boundary);
    await retryJobPostingAuditDelivery(db);
    expect(auditRequests.at(-1)).toEqual(attempts[0]);
    const count = auditRequests.length;
    await retryJobPostingAuditDelivery(db);
    expect(auditRequests).toHaveLength(count);
  } finally {
    log.mockRestore();
  }
});

it("round-trips nullable openings through templates, independent Draft copies and publication", async () => {
  const templates = jobTemplatesFor(handle, db);
  const postings = jobPostingsFor(handle, db);
  expect(await templates.create({})).toMatchObject({ openings: null });
  expect(await postings.saveDraft({})).toMatchObject({ openings: null });
  const template = await templates.create({ ...publishable, openings: 3 });
  expect(template.openings).toBe(3);
  expect(await templates.edit(template.id, { title: "Updated" })).toMatchObject({ openings: 3 });
  expect(await templates.edit(template.id, { openings: 5 })).toMatchObject({ openings: 5 });
  const draft = await templates.startPosting(template.id);
  expect(draft).toMatchObject({ openings: 5, status: "draft" });
  await templates.edit(template.id, { openings: null });
  expect(await templates.list()).toContainEqual(expect.objectContaining({ id: template.id, openings: null }));
  expect(await postings.read(draft.id)).toMatchObject({ openings: 5 });
  expect(await postings.editDraft(draft.id, { deadline: publishable.deadline })).toMatchObject({ openings: 5 });
  expect(await postings.publish(draft.id)).toMatchObject({ openings: 5 });
  expect(await postings.editOpen(draft.id, { openings: 2 })).toMatchObject({ openings: 2 });
  expect(await postings.list()).toContainEqual(expect.objectContaining({ id: draft.id, openings: 2 }));
  expect(await postings.editOpen(draft.id, { openings: null })).toMatchObject({ openings: null });
  expect(await postings.editDraft((await postings.saveDraft({ openings: 1 })).id, { openings: null }))
    .toMatchObject({ openings: null });
  expect(await templates.startPosting(template.id)).toMatchObject({ openings: null });
});

it.each([0, -1, 1.5, NaN, Infinity, 2_147_483_648, "3", true])("rejects invalid openings %s without changing postings or templates", async (value) => {
  // Model untrusted runtime inputs arriving at the server boundary.
  const fields = { openings: value } as unknown as Parameters<ReturnType<typeof jobPostingsFor>["saveDraft"]>[0];
  const postings = jobPostingsFor(handle, db);
  const templates = jobTemplatesFor(handle, db);
  const draft = await postings.saveDraft({ ...publishable, openings: 3 });
  const open = await postings.saveDraft({ ...publishable, openings: 4 });
  await postings.publish(open.id);
  const template = await templates.create({ openings: 5 });
  for (const operation of [() => postings.saveDraft(fields), () => postings.editDraft(draft.id, fields),
    () => postings.editOpen(open.id, fields), () => templates.create(fields), () => templates.edit(template.id, fields)]) {
    await expect(operation()).rejects.toMatchObject({ reason: "validation", fieldErrors: { openings: expect.any(String) } });
  }
  expect(await postings.read(draft.id)).toMatchObject({ openings: 3 });
  expect(await postings.read(open.id)).toMatchObject({ openings: 4 });
  expect(await templates.list()).toEqual([template]);
  expect(await postings.list()).toHaveLength(2);
});

it("migrates existing rows to unspecified openings and safely reapplies", async () => {
  const legacy = new PGlite();
  try {
    await legacy.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
    await legacy.exec(await readFile(new URL("../migrations/0001-job-posting-drafts.sql", import.meta.url), "utf8"));
    await legacy.exec(await readFile(new URL("../migrations/0002-job-templates.sql", import.meta.url), "utf8"));
    await legacy.exec(`INSERT INTO job_postings
      (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
      VALUES ('existing','Existing role','','','','','','[]','[]','draft');
      INSERT INTO job_templates (id) VALUES ('existing')`);
    const sql = await readFile(new URL("../migrations/0006-job-openings.sql", import.meta.url), "utf8");
    await legacy.exec(sql);
    await legacy.exec(sql);
    for (const table of ["job_postings", "job_templates"]) {
      expect((await legacy.query(`SELECT id, openings FROM ${table}`)).rows).toEqual([{ id: "existing", openings: null }]);
      await expect(legacy.query(`UPDATE ${table} SET openings = 0`)).rejects.toBeDefined();
      await legacy.query(`UPDATE ${table} SET openings = 2`);
    }
  } finally {
    await legacy.close();
  }
});

it("keeps monthly salary bounds through template copies, publication, omission and clearing", async () => {
  const templates = jobTemplatesFor(handle, db);
  const postings = jobPostingsFor(handle, db);
  expect(await postings.saveDraft({})).toMatchObject({ salaryFrom: null, salaryTo: null });
  expect(await templates.create({})).toMatchObject({ salaryFrom: null, salaryTo: null });
  const template = await templates.create({ ...publishable, salaryFrom: 20000.50, salaryTo: 30000 });
  expect(await templates.edit(template.id, { title: "Senior Recruiter" })).toMatchObject({ salaryFrom: 20000.50, salaryTo: 30000 });
  const draft = await templates.startPosting(template.id);
  expect(draft).toMatchObject({ salaryFrom: 20000.50, salaryTo: 30000 });
  await templates.edit(template.id, { salaryFrom: null, salaryTo: null });
  expect(await templates.startPosting(template.id)).toMatchObject({ salaryFrom: null, salaryTo: null });
  expect(await postings.editDraft(draft.id, { deadline: publishable.deadline })).toMatchObject({ salaryFrom: 20000.50, salaryTo: 30000 });
  expect(await postings.publish(draft.id)).toMatchObject({ salaryFrom: 20000.50, salaryTo: 30000 });
  expect(await postings.editOpen(draft.id, { salaryFrom: 30000 })).toMatchObject({ salaryFrom: 30000, salaryTo: 30000 });
  expect(await postings.list()).toContainEqual(expect.objectContaining({ id: draft.id, salaryFrom: 30000, salaryTo: 30000 }));
  expect(await postings.editOpen(draft.id, { salaryFrom: null })).toMatchObject({ salaryFrom: null, salaryTo: 30000 });
  expect(await postings.editOpen(draft.id, { salaryTo: null })).toMatchObject({ salaryFrom: null, salaryTo: null });
  expect(await templates.list()).toContainEqual(expect.objectContaining({ id: template.id, salaryFrom: null, salaryTo: null }));
  expect(await postings.read(draft.id)).toMatchObject({ salaryFrom: null, salaryTo: null });
});

it("rejects inverted salary ranges including one-bound edits without changing data or emitting audit events", async () => {
  const postings = jobPostingsFor(handle, db);
  const templates = jobTemplatesFor(handle, db);
  const draft = await postings.saveDraft({ ...publishable, salaryFrom: 20000, salaryTo: 30000 });
  const open = await postings.saveDraft({ ...publishable, salaryFrom: 20000, salaryTo: 30000 });
  await postings.publish(open.id);
  const template = await templates.create({ salaryFrom: 20000, salaryTo: 30000 });
  const before = auditRequests.length;
  for (const fields of [{ salaryFrom: 40000, salaryTo: 10000 }, { salaryFrom: 40000 }, { salaryTo: 10000 }]) {
    for (const action of [() => postings.editDraft(draft.id, fields), () => postings.editOpen(open.id, fields), () => templates.edit(template.id, fields)]) {
      await expect(action()).rejects.toMatchObject({ reason: "validation", fieldErrors: { salaryFrom: expect.any(String), salaryTo: expect.any(String) } });
    }
  }
  for (const action of [() => postings.saveDraft({ salaryFrom: 2, salaryTo: 1 }), () => templates.create({ salaryFrom: 2, salaryTo: 1 })]) {
    await expect(action()).rejects.toMatchObject({ reason: "validation", fieldErrors: { salaryTo: expect.any(String) } });
  }
  expect(auditRequests).toHaveLength(before);
  expect(await postings.read(draft.id)).toEqual(draft);
  expect(await postings.read(open.id)).toMatchObject({ salaryFrom: 20000, salaryTo: 30000 });
  expect(await templates.list()).toEqual([template]);
});

it.each([-1, NaN, Infinity, -Infinity, "20000", true])("rejects invalid salary bounds %s at every content write", async (value) => {
  const postings = jobPostingsFor(handle, db);
  const templates = jobTemplatesFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  const open = await postings.saveDraft(publishable);
  await postings.publish(open.id);
  const template = await templates.create({});
  for (const field of ["salaryFrom", "salaryTo"] as const) {
    const fields = { [field]: value } as Parameters<typeof postings.saveDraft>[0];
    for (const action of [() => postings.saveDraft(fields), () => postings.editDraft(draft.id, fields), () => postings.editOpen(open.id, fields), () => templates.create(fields), () => templates.edit(template.id, fields)]) {
      await expect(action()).rejects.toMatchObject({ reason: "validation", fieldErrors: { [field]: expect.any(String) } });
    }
  }
});

it("adds nullable salary bounds to existing Careers rows and safely reapplies constraints", async () => {
  await db.exec("ALTER TABLE job_postings DROP COLUMN salary_from, DROP COLUMN salary_to; ALTER TABLE job_templates DROP COLUMN salary_from, DROP COLUMN salary_to");
  await db.exec(`INSERT INTO job_postings
    (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
    VALUES ('legacy-salary','Existing role','','','','','','[]','[]','draft');
    INSERT INTO job_templates (id) VALUES ('legacy-salary')`);
  const sql = await readFile(new URL("../migrations/0007-job-salary-range.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.exec(sql);
  for (const table of ["job_postings", "job_templates"]) {
    expect((await db.query(`SELECT salary_from, salary_to FROM ${table}`)).rows).toEqual([{ salary_from: null, salary_to: null }]);
    await expect(db.exec(`UPDATE ${table} SET salary_from = 30000, salary_to = 20000`)).rejects.toBeDefined();
    for (const invalid of ["-1", "'NaN'", "'Infinity'"]) {
      await expect(db.exec(`UPDATE ${table} SET salary_from = ${invalid}`)).rejects.toBeDefined();
    }
    await db.exec(`UPDATE ${table} SET salary_from = 0, salary_to = 0`);
  }
});


it("keeps optional work schedules through template copies and posting lifecycle edits", async () => {
  const postings = jobPostingsFor(handle, db);
  const templates = jobTemplatesFor(handle, db);
  expect(await postings.saveDraft({})).toMatchObject({ workSchedule: null });
  expect(await templates.create({})).toMatchObject({ workSchedule: null });
  const schedule = "Monday–Friday\n9 AM–6 PM";
  const template = await templates.create({ ...publishable, workSchedule: schedule });
  expect(await templates.edit(template.id, { title: "Senior Recruiter" })).toMatchObject({ workSchedule: schedule });
  const draft = await templates.startPosting(template.id);
  expect(draft.workSchedule).toBe(schedule);
  await templates.edit(template.id, { workSchedule: "Weekends" });
  expect(await templates.list()).toContainEqual(expect.objectContaining({ id: template.id, workSchedule: "Weekends" }));
  expect(await postings.read(draft.id)).toMatchObject({ workSchedule: schedule });
  expect(await postings.editDraft(draft.id, { deadline: publishable.deadline })).toMatchObject({ workSchedule: schedule });
  expect(await postings.publish(draft.id)).toMatchObject({ workSchedule: schedule });
  expect(await postings.editOpen(draft.id, { workSchedule: "Flexible" })).toMatchObject({ workSchedule: "Flexible" });
  expect(await postings.list()).toContainEqual(expect.objectContaining({ id: draft.id, workSchedule: "Flexible" }));
  expect(await postings.editOpen(draft.id, { workSchedule: null })).toMatchObject({ workSchedule: null });
  expect(await templates.edit(template.id, { workSchedule: null })).toMatchObject({ workSchedule: null });
  expect(await templates.startPosting(template.id)).toMatchObject({ workSchedule: null });
  const direct = await postings.saveDraft({ workSchedule: schedule });
  expect(direct.workSchedule).toBe(schedule);
  expect(await postings.editDraft(direct.id, { workSchedule: null })).toMatchObject({ workSchedule: null });
});

it("adds unspecified work schedules to existing rows and safely reapplies", async () => {
  await db.exec("ALTER TABLE job_postings DROP COLUMN work_schedule; ALTER TABLE job_templates DROP COLUMN work_schedule");
  await db.exec("INSERT INTO job_postings (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status) VALUES ('legacy-schedule','','','','','','','[]','[]','draft'); INSERT INTO job_templates (id) VALUES ('legacy-schedule')");
  const sql = await readFile(new URL("../migrations/0008-job-work-schedule.sql", import.meta.url), "utf8");
  await db.exec(sql);
  await db.exec(sql);
  for (const table of ["job_postings", "job_templates"]) {
    expect((await db.query(`SELECT id, work_schedule FROM ${table}`)).rows).toEqual([{ id: "legacy-schedule", work_schedule: null }]);
  }
});

it("normalises default and custom Required Documents on every content write", async () => {
  const postings = jobPostingsFor(handle, db);
  const templates = jobTemplatesFor(handle, db);
  const input = [" Resume or CV ", "", "\t\n", " NBI clearance\u00a0", "resume OR cv", "nbi CLEARANCE", "Portfolio"];
  const expected = ["Resume or CV", "NBI clearance", "Portfolio"];
  const draft = await postings.saveDraft({ ...publishable, requiredDocuments: input });
  expect(draft.requiredDocuments).toEqual(expected);
  expect((await postings.editDraft(draft.id, { requiredDocuments: input })).requiredDocuments).toEqual(expected);
  // Simulate values written before normalisation existed; publishing has no field payload.
  await db.query("UPDATE job_postings SET required_documents = $1::jsonb WHERE id = $2", [JSON.stringify(input), draft.id]);
  expect((await postings.publish(draft.id)).requiredDocuments).toEqual(expected);
  expect((await postings.editOpen(draft.id, { requiredDocuments: input })).requiredDocuments).toEqual(expected);
  const template = await templates.create({ requiredDocuments: input });
  expect(template.requiredDocuments).toEqual(expected);
  expect((await templates.edit(template.id, { requiredDocuments: input })).requiredDocuments).toEqual(expected);
  await db.query("UPDATE job_templates SET required_documents = $1::jsonb WHERE id = $2", [JSON.stringify(input), template.id]);
  const copy = await templates.startPosting(template.id);
  expect(copy.requiredDocuments).toEqual(expected);
  expect((await templates.edit(template.id, { title: "Saved again" })).requiredDocuments).toEqual(expected);
  await templates.edit(template.id, { requiredDocuments: [] });
  expect((await postings.read(copy.id))?.requiredDocuments).toEqual(expected);
  expect((await templates.startPosting(template.id)).requiredDocuments).toEqual([]);
  expect((await postings.editOpen(draft.id, { requiredDocuments: [] })).requiredDocuments).toEqual([]);
});


it("creates and publishes directly with one publish Audit Event and one first announcement", async () => {
  const postings = jobPostingsFor(handle, db);
  const posting = await postings.createAndPublish({ ...publishable, requiredDocuments: [" CV ", "cv"], openings: 2, salaryFrom: 20000, workSchedule: "Flexible" });
  expect(posting).toMatchObject({ ...publishable, status: "open", firstPublishedAt: expect.any(Date), requiredDocuments: ["CV"], openings: 2, salaryFrom: 20000, salaryTo: null, workSchedule: "Flexible" });
  expect(await postings.read(posting.id)).toEqual(posting);
  expect((await db.query("SELECT payload->>'action' AS action FROM hrms_audit_outbox")).rows).toEqual([{ action: "job_posting.published" }]);
  expect((await db.query("SELECT posting_id FROM hrms_posting_announcements")).rows).toEqual([{ posting_id: posting.id }]);
  await retryJobPostingAnnouncements(db);
  await retryJobPostingAnnouncements(db);
  expect(auditRequests).toHaveLength(1);
  expect(auditRequests[0]).toMatchObject({ action: "job_posting.published", metadata: { applicants_notified: true } });
  await postings.editOpen(posting.id, { title: "Updated" });
  expect((await db.query("SELECT posting_id FROM hrms_posting_announcements")).rows).toHaveLength(1);
});


it("reports every invalid direct-publication field and leaves no posting or delivery records", async () => {
  const postings = jobPostingsFor(handle, db);
  await expect(postings.createAndPublish({ title: " ", deadline: new Date("invalid"), openings: 0, salaryFrom: -1, salaryTo: -2 })).rejects.toMatchObject({
    reason: "validation", fieldErrors: Object.fromEntries(["title", "department", "employmentType", "location", "description", "deadline", "openings", "salaryFrom", "salaryTo"].map((field) => [field, expect.any(String)])),
  });
  expect(await postings.list()).toEqual([]);
  expect((await db.query("SELECT * FROM hrms_audit_outbox")).rows).toEqual([]);
  expect((await db.query("SELECT * FROM hrms_posting_announcements")).rows).toEqual([]);
});

it("rolls direct publication back when announcement queuing fails", async () => {
  await db.exec("ALTER TABLE hrms_posting_announcements ADD CONSTRAINT reject_queue CHECK (false)");
  await expect(jobPostingsFor(handle, db).createAndPublish(publishable)).rejects.toBeDefined();
  expect(await jobPostingsFor(handle, db).list()).toEqual([]);
  expect((await db.query("SELECT * FROM hrms_audit_outbox")).rows).toEqual([]);
});

it("rechecks Portal access before direct publication", async () => {
  for (const state of ["denied", "invalid", "unavailable"] as const) {
    portal.unavailable = state === "unavailable";
    const restricted = jobPostingsFor(state === "denied" ? portal.signIn(ada, ["Training"]) : state === "invalid" ? undefined : handle, db);
    await expect(restricted.createAndPublish(publishable)).rejects.toMatchObject({ reason: state });
  }
  portal.unavailable = false;
  expect(await jobPostingsFor(handle, db).list()).toEqual([]);
});

it.each([null, new Date("2000-01-01"), new Date("invalid")])("refuses a missing, past or invalid direct-publication deadline (%s)", async (deadline) => {
  await expect(jobPostingsFor(handle, db).createAndPublish({ ...publishable, deadline })).rejects.toMatchObject({ reason: "validation", fieldErrors: { deadline: expect.any(String) } });
  expect(await jobPostingsFor(handle, db).list()).toEqual([]);
});


it.each(["saveDraft", "createAndPublish"] as const)("%s saves a named independent template atomically", async (operation) => {
  const lists = { responsibilities: ["Recruit Staff"], benefits: ["Paid leave"] };
  const posting = await jobPostingsFor(handle, db)[operation]({ ...publishable, ...lists }, { saveAsTemplate: { name: "  Recruitment base  " } });
  const [template] = await jobTemplatesFor(handle, db).list();
  expect(template).toMatchObject({ ...lists, name: "Recruitment base", title: publishable.title });
  expect(template.id).not.toBe(posting.id);
  expect(template).not.toHaveProperty("deadline");
  expect(template).not.toHaveProperty("status");
  expect(template).not.toHaveProperty("firstPublishedAt");
  const draft = await jobTemplatesFor(handle, db).startPosting(template.id);
  expect(draft).toMatchObject({ ...publishable, ...lists, deadline: null, status: "draft", firstPublishedAt: null });
});


it.each(["saveDraft", "createAndPublish"] as const)("%s refuses a blank template name without saving either row", async (operation) => {
  for (const name of [undefined, "", " \t "] ) {
    await expect(jobPostingsFor(handle, db)[operation](publishable, { saveAsTemplate: { name } }))
      .rejects.toMatchObject({ reason: "validation", fieldErrors: { templateName: expect.any(String) } });
  }
  expect(await jobPostingsFor(handle, db).list()).toEqual([]);
  expect(await jobTemplatesFor(handle, db).list()).toEqual([]);
  expect(auditRequests).toEqual([]);
});

it.each(["saveDraft", "createAndPublish"] as const)("%s rolls back the posting when template persistence fails", async (operation) => {
  await db.exec("ALTER TABLE job_templates ADD CONSTRAINT reject_template CHECK (false)");
  await expect(jobPostingsFor(handle, db)[operation](publishable, { saveAsTemplate: { name: "Base" } })).rejects.toBeDefined();
  expect(await jobPostingsFor(handle, db).list()).toEqual([]);
  expect(await jobTemplatesFor(handle, db).list()).toEqual([]);
  expect((await db.query("SELECT * FROM hrms_audit_outbox")).rows).toEqual([]);
  expect((await db.query("SELECT * FROM hrms_posting_announcements")).rows).toEqual([]);
  expect(auditRequests).toEqual([]);
});


it.each(["editDraft", "publish"] as const)("%s saves a named template from an existing Draft", async (operation) => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  const options = { saveAsTemplate: { name: "Existing draft base" } };
  const saved = operation === "publish" ? await postings.publish(draft.id, options)
    : await postings.editDraft(draft.id, { title: "Updated role" }, options);
  const [template] = await jobTemplatesFor(handle, db).list();
  expect(template).toMatchObject({ name: "Existing draft base", title: saved.title });
  expect(template.id).not.toBe(draft.id);
});

it.each(["editDraft", "publish"] as const)("%s preserves the original Draft on invalid name or template failure", async (operation) => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  const submit = (name: string) => operation === "publish"
    ? postings.publish(draft.id, { saveAsTemplate: { name } })
    : postings.editDraft(draft.id, { title: "Changed" }, { saveAsTemplate: { name } });
  await expect(submit(" ")).rejects.toMatchObject({ fieldErrors: { templateName: expect.any(String) } });
  await db.exec("ALTER TABLE job_templates ADD CONSTRAINT reject_template CHECK (false)");
  await expect(submit("Base")).rejects.toBeDefined();
  expect(await postings.read(draft.id)).toEqual(draft);
  expect(await jobTemplatesFor(handle, db).list()).toEqual([]);
  expect((await db.query("SELECT * FROM hrms_posting_announcements")).rows).toEqual([]);
});


it("round-trips Responsibilities and Benefits when saving a Draft", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({
    title: "Recruiter", responsibilities: ["Interview Applicants", "Write reports"], benefits: ["Health cover"],
  });
  expect(draft).toMatchObject({ responsibilities: ["Interview Applicants", "Write reports"], benefits: ["Health cover"] });
  expect(await jobPostingsFor(handle, db).read(draft.id)).toEqual(draft);
  expect(await postings.list()).toEqual([{ ...draft, applicantCount: 0 }]);
});


it.each(["editDraft", "editOpen"] as const)("%s patches, preserves and clears Responsibilities and Benefits independently", async (operation) => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({ ...publishable, responsibilities: ["Interview"], benefits: ["Health cover"] });
  if (operation === "editOpen") await postings.publish(draft.id);
  expect(await postings[operation](draft.id, { responsibilities: ["Train Staff"], benefits: ["Paid leave"] }))
    .toMatchObject({ responsibilities: ["Train Staff"], benefits: ["Paid leave"] });
  expect(await postings[operation](draft.id, { title: "Senior Recruiter", responsibilities: undefined, benefits: undefined }))
    .toMatchObject({ responsibilities: ["Train Staff"], benefits: ["Paid leave"] });
  expect(await postings[operation](draft.id, { responsibilities: [] }))
    .toMatchObject({ responsibilities: [], benefits: ["Paid leave"] });
  expect(await postings[operation](draft.id, { responsibilities: ["Welcome Applicants"], benefits: [] }))
    .toMatchObject({ responsibilities: ["Welcome Applicants"], benefits: [] });
  expect(await postings.read(draft.id)).toMatchObject({ responsibilities: ["Welcome Applicants"], benefits: [] });
});


it("publishes with omitted or explicitly empty Responsibilities and Benefits", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft(publishable);
  expect(await postings.publish(draft.id)).toMatchObject({ status: "open", responsibilities: [], benefits: [] });
  const direct = await postings.createAndPublish({ ...publishable, responsibilities: [], benefits: [] });
  expect(direct).toMatchObject({ status: "open", responsibilities: [], benefits: [] });
  expect(await postings.editOpen(direct.id, { title: "Updated role" })).toMatchObject({ responsibilities: [], benefits: [] });
});

it("round-trips Template lists and copies them independently to Drafts", async () => {
  const templates = jobTemplatesFor(handle, db);
  const postings = jobPostingsFor(handle, db);
  const lists = { responsibilities: ["Serve customers", "Close shop"], benefits: ["Paid leave", "Meals"] };
  const template = await templates.create(lists);
  expect(template).toMatchObject(lists);
  expect(await jobTemplatesFor(handle, db).list()).toEqual([template]);
  const draft = await templates.startPosting(template.id);
  expect(draft).toMatchObject({ ...lists, status: "draft", deadline: null });
  await postings.editDraft(draft.id, { responsibilities: ["One-off duty"], benefits: [] });
  expect(await templates.list()).toEqual([template]);
  const edited = await templates.edit(template.id, { responsibilities: [], benefits: ["Insurance"] });
  expect(edited).toMatchObject({ responsibilities: [], benefits: ["Insurance"] });
  expect(await templates.edit(template.id, {})).toEqual(edited);
  expect(await postings.read(draft.id)).toMatchObject({ responsibilities: ["One-off duty"], benefits: [] });
  expect(await templates.startPosting(template.id)).toMatchObject({ responsibilities: [], benefits: ["Insurance"] });
});


it("adds empty lists to existing Templates and can reapply the migration", async () => {
  await db.exec("ALTER TABLE job_templates DROP COLUMN responsibilities, DROP COLUMN benefits; INSERT INTO job_templates (id, title) VALUES ('legacy-lists', 'Cashier')");
  const migration = await readFile(new URL("../migrations/0010-job-template-lists.sql", import.meta.url), "utf8");
  await db.exec(migration);
  await db.exec(migration);
  expect(await jobTemplatesFor(handle, db).list()).toMatchObject([{ id: "legacy-lists", title: "Cashier", responsibilities: [], benefits: [] }]);
});

it("recovers legacy Audit Events with their original time, key and username only once", async () => {
  const { retryJobPostingAuditDelivery } = await import("@/lib/job-postings");
  const legacy = {
    source: "HRMS", module: "Job Postings", action: "job_template.created", outcome: "success",
    actor: { type: "staff", id: "ada", display_name: "Ada Okafor" },
    occurred_at: "2026-10-28T06:53:53.006Z", idempotency_key: "legacy-template-created",
    description: "Ada Okafor performed job_template.created.", customer_description: null,
    target: { type: "job_template", id: "template-1", display_name: "Recruiter" },
  };
  await db.query(`INSERT INTO hrms_audit_outbox (id, payload, attempts, next_attempt_at)
    VALUES ($1, $2, 3, '2000-01-01')`, [legacy.idempotency_key, JSON.stringify(legacy)]);
  await retryJobPostingAuditDelivery(db);
  expect(auditRequests).toEqual([legacy]);
  expect((await db.query("SELECT count(*)::int AS count FROM hrms_audit_outbox")).rows).toEqual([{ count: 0 }]);
  await retryJobPostingAuditDelivery(db);
  expect(auditRequests).toHaveLength(1);
});

it("retains a recovered Audit Event after rejection without resetting its retry backoff", async () => {
  const { retryJobPostingAuditDelivery } = await import("@/lib/job-postings");
  const event = {
    source: "HRMS", action: "job_template.updated", actor: { type: "staff", id: "ada" },
    occurred_at: "2026-10-28T10:08:54.057Z", idempotency_key: "legacy-template-updated",
  };
  await db.query(`INSERT INTO hrms_audit_outbox (id, payload) VALUES ($1, $2)`,
    [event.idempotency_key, JSON.stringify(event)]);
  const boundary = fetch;
  const rejected: unknown[] = [];
  vi.stubGlobal("fetch", async (_input: unknown, init?: RequestInit) => {
    rejected.push(JSON.parse(String(init?.body)));
    return Response.json({ error: "unavailable" }, { status: 503 });
  });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await retryJobPostingAuditDelivery(db);
    const retained = await db.query("SELECT * FROM hrms_audit_outbox");
    expect(retained.rows).toHaveLength(1);
    await retryJobPostingAuditDelivery(db);
    expect((await db.query("SELECT * FROM hrms_audit_outbox")).rows).toEqual(retained.rows);
    expect(rejected).toEqual([event]);
    vi.stubGlobal("fetch", boundary);
    await db.query("UPDATE hrms_audit_outbox SET next_attempt_at = '2000-01-01'");
    await retryJobPostingAuditDelivery(db);
    expect(auditRequests).toEqual(rejected);
    expect((await db.query("SELECT count(*)::int AS count FROM hrms_audit_outbox")).rows).toEqual([{ count: 0 }]);
  } finally {
    log.mockRestore();
  }
});

it("opens Job Postings and templates to the Job Postings Module alone", async () => {
  for (const holder of ["Applications", "Interviews", "Offers"]) {
    const handle = portal.signIn(ada, [holder]);
    await expect(jobPostingsFor(handle, db).list()).rejects.toMatchObject({ reason: "denied" });
    await expect(jobTemplatesFor(handle, db).list()).rejects.toMatchObject({ reason: "denied" });
  }
  const allowed = portal.signIn(ada, ["Job Postings"]);
  await expect(jobPostingsFor(allowed, db).list()).resolves.toBeDefined();
  await expect(jobTemplatesFor(allowed, db).list()).resolves.toBeDefined();
});
