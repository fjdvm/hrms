import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/portal/account-requests/status/route";
import { database } from "@/lib/database";
import { employeesFor } from "@/lib/employees";
import { deliverStaffNotifications } from "@/lib/staff-notifications";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

const afterCallbacks = vi.hoisted(() => [] as (() => Promise<void>)[]);
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (callback: () => Promise<void>) => { afterCallbacks.push(callback); } }));

let db: PGlite;
let portal: FakePortal;
let sends: { body: Record<string, unknown>; key: string | null }[];

/** What the Portal sends: Bearer system secret, JSON body. */
const deliver = (body: unknown, authorization: string | null = `Bearer ${FAKE_SECRET}`) => POST(new Request("https://hrms.test/api/portal/account-requests/status", {
  method: "POST", headers: { ...(authorization ? { authorization } : {}), "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body),
}));
const status = (reference: string, state: string, extra: Record<string, unknown> = {}) =>
  ({ reference, status: state, actor: "Portal Admin", occurredAt: "2026-11-20T01:00:00Z", ...extra });
const one = async <T,>(sql: string) => (await db.query<T>(sql)).rows[0];
const requestRow = (reference = "RQ-0001") => one<Record<string, unknown>>(`SELECT * FROM hrms_account_requests WHERE reference = '${reference}'`);
const events = async (reference = "RQ-0001") => (await db.query<{ status: string; actor_name: string; reason: string | null; message: string | null; occurred_at: Date }>(
  `SELECT e.status, e.actor_name, e.reason, e.message, e.occurred_at FROM hrms_account_request_events e JOIN hrms_account_requests r ON r.id = e.request_id WHERE r.reference = '${reference}' ORDER BY e.id`)).rows;
const queued = async () => (await db.query<{ id: string; payload: Record<string, unknown> }>(`SELECT id, payload FROM hrms_staff_notifications WHERE id LIKE 'account-request.%' ORDER BY id`)).rows;

beforeEach(async () => {
  afterCallbacks.length = 0;
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((n) => n.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  await db.exec(`INSERT INTO hrms_offers (application_id,monthly_salary,start_date,employment_type,schedule,probation,reports_to,branch,created_by_name)
    VALUES (-1,19000,'2026-12-01','Full-time','Mon-Fri','6 months','Liza','Cainta','Ada');
    INSERT INTO hrms_employees (employee_number,offer_id,application_id,full_name,email,position,branch,start_date,monthly_salary,employment_type,schedule,probation,reports_to,hired_by_name)
    -- A far start date keeps these tests about the webhook alone: the Active rule (#345) has its own tests.
    VALUES ('BR-EMP-0001',1,-1,'Maria Santos','maria.personal@example.test','Cashier','Cainta','2099-12-01',19000,'Full-time','Mon-Fri','6 months','Liza','Ada');
    INSERT INTO hrms_account_requests (employee_id,status,work_email,portal_role,access_needed_from,personal_email,requester_id,requester_name)
    VALUES (1,'requested','maria@brenraphaels.ph','HR Officer','2026-12-01','maria.personal@example.test','user-9','Ada Manager');
    INSERT INTO hrms_account_request_events (request_id,status,actor_name) VALUES (1,'requested','Ada Manager')`);
  portal = new FakePortal();
  sends = [];
  const boundary = portalFetch(portal);
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (!String(input).startsWith("https://gateway.test")) return boundary(input, init);
    sends.push({ body: JSON.parse(String(init?.body)), key: new Headers(init?.headers).get("idempotency-key") });
    return Response.json({}, { status: 202 });
  });
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("API_GATEWAY_URL", "https://gateway.test");
  vi.stubEnv("API_GATEWAY_KEY", "hrms-key");
  vi.spyOn(database, "query").mockImplementation((sql, values) => db.query(sql, values));
});
afterEach(async () => { vi.restoreAllMocks(); await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("refuses a missing, wrong or unset secret and changes nothing", async () => {
  expect((await deliver(status("RQ-0001", "seen"), null)).status).toBe(401);
  expect((await deliver(status("RQ-0001", "seen"), "Bearer wrong-secret")).status).toBe(401);
  expect((await deliver(status("RQ-0001", "seen"), `Basic ${FAKE_SECRET}`)).status).toBe(401);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", "");
  expect((await deliver(status("RQ-0001", "seen"), "Bearer ")).status).toBe(401);
  expect((await deliver(status("RQ-0001", "seen"), `Bearer ${FAKE_SECRET}`)).status).toBe(401);
  expect((await requestRow()).status).toBe("requested");
  expect(await events()).toHaveLength(1);
});

it("refuses an unknown reference and an invalid delivery", async () => {
  expect((await deliver(status("RQ-0099", "seen"))).status).toBe(404);
  expect((await deliver("not json")).status).toBe(400);
  expect((await deliver([1])).status).toBe(400);
  for (const bad of [status("rq-1", "seen"), status("RQ-0001", "requested"), status("RQ-0001", "approved"), status("RQ-0001", "seen", { actor: "" }),
    status("RQ-0001", "seen", { actor: undefined }), status("RQ-0001", "seen", { occurredAt: "yesterday" }), status("RQ-0001", "seen", { occurredAt: 5 }),
    status("RQ-0001", "seen", { occurredAt: "0001-01-01T00:00:00Z" }), status("RQ-0001", "declined", { reason: 5 }), status("RQ-0001", "declined", { reason: "x".repeat(501) }),
    status("RQ-0001", "declined", { message: "" })]) {
    expect((await deliver(bad)).status).toBe(400);
  }
  expect((await requestRow()).status).toBe("requested");
  expect(await events()).toHaveLength(1);
  expect(afterCallbacks).toHaveLength(0);
});

it("records seen with its actor and time, once, however often it is delivered", async () => {
  expect((await deliver(status("RQ-0001", "seen", { actor: "Admin One", occurredAt: "2026-11-20T02:30:00Z" }))).status).toBe(200);
  expect((await deliver(status("RQ-0001", "seen", { actor: "Admin Two", occurredAt: "2026-11-21T00:00:00Z" }))).status).toBe(200);
  expect((await requestRow()).status).toBe("seen");
  const seen = (await events()).filter((e) => e.status === "seen");
  expect(seen).toHaveLength(1);
  expect(seen[0]).toMatchObject({ actor_name: "Admin One" });
  expect(seen[0].occurred_at.toISOString()).toBe("2026-11-20T02:30:00.000Z");
  expect(await queued()).toEqual([]);
});

it("moves to account created, records who and when, and tells the requester once through the existing outbox and gateway", async () => {
  await deliver(status("RQ-0001", "seen"));
  expect((await deliver(status("RQ-0001", "account_created", { actor: "Admin One", occurredAt: "2026-11-20T03:00:00Z" }))).status).toBe(200);
  expect((await deliver(status("RQ-0001", "account_created", { actor: "Admin One", occurredAt: "2026-11-20T03:00:00Z" }))).status).toBe(200);
  const row = await requestRow();
  expect(row).toMatchObject({ status: "account_created", account_created_by: "Admin One" });
  expect((row.account_created_at as Date).toISOString()).toBe("2026-11-20T03:00:00.000Z");
  expect((await events()).map((e) => e.status)).toEqual(["requested", "seen", "account_created"]);
  const notices = await queued();
  expect(notices).toHaveLength(1);
  expect(notices[0].payload).toMatchObject({ type: "account-request.account_created", title: "Account created: Maria Santos", link: "/employee-onboarding#employee-1", recipientIds: ["user-9"] });
  expect(afterCallbacks).toHaveLength(3); // delivery is kicked off after each accepted response
  await deliverStaffNotifications(database);
  expect(sends).toHaveLength(1);
  expect(sends[0].body).toMatchObject({ userIds: ["user-9"], title: "Account created: Maria Santos", sendingApp: "HRMS", targetApp: "HRMS" });
  expect(sends[0].body).not.toHaveProperty("recipientIds");
  expect(sends[0].key).toBe("account-request.account_created:RQ-0001");
  const page = await employeesFor(portal.signIn({ name: "Ada", username: "ada", email: "a@example.test", role: "HRMS Manager" }, ["Employee Onboarding"]), database).onboarding();
  expect(page.rows[0]).toMatchObject({ accountState: "Account created", accountCreatedBy: "Admin One", accountCreatedAt: "2026-11-20T03:00:00.000Z" });
});

it("tolerates out-of-order delivery: login sent first, a late seen, and never moves backwards", async () => {
  await deliver(status("RQ-0001", "login_sent", { actor: "System", occurredAt: "2026-11-20T04:00:00Z" }));
  expect((await requestRow()).status).toBe("login_sent");
  expect(await queued()).toEqual([]);
  await deliver(status("RQ-0001", "account_created", { actor: "Admin One", occurredAt: "2026-11-20T03:00:00Z" }));
  await deliver(status("RQ-0001", "seen", { occurredAt: "2026-11-20T02:00:00Z" }));
  const row = await requestRow();
  expect(row).toMatchObject({ status: "login_sent", account_created_by: "Admin One" });
  expect((await events()).map((e) => e.status).sort()).toEqual(["account_created", "login_sent", "requested", "seen"]);
  expect(await queued()).toHaveLength(1);
});

it("records a cancel, and a decline with its reason and message, and tells the requester about the decline", async () => {
  await deliver(status("RQ-0001", "seen"));
  expect((await deliver(status("RQ-0001", "cancelled", { actor: "Ada Manager", reason: "ignored", message: "ignored" }))).status).toBe(200);
  expect(await requestRow()).toMatchObject({ status: "cancelled" });
  expect((await events()).find((e) => e.status === "cancelled")).toMatchObject({ actor_name: "Ada Manager", reason: null, message: null });
  expect(await queued()).toEqual([]);
  await db.exec(`UPDATE hrms_account_requests SET status = 'requested' WHERE id = 1; DELETE FROM hrms_account_request_events WHERE status IN ('seen','cancelled')`);
  await deliver(status("RQ-0001", "declined", { actor: "Admin One", reason: "Wrong role", message: "Please request Cashier." }));
  await deliver(status("RQ-0001", "declined", { actor: "Admin One", reason: "Wrong role", message: "Please request Cashier." }));
  expect(await requestRow()).toMatchObject({ status: "declined" });
  expect((await events()).find((e) => e.status === "declined")).toMatchObject({ actor_name: "Admin One", reason: "Wrong role", message: "Please request Cashier." });
  const notices = await queued();
  expect(notices).toHaveLength(1);
  expect(notices[0].payload).toMatchObject({ type: "account-request.declined", title: "Account request declined: Maria Santos", body: expect.stringContaining("Wrong role"), recipientIds: ["user-9"] });
  await db.exec(`INSERT INTO hrms_account_requests (employee_id,status,work_email,portal_role,access_needed_from,personal_email,requester_id,requester_name)
    VALUES (1,'requested','maria2@brenraphaels.ph','HR Officer','2026-12-01','p@example.test','user-9','Ada Manager')`);
  expect((await one<{ n: number }>(`SELECT count(*)::int AS n FROM hrms_account_requests WHERE status = 'requested'`)).n).toBe(1);
});

it("lets an account that exists win over a cancel or decline, in either order", async () => {
  await deliver(status("RQ-0001", "account_created", { actor: "Admin One" }));
  await deliver(status("RQ-0001", "cancelled", { actor: "Ada Manager" }));
  await deliver(status("RQ-0001", "declined", { actor: "Admin Two", reason: "late" }));
  expect(await requestRow()).toMatchObject({ status: "account_created" });
  expect((await events()).map((e) => e.status)).toEqual(["requested", "account_created"]);
  expect((await queued()).map((n) => n.payload.type)).toEqual(["account-request.account_created"]);
  await db.exec(`UPDATE hrms_account_requests SET status = 'cancelled', account_created_at = NULL, account_created_by = NULL; DELETE FROM hrms_account_request_events WHERE status = 'account_created'; DELETE FROM hrms_staff_notifications`);
  await deliver(status("RQ-0001", "account_created", { actor: "Admin One" }));
  expect(await requestRow()).toMatchObject({ status: "account_created", account_created_by: "Admin One" });
  expect((await queued()).map((n) => n.payload.type)).toEqual(["account-request.account_created"]);
});

it("still answers 200 and records the step when moving an old request would clash with the person's new active request", async () => {
  await db.exec(`UPDATE hrms_account_requests SET status = 'cancelled';
    INSERT INTO hrms_account_requests (employee_id,status,work_email,portal_role,access_needed_from,personal_email,requester_id,requester_name)
    VALUES (1,'requested','maria2@brenraphaels.ph','HR Officer','2026-12-01','p@example.test','user-9','Ada Manager')`);
  expect((await deliver(status("RQ-0001", "account_created", { actor: "Admin One" }))).status).toBe(200);
  expect(await requestRow("RQ-0001")).toMatchObject({ status: "cancelled" });
  expect((await events("RQ-0001")).map((e) => e.status)).toContain("account_created");
  expect(await requestRow("RQ-0002")).toMatchObject({ status: "requested" });
});

it("answers a failure of its own as unavailable so the Portal retries", async () => {
  vi.spyOn(database, "query").mockRejectedValue(new Error("connection lost"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await deliver(status("RQ-0001", "seen"))).status).toBe(503);
});

it("delivers a notification that names its recipient without asking the Portal for an audience, and keeps module notifications as before", async () => {
  portal.unavailable = true; // an audience lookup would fail
  await deliver(status("RQ-0001", "account_created"));
  await deliverStaffNotifications(database);
  expect(sends).toHaveLength(1);
  expect((await one<{ delivered_at: Date | null }>(`SELECT delivered_at FROM hrms_staff_notifications WHERE id LIKE 'account-request.%'`)).delivered_at).not.toBeNull();
});
