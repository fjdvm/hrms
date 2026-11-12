import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { jobPostingsFor, jobTemplatesFor, retryJobPostingAnnouncements, retryJobPostingAuditDelivery } from "@/lib/job-postings";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let handle: string;
let sends: { path: string; body: Record<string, unknown>; key: string | null }[];
let fail = false;
let auditFailure: "rejected" | "network" | undefined;
beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  for (const name of ["0001-job-posting-drafts", "0002-job-templates", "0003-job-posting-audit", "0004-job-posting-announcements", "0005-job-posting-first-published", "0006-job-openings", "0007-job-salary-range", "0008-job-work-schedule", "0009-job-template-name", "0010-job-template-lists"]) {
    await db.exec(await readFile(new URL(`../migrations/${name}.sql`, import.meta.url), "utf8"));
  }
  await db.exec(`CREATE SCHEMA neon_auth;
    CREATE TABLE neon_auth."user" (id text PRIMARY KEY, email text, "emailVerified" boolean);
    CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, job_alerts_opt_in boolean NOT NULL DEFAULT false);
    INSERT INTO neon_auth."user" VALUES ('yes','yes@example.test',true), ('no','no@example.test',true),
      ('unverified','unverified@example.test',false), ('no-profile','missing@example.test',false);
    INSERT INTO applicant_profiles VALUES ('yes',true), ('no',false), ('unverified',true);`);
  const portal = new FakePortal();
  handle = portal.signIn({ name: "Ada", username: "ada", email: "ada@example.test", role: "HR Officer" }, ["Job Postings", "Applications", "Interviews", "Offers"]);
  const boundary = portalFetch(portal);
  sends = [];
  fail = false;
  auditFailure = undefined;
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "hrms-key");
  vi.stubEnv("CAREERS_URL", "https://careers.test");
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).startsWith("https://gateway.test")) return boundary(input, init);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer hrms-key");
    sends.push({ path: new URL(String(input)).pathname, body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get("idempotency-key") });
    if (String(input).endsWith("/audit/events")) {
      if (auditFailure === "network") throw new Error("Audit service unreachable");
      if (fail || auditFailure === "rejected") return Response.json({ error: "unavailable" }, { status: 503 });
      return Response.json({ id: "accepted" }, { status: 201 });
    }
    return Response.json({}, { status: fail ? 503 : 202 });
  });
});
afterEach(async () => { await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("announces only the first publish to every registered Applicant and emails only Verified opt-ins", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({ title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") });
  await postings.publish(draft.id);
  await retryJobPostingAnnouncements(db);
  const emails = sends.filter(s => s.path === "/notifications/emails/app");
  expect(emails.map(s => s.body.to)).toEqual(["yes@example.test"]);
  expect(emails[0].body).toMatchObject({ app: "careers", button: { link: `https://careers.test/careers/${draft.id}` } });
  const inbox = sends.filter(s => s.path === "/notifications/notifications");
  expect(inbox.flatMap(s => s.body.userIds).sort()).toEqual(["no", "no-profile", "unverified", "yes"]);
  expect(inbox[0].body).toMatchObject({ sendingApp: "hrms", targetApp: "careers", type: "job-posting.opened", link: `https://careers.test/careers/${draft.id}`, idempotencyKey: expect.any(String) });
  expect(sends.find(s => s.body.action === "job_posting.published")?.body.metadata).toEqual({ applicants_notified: true });
  expect((await db.query("SELECT announced_at FROM job_postings WHERE id=$1", [draft.id])).rows[0]).toMatchObject({ announced_at: expect.any(Date) });
  const count = sends.filter(s => s.path.startsWith("/notifications")).length;
  await expect(postings.publish(draft.id)).rejects.toMatchObject({ reason: "not-draft" });
  await postings.editOpen(draft.id, { title: "Senior Recruiter" });
  await postings.close(draft.id);
  await retryJobPostingAnnouncements(db);
  expect(sends.filter(s => s.path.startsWith("/notifications"))).toHaveLength(count);
});

it("publishes during gateway failure, retries stable payloads after restart and completes the original audit once", async () => {
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({ title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") });
  sends = [];
  fail = true;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await postings.publish(draft.id)).toMatchObject({ status: "open" });
    expect(sends).toEqual([]); // No gateway I/O on publish.
    await retryJobPostingAnnouncements(db);
    const attempts = [...sends];
    expect(attempts).toHaveLength(5);
    expect((await db.query("SELECT announced_at FROM job_postings WHERE id=$1", [draft.id])).rows[0]).toEqual({ announced_at: null });
    expect(sends.some(s => s.body.action === "job_posting.published")).toBe(false);
    // New registrations never expand an already snapshotted audience.
    await db.exec(`INSERT INTO neon_auth."user" VALUES ('later','later@example.test',true);
      UPDATE hrms_announcement_deliveries SET next_attempt_at = '2000-01-01';`);
    fail = false;
    sends = [];
    await Promise.all([retryJobPostingAnnouncements(db), retryJobPostingAnnouncements(db)]);
    for (const attempt of attempts) {
      expect(attempt.key).toBeTruthy();
      expect(sends).toContainEqual(attempt);
    }
    expect(sends.filter(s => s.path.startsWith('/notifications')).every(s => attempts.some(a => a.key === s.key && JSON.stringify(a.body) === JSON.stringify(s.body)))).toBe(true);
    const audits = sends.filter(s => s.body.action === "job_posting.published");
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(new Set(audits.map(s => s.body.idempotency_key)).size).toBe(1);
    expect(audits[0].body.metadata).toEqual({ applicants_notified: true });
    sends = [];
    await retryJobPostingAnnouncements(db);
    expect(sends).toEqual([]);
  } finally { log.mockRestore(); }
});

it("does not announce historical Open postings or mark a failed audience lookup complete", async () => {
  await db.exec(`INSERT INTO job_postings (id,title,department,employment_type,location,description,requirements,required_documents,screening_criteria,deadline,status)
    VALUES ('historical','Existing','People','Full time','Manila','Hire','','[]','[]','2030-01-01','open')`);
  await retryJobPostingAnnouncements(db);
  expect(sends).toEqual([]);
  const postings = jobPostingsFor(handle, db);
  const draft = await postings.saveDraft({ title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") });
  await postings.publish(draft.id);
  await db.exec('ALTER TABLE neon_auth."user" RENAME TO unavailable');
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try { await retryJobPostingAnnouncements(db); } finally { log.mockRestore(); }
  expect((await db.query("SELECT announced_at FROM job_postings WHERE id=$1", [draft.id])).rows[0]).toEqual({ announced_at: null });
  await db.exec('ALTER TABLE neon_auth.unavailable RENAME TO "user"');
  await retryJobPostingAnnouncements(db);
  expect(sends.filter(s => s.path === "/notifications/notifications")).toHaveLength(4);
});

it("keeps announcing later postings when twenty earlier announcements cannot complete", async () => {
  const postings = jobPostingsFor(handle, db);
  const fields = { title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") };
  for (let i = 0; i < 20; i++) {
    const draft = await postings.saveDraft(fields);
    await postings.publish(draft.id);
  }
  fail = true;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    // All earlier audiences exist, but none of their deliveries can finish.
    await retryJobPostingAnnouncements(db);
    await retryJobPostingAnnouncements(db);
    const later = await postings.saveDraft({ ...fields, title: "New opening" });
    await postings.publish(later.id);
    sends = [];
    fail = false;
    await retryJobPostingAnnouncements(db);
    expect(sends.filter(s => s.body.title === "New Job Posting: New opening")).toHaveLength(5);
  } finally { log.mockRestore(); }
});


it.each(["draft", "direct"] as const)("queues one published event for %s publication and clears it on acceptance", async (mode) => {
  const postings = jobPostingsFor(handle, db);
  const fields = { title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") };
  const posting = mode === "direct"
    ? await postings.createAndPublish(fields)
    : await postings.publish((await postings.saveDraft(fields)).id);
  const queued = await db.query<{ id: string; payload: Record<string, unknown> }>("SELECT id, payload FROM hrms_audit_outbox");
  expect(queued.rows).toHaveLength(1);
  expect(queued.rows[0].payload).toMatchObject({
    source: "HRMS", module: "Job Postings", action: "job_posting.published", outcome: "success",
    target: { type: "job_posting", id: posting.id, display_name: "Recruiter" },
    idempotency_key: queued.rows[0].id, metadata: { applicants_notified: false },
  });
  expect(sends.filter(s => s.body.action === "job_posting.published")).toEqual([]);
  await retryJobPostingAnnouncements(db);
  const audits = sends.filter(s => s.body.action === "job_posting.published");
  expect(audits).toHaveLength(1);
  expect(audits[0].body).toEqual({ ...queued.rows[0].payload, metadata: { applicants_notified: true } });
  expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
  await retryJobPostingAnnouncements(db);
  expect(sends.filter(s => s.body.action === "job_posting.published")).toHaveLength(1);
});

it.each(["rejected", "network"] as const)("retains a committed publish after %s audit delivery and clears it on retry", async (failure) => {
  const postings = jobPostingsFor(handle, db);
  const posting = await postings.createAndPublish({ title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") });
  auditFailure = failure;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await retryJobPostingAnnouncements(db);
    expect(await postings.read(posting.id)).toMatchObject({ status: "open" });
    const attempts = sends.filter(s => s.body.action === "job_posting.published");
    expect(attempts).toHaveLength(1);
    expect(attempts[0].body.metadata).toEqual({ applicants_notified: true });
    expect((await db.query("SELECT payload, attempts FROM hrms_audit_outbox")).rows).toEqual([
      { payload: attempts[0].body, attempts: 1 },
    ]);
    const notifications = sends.filter(s => s.path.startsWith("/notifications"));
    await retryJobPostingAnnouncements(db);
    expect(sends.filter(s => s.body.action === "job_posting.published")).toHaveLength(1);
    auditFailure = undefined;
    await db.exec("UPDATE hrms_audit_outbox SET next_attempt_at = '2000-01-01'");
    await retryJobPostingAnnouncements(db);
    expect(sends.filter(s => s.body.action === "job_posting.published")).toEqual([attempts[0], attempts[0]]);
    expect(sends.filter(s => s.path.startsWith("/notifications"))).toEqual(notifications);
    expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
    expect(await postings.read(posting.id)).toMatchObject({ status: "open" });
  } finally { log.mockRestore(); }
});


it.each([
  ["close", "closed", "job_posting.closed"],
  ["markFilled", "filled", "job_posting.filled"],
] as const)("queues %s with its own action and clears the outbox on acceptance", async (method, status, action) => {
  const postings = jobPostingsFor(handle, db);
  const posting = await postings.createAndPublish({ title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") });
  await retryJobPostingAnnouncements(db);
  sends = [];
  auditFailure = "rejected";
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    expect(await postings[method](posting.id)).toMatchObject({ status });
    expect(await jobPostingsFor(handle, db).read(posting.id)).toMatchObject({ status });
    expect(sends).toHaveLength(1);
    const attempt = sends[0];
    expect(attempt.path).toBe("/audit/events");
    expect(attempt.body).toMatchObject({
      source: "HRMS", module: "Job Postings", action, outcome: "success",
      actor: { type: "user", id: "ada", display_name: "Ada" },
      target: { type: "job_posting", id: posting.id, display_name: "Recruiter" },
      idempotency_key: expect.any(String),
    });
    expect(attempt.body).not.toHaveProperty("metadata");
    expect((await db.query("SELECT id, payload, attempts FROM hrms_audit_outbox")).rows).toEqual([
      { id: attempt.body.idempotency_key, payload: attempt.body, attempts: 1 },
    ]);
    await retryJobPostingAuditDelivery(db);
    expect(sends).toEqual([attempt]);
    auditFailure = undefined;
    await db.exec("UPDATE hrms_audit_outbox SET next_attempt_at = '2000-01-01'");
    await retryJobPostingAuditDelivery(db);
    expect(sends).toEqual([attempt, attempt]);
    expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
    await retryJobPostingAuditDelivery(db);
    await expect(postings[method](posting.id)).rejects.toMatchObject({ reason: "not-open" });
    expect(sends).toEqual([attempt, attempt]);
    expect(await postings.read(posting.id)).toMatchObject({ status });
  } finally { log.mockRestore(); }
});

it.each([
  ["close", "job_posting.closed"],
  ["markFilled", "job_posting.filled"],
] as const)("delivers %s immediately when the audit gateway accepts it", async (method, action) => {
  const postings = jobPostingsFor(handle, db);
  const posting = await postings.createAndPublish({ title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") });
  await retryJobPostingAnnouncements(db);
  sends = [];
  await postings[method](posting.id);
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ path: "/audit/events", body: { action } });
  expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
  await retryJobPostingAuditDelivery(db);
  expect(sends).toHaveLength(1);
});

it.each(["saveDraft", "editDraft", "editOpen"] as const)("delivers %s with its own action and clears the outbox on acceptance", async (method) => {
  const postings = jobPostingsFor(handle, db);
  const fields = { title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") };
  const existing = method === "editDraft" ? await postings.saveDraft(fields)
    : method === "editOpen" ? await postings.createAndPublish(fields) : undefined;
  await retryJobPostingAnnouncements(db);
  sends = [];
  const saved = method === "saveDraft" ? await postings.saveDraft({ title: "Senior Recruiter" })
    : await postings[method](existing!.id, { title: "Senior Recruiter" });
  expect(await jobPostingsFor(handle, db).read(saved.id)).toMatchObject({ title: "Senior Recruiter", status: method === "editOpen" ? "open" : "draft" });
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ path: "/audit/events", body: {
    source: "HRMS", module: "Job Postings", outcome: "success",
    action: method === "saveDraft" ? "job_posting.created" : "job_posting.updated",
    actor: { type: "user", id: "ada", display_name: "Ada" },
    target: { type: "job_posting", id: saved.id, display_name: "Senior Recruiter" },
    idempotency_key: expect.any(String), occurred_at: expect.any(String),
  } });
  expect(sends[0].body).not.toHaveProperty("metadata");
  expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
  await retryJobPostingAuditDelivery(db);
  await retryJobPostingAnnouncements(db);
  expect(sends).toHaveLength(1);
});

it.each([
  ["saveDraft", "rejected"], ["saveDraft", "network"],
  ["editDraft", "rejected"], ["editDraft", "network"],
  ["editOpen", "rejected"], ["editOpen", "network"],
] as const)("retains %s after %s audit failure and clears the identical event on retry", async (method, failure) => {
  const postings = jobPostingsFor(handle, db);
  const fields = { title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") };
  const existing = method === "editDraft" ? await postings.saveDraft(fields)
    : method === "editOpen" ? await postings.createAndPublish(fields) : undefined;
  await retryJobPostingAnnouncements(db);
  sends = [];
  auditFailure = failure;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const saved = method === "saveDraft" ? await postings.saveDraft({ title: "Senior Recruiter" })
      : await postings[method](existing!.id, { title: "Senior Recruiter" });
    expect(await jobPostingsFor(handle, db).read(saved.id)).toMatchObject({ title: "Senior Recruiter", status: method === "editOpen" ? "open" : "draft" });
    expect(sends).toHaveLength(1);
    const attempt = sends[0];
    expect(attempt).toMatchObject({ path: "/audit/events", body: {
      action: method === "saveDraft" ? "job_posting.created" : "job_posting.updated",
      target: { type: "job_posting", id: saved.id, display_name: "Senior Recruiter" },
      idempotency_key: expect.any(String),
    } });
    expect((await db.query("SELECT id, payload, attempts FROM hrms_audit_outbox")).rows).toEqual([
      { id: attempt.body.idempotency_key, payload: attempt.body, attempts: 1 },
    ]);
    await retryJobPostingAuditDelivery(db);
    expect(sends).toEqual([attempt]);
    auditFailure = undefined;
    await db.exec("UPDATE hrms_audit_outbox SET next_attempt_at = '2000-01-01'");
    await retryJobPostingAuditDelivery(db);
    expect(sends).toEqual([attempt, attempt]);
    expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
    await retryJobPostingAuditDelivery(db);
    expect(sends).toEqual([attempt, attempt]);
    expect(await postings.read(saved.id)).toEqual(saved);
  } finally { log.mockRestore(); }
});


it.each(["direct", "saveDraft", "editDraft", "createAndPublish", "publish"] as const)("queues Job Template creation through %s and clears both events after acceptance", async (mode) => {
  const postings = jobPostingsFor(handle, db);
  const templates = jobTemplatesFor(handle, db);
  const fields = { title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") };
  const draft = mode === "editDraft" || mode === "publish" ? await postings.saveDraft(fields) : undefined;
  sends = [];
  auditFailure = "rejected";
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const options = { saveAsTemplate: { name: "Recruitment base" } };
    const saved = mode === "direct" ? await templates.create(fields)
      : mode === "publish" ? await postings.publish(draft!.id, options)
      : mode === "editDraft" ? await postings.editDraft(draft!.id, fields, options)
      : await postings[mode](fields, options);
    const [template] = await jobTemplatesFor(handle, db).list();
    expect(template).toMatchObject({ title: "Recruiter" });
    const queued = (await db.query<{ id: string; payload: Record<string, unknown> }>("SELECT id, payload FROM hrms_audit_outbox")).rows;
    expect(queued).toHaveLength(mode === "direct" ? 1 : 2);
    const event = queued.find(row => row.payload.action === "job_template.created")!;
    expect(event.payload).toMatchObject({
      source: "HRMS", module: "Job Postings", action: "job_template.created", outcome: "success",
      actor: { type: "user", id: "ada", display_name: "Ada" },
      target: { type: "job_template", id: template.id, display_name: "Recruiter" },
      occurred_at: expect.any(String), idempotency_key: event.id,
    });
    expect(event.payload).not.toHaveProperty("metadata");
    if (mode !== "direct") {
      expect(template.id).not.toBe(saved.id);
      expect(queued.find(row => row.id !== event.id)?.payload).toMatchObject({
        action: mode === "publish" || mode === "createAndPublish" ? "job_posting.published"
          : mode === "editDraft" ? "job_posting.updated" : "job_posting.created",
        target: { type: "job_posting", id: saved.id },
      });
    }
    const attempt = sends.find(send => send.body.action === "job_template.created")!;
    expect(attempt).toMatchObject({ path: "/audit/events", body: event.payload });
    await retryJobPostingAuditDelivery(db);
    expect(sends.filter(send => send.body.action === "job_template.created")).toEqual([attempt]);
    auditFailure = undefined;
    await db.exec("UPDATE hrms_audit_outbox SET next_attempt_at = '2000-01-01'");
    await retryJobPostingAnnouncements(db);
    await retryJobPostingAuditDelivery(db);
    expect(sends.filter(send => send.body.action === "job_template.created")).toEqual([attempt, attempt]);
    expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
    const acceptedCount = sends.length;
    await retryJobPostingAnnouncements(db);
    await retryJobPostingAuditDelivery(db);
    expect(sends).toHaveLength(acceptedCount);
    expect(await jobTemplatesFor(handle, db).list()).toEqual([template]);
  } finally { log.mockRestore(); }
});


it.each(["direct", "saveDraft", "editDraft", "createAndPublish", "publish"] as const)("delivers %s Job Template creation immediately when accepted", async (mode) => {
  const postings = jobPostingsFor(handle, db);
  const fields = { title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") };
  const draft = mode === "editDraft" || mode === "publish" ? await postings.saveDraft(fields) : undefined;
  sends = [];
  const options = { saveAsTemplate: { name: "Recruitment base" } };
  if (mode === "direct") await jobTemplatesFor(handle, db).create(fields);
  else if (mode === "publish") await postings.publish(draft!.id, options);
  else if (mode === "editDraft") await postings.editDraft(draft!.id, fields, options);
  else await postings[mode](fields, options);
  const [template] = await jobTemplatesFor(handle, db).list();
  const templates = sends.filter(send => send.body.action === "job_template.created");
  expect(templates).toHaveLength(1);
  expect(templates[0]).toMatchObject({ path: "/audit/events", body: {
    target: { type: "job_template", id: template.id, display_name: "Recruiter" },
  } });
  await retryJobPostingAnnouncements(db);
  expect(sends.filter(send => send.path === "/audit/events")).toHaveLength(mode === "direct" ? 1 : 2);
  expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
  const count = sends.length;
  await retryJobPostingAuditDelivery(db);
  expect(sends).toHaveLength(count);
});

it.each(["edit", "delete"] as const)("delivers Job Template %s with its own action and clears the outbox on acceptance", async (method) => {
  const templates = jobTemplatesFor(handle, db);
  const template = await templates.create({ title: "Recruiter" });
  sends = [];
  if (method === "edit") await templates.edit(template.id, { title: "Senior Recruiter" });
  else await templates.delete(template.id);
  expect(await jobTemplatesFor(handle, db).list()).toEqual(method === "edit"
    ? [expect.objectContaining({ id: template.id, title: "Senior Recruiter" })] : []);
  expect(sends).toHaveLength(1);
  expect(sends[0]).toMatchObject({ path: "/audit/events", body: {
    source: "HRMS", module: "Job Postings", outcome: "success",
    action: method === "edit" ? "job_template.updated" : "job_template.deleted",
    actor: { type: "user", id: "ada", display_name: "Ada" },
    target: { type: "job_template", id: template.id, display_name: method === "edit" ? "Senior Recruiter" : "Recruiter" },
    idempotency_key: expect.any(String), occurred_at: expect.any(String),
  } });
  expect(sends[0].body).not.toHaveProperty("metadata");
  expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
  await retryJobPostingAuditDelivery(db);
  expect(sends).toHaveLength(1);
});

it.each([
  ["edit", "rejected"], ["edit", "network"],
  ["delete", "rejected"], ["delete", "network"],
] as const)("retains Job Template %s after %s audit failure and clears the identical event on retry", async (method, failure) => {
  const templates = jobTemplatesFor(handle, db);
  const template = await templates.create({ title: "Recruiter" });
  sends = [];
  auditFailure = failure;
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    if (method === "edit") await templates.edit(template.id, { title: "Senior Recruiter" });
    else await templates.delete(template.id);
    expect(await jobTemplatesFor(handle, db).list()).toEqual(method === "edit"
      ? [expect.objectContaining({ id: template.id, title: "Senior Recruiter" })] : []);
    expect(sends).toHaveLength(1);
    const attempt = sends[0];
    expect(attempt).toMatchObject({ path: "/audit/events", body: {
      action: method === "edit" ? "job_template.updated" : "job_template.deleted",
      target: { type: "job_template", id: template.id, display_name: method === "edit" ? "Senior Recruiter" : "Recruiter" },
      idempotency_key: expect.any(String),
    } });
    expect((await db.query("SELECT id, payload, attempts FROM hrms_audit_outbox")).rows).toEqual([
      { id: attempt.body.idempotency_key, payload: attempt.body, attempts: 1 },
    ]);
    await retryJobPostingAuditDelivery(db);
    expect(sends).toEqual([attempt]);
    auditFailure = undefined;
    await db.exec("UPDATE hrms_audit_outbox SET next_attempt_at = '2000-01-01'");
    await retryJobPostingAuditDelivery(db);
    expect(sends).toEqual([attempt, attempt]);
    expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
    await retryJobPostingAuditDelivery(db);
    expect(sends).toEqual([attempt, attempt]);
  } finally { log.mockRestore(); }
});

it.each(["edit", "delete"] as const)("does not queue a Job Template %s event for denied or missing targets", async (method) => {
  const templates = jobTemplatesFor(handle, db);
  const template = await templates.create({ title: "Recruiter" });
  sends = [];
  const denied = jobTemplatesFor(undefined, db);
  if (method === "edit") {
    await expect(denied.edit(template.id, { title: "Changed" })).rejects.toBeDefined();
    await expect(templates.edit("missing", { title: "Changed" })).rejects.toMatchObject({ reason: "not-found" });
    await expect(templates.edit(template.id, { openings: 0 })).rejects.toMatchObject({ reason: "validation" });
  } else {
    await expect(denied.delete(template.id)).rejects.toBeDefined();
    await expect(templates.delete("missing")).rejects.toMatchObject({ reason: "not-found" });
  }
  expect(await templates.list()).toEqual([template]);
  expect(sends).toEqual([]);
  expect((await db.query("SELECT id FROM hrms_audit_outbox")).rows).toEqual([]);
});

it("announces to Neon UUID identities joined to Careers text profiles", async () => {
  await db.exec(`TRUNCATE neon_auth."user", applicant_profiles;
    ALTER TABLE neon_auth."user" ALTER COLUMN id TYPE uuid USING id::uuid;
    INSERT INTO neon_auth."user" VALUES
      ('00000000-0000-4000-8000-000000000001','verified@example.test',true),
      ('00000000-0000-4000-8000-000000000002','unverified@example.test',false),
      ('00000000-0000-4000-8000-000000000003','opted-out@example.test',true),
      ('00000000-0000-4000-8000-000000000004','no-profile@example.test',true);
    INSERT INTO applicant_profiles VALUES
      ('00000000-0000-4000-8000-000000000001',true),
      ('00000000-0000-4000-8000-000000000002',true),
      ('00000000-0000-4000-8000-000000000003',false);`);
  const postings = jobPostingsFor(handle, db);
  const posting = await postings.createAndPublish({ title: "Recruiter", department: "People", employmentType: "Full time", location: "Manila", description: "Hire Staff", deadline: new Date("2030-01-01") });
  await retryJobPostingAnnouncements(db);
  expect(sends.filter(s => s.path === "/notifications/notifications").flatMap(s => s.body.userIds).sort()).toEqual([
    "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002",
    "00000000-0000-4000-8000-000000000003", "00000000-0000-4000-8000-000000000004",
  ]);
  expect(sends.filter(s => s.path === "/notifications/emails/app").map(s => s.body.to)).toEqual(["verified@example.test"]);
  expect(sends.find(s => s.body.action === "job_posting.published")?.body.metadata).toEqual({ applicants_notified: true });
  const deliveries = [...sends];
  await retryJobPostingAnnouncements(db);
  expect(sends).toEqual(deliveries);
  expect((await postings.read(posting.id))?.status).toBe("open");
});
