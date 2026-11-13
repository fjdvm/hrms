import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { accountRequestStatusFor } from "@/lib/account-request-status";
import { employeesFor } from "@/lib/employees";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let clock: Date;
const staff = { id: "u-1", name: "Ada Manager", username: "ada", email: "ada@example.test", role: "HRMS Manager" };
const sign = (role = "HRMS Manager", modules = ["Employee Onboarding"]) => portal.signIn({ ...staff, role }, modules);
const employees = (session = sign()) => employeesFor(session, db, undefined, () => clock);
const hoursLater = (hours: number) => { clock = new Date(clock.getTime() + hours * 3600_000); };
const input = (over: Record<string, unknown> = {}) => ({ workEmail: "maria.santos@brenraphaels.ph", roleId: "role-officer", moduleIds: ["m-applications"], ...over });
const one = async <T,>(sql: string) => (await db.query<T>(sql)).rows[0];
const request = (reference = "RQ-0001") => one<{ status: string; last_reminder_at: Date | null }>(`SELECT status, last_reminder_at FROM hrms_account_requests WHERE reference = '${reference}'`);
const events = async (status: string, reference = "RQ-0001") => (await db.query<{ actor_name: string; occurred_at: Date }>(
  `SELECT e.actor_name, e.occurred_at FROM hrms_account_request_events e JOIN hrms_account_requests r ON r.id = e.request_id WHERE r.reference = '${reference}' AND e.status = '${status}' ORDER BY e.id`)).rows;
const setStatus = (status: string) => db.exec(`UPDATE hrms_account_requests SET status = '${status}' WHERE reference = 'RQ-0001'`);

beforeEach(async () => {
  clock = new Date("2026-11-13T02:00:00Z");
  db = new PGlite();
  for (const fixture of ["careers-job-postings.sql", "careers-applications.sql"]) await db.exec(await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text, email text)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((n) => n.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  portal = new FakePortal();
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  await db.exec(`INSERT INTO hrms_offers (application_id,monthly_salary,start_date,employment_type,schedule,probation,reports_to,branch,created_by_name)
    VALUES (-1,19000,'2026-12-01','Full-time','Mon-Fri','6 months','Liza','Cainta','Ada');
    INSERT INTO hrms_employees (employee_number,offer_id,application_id,full_name,email,position,branch,start_date,monthly_salary,employment_type,schedule,probation,reports_to,hired_by_name)
    VALUES ('BR-EMP-0001',1,-1,'Maria Santos','maria.personal@example.test','Cashier','Cainta','2026-12-01',19000,'Full-time','Mon-Fri','6 months','Liza','Ada')`);
  await employees().requestAccount(1, input()); // RQ-0001, requested
});
afterEach(async () => { await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("lets only Super Admin and HRMS Manager remind or cancel, and refuses everyone else before touching the Portal", async () => {
  for (const [who, session] of [["HR Officer", sign("HR Officer")], ["no Module", sign("Super Admin", ["Employee Information"])], ["unknown", "unknown"]] as const) {
    const reason = who === "unknown" ? "invalid" : "denied";
    await expect(employees(session).remindAccountRequest("RQ-0001")).rejects.toMatchObject({ reason });
    await expect(employees(session).cancelAccountRequest("RQ-0001")).rejects.toMatchObject({ reason });
  }
  expect(portal.reminders).toEqual([]);
  expect(portal.cancellations).toEqual([]);
  expect(await events("reminded")).toEqual([]);
  expect(await events("cancelled")).toEqual([]);
  await expect(employees(sign("Super Admin")).remindAccountRequest("RQ-0001")).resolves.toMatchObject({ reference: "RQ-0001" });
});

it("reminds the Portal while Requested or Seen, records who and when, and allows one reminder per 24 hours", async () => {
  const first = await employees().remindAccountRequest("RQ-0001");
  expect(first).toEqual({ reference: "RQ-0001", remindedAt: "2026-11-13T02:00:00.000Z" });
  expect(portal.reminders).toEqual(["RQ-0001"]);
  expect(await events("reminded")).toEqual([{ actor_name: "Ada Manager", occurred_at: new Date("2026-11-13T02:00:00Z") }]);
  expect((await request()).last_reminder_at).toEqual(new Date("2026-11-13T02:00:00Z"));
  hoursLater(23.9);
  await expect(employees().remindAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "too-soon", detail: { retryAt: "2026-11-14T02:00:00.000Z" } });
  expect(portal.reminders).toHaveLength(1);
  expect(await events("reminded")).toHaveLength(1);
  await setStatus("seen");
  hoursLater(0.1); // exactly 24 hours after the first
  await expect(employees().remindAccountRequest("RQ-0001")).resolves.toMatchObject({ remindedAt: "2026-11-14T02:00:00.000Z" });
  expect(portal.reminders).toEqual(["RQ-0001", "RQ-0001"]);
  expect((await events("reminded")).map((e) => e.occurred_at.toISOString())).toEqual(["2026-11-13T02:00:00.000Z", "2026-11-14T02:00:00.000Z"]);
});

it("sends one reminder when it is clicked twice at once", async () => {
  const results = await Promise.allSettled([employees().remindAccountRequest("RQ-0001"), employees().remindAccountRequest("RQ-0001")]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { reason: "too-soon" } });
  expect(portal.reminders).toEqual(["RQ-0001"]);
  expect(await events("reminded")).toHaveLength(1);
});

it("keeps reminder events from clashing with the Portal's status events", async () => {
  await employees().remindAccountRequest("RQ-0001");
  hoursLater(25);
  await employees().remindAccountRequest("RQ-0001");
  const webhook = accountRequestStatusFor(db);
  await webhook.receive({ reference: "RQ-0001", status: "seen", actor: "Admin", occurredAt: "2026-11-14T05:00:00Z" });
  await webhook.receive({ reference: "RQ-0001", status: "seen", actor: "Admin", occurredAt: "2026-11-14T05:00:00Z" });
  expect(await events("seen")).toHaveLength(1);
  expect(await events("reminded")).toHaveLength(2);
});

it("refuses remind and cancel once the request is no longer open, without telling the Portal", async () => {
  for (const status of ["account_created", "login_sent", "cancelled", "declined"]) {
    await setStatus(status);
    await expect(employees().remindAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "conflict", detail: { status } });
    await expect(employees().cancelAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "conflict", detail: { status } });
  }
  expect(portal.reminders).toEqual([]);
  expect(portal.cancellations).toEqual([]);
  expect((await request()).last_reminder_at).toBeNull();
  await expect(employees().remindAccountRequest("rq-1")).rejects.toMatchObject({ reason: "validation" });
  await expect(employees().cancelAccountRequest(undefined as never)).rejects.toMatchObject({ reason: "validation" });
  await expect(employees().remindAccountRequest("RQ-0099")).rejects.toMatchObject({ reason: "not-found" });
  await expect(employees().cancelAccountRequest("RQ-0099")).rejects.toMatchObject({ reason: "not-found" });
});

it("does not use up the day's reminder when the Portal could not be told", async () => {
  portal.unavailable = true;
  await expect(employees().remindAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "unavailable" });
  portal.unavailable = false;
  portal.actionStatus = 500;
  await expect(employees().remindAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "unavailable" });
  portal.actionStatus = null;
  expect((await request()).last_reminder_at).toBeNull();
  expect(await events("reminded")).toEqual([]);
  vi.stubGlobal("fetch", (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/remind")) throw new Error("socket hang up");
    return portalFetch(portal)(input, init);
  }) as typeof fetch);
  await expect(employees().remindAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "unavailable" });
  vi.stubGlobal("fetch", portalFetch(portal));
  expect((await request()).last_reminder_at).toBeNull();
  await expect(employees().remindAccountRequest("RQ-0001")).resolves.toMatchObject({ reference: "RQ-0001" });
});

it("cancels with the Portal's agreement, records who and when, and then allows a new request with a new reference", async () => {
  hoursLater(1);
  expect(await employees().cancelAccountRequest("RQ-0001")).toEqual({ reference: "RQ-0001", status: "cancelled" });
  expect(portal.cancellations).toEqual(["RQ-0001"]);
  expect((await request()).status).toBe("cancelled");
  expect(await events("cancelled")).toEqual([{ actor_name: "Ada Manager", occurred_at: new Date("2026-11-13T03:00:00Z") }]);
  await accountRequestStatusFor(db).receive({ reference: "RQ-0001", status: "cancelled", actor: "Portal Admin", occurredAt: "2026-11-13T03:00:05Z" }); // the Portal's own echo
  expect(await events("cancelled")).toHaveLength(1);
  const page = await employees().onboarding();
  expect(page.rows[0]).toMatchObject({ accountState: "Not requested", actions: ["request", "no-account-needed"] });
  await expect(employees().requestAccount(1, input())).resolves.toMatchObject({ reference: "RQ-0002" });
  await expect(employees().remindAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "conflict", detail: { status: "cancelled" } });
});

it("cancels a Seen request too", async () => {
  await setStatus("seen");
  await expect(employees().cancelAccountRequest("RQ-0001")).resolves.toMatchObject({ status: "cancelled" });
  expect(portal.cancellations).toEqual(["RQ-0001"]);
});

it("leaves the request as it was, and says so, when the Portal cannot be told to cancel", async () => {
  portal.unavailable = true;
  await expect(employees().cancelAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "unavailable" });
  portal.unavailable = false;
  portal.actionStatus = 503;
  await expect(employees().cancelAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "unavailable" });
  portal.actionStatus = null;
  expect((await request()).status).toBe("requested");
  expect(await events("cancelled")).toEqual([]);
});

it("resolves a cancel that races an admin to the Portal's answer: the account wins and the requester is told", async () => {
  portal.requestStates["RQ-0001"] = "account_created";
  await expect(employees().cancelAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "conflict", detail: { status: "account_created" } });
  expect((await request()).status).toBe("account_created");
  expect(await events("cancelled")).toEqual([]);
  expect((await events("account_created"))[0].actor_name).toBe("Portal");
  expect((await db.query(`SELECT 1 FROM hrms_staff_notifications WHERE id = 'account-request.account_created:RQ-0001'`)).rows).toHaveLength(1);
  const page = await employees().onboarding();
  expect(page.rows[0]).toMatchObject({ accountState: "Account created", actions: [] });
});

it("resolves a remind that races an admin the same way, and gives the reminder back", async () => {
  portal.requestStates["RQ-0001"] = "login_sent";
  await expect(employees().remindAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "conflict", detail: { status: "login_sent" } });
  expect((await request()).status).toBe("login_sent");
  expect((await request()).last_reminder_at).toBeNull();
  expect(await events("reminded")).toEqual([]);
});

it("resolves to the account when an admin creates it between HRMS's check and its own cancel being recorded", async () => {
  portal.beforeAction = async () => { await accountRequestStatusFor(db).receive({ reference: "RQ-0001", status: "account_created", actor: "Admin One", occurredAt: "2026-11-13T02:00:00Z" }); };
  await expect(employees().cancelAccountRequest("RQ-0001")).rejects.toMatchObject({ reason: "conflict", detail: { status: "account_created" } });
  expect((await request()).status).toBe("account_created");
  expect(await events("cancelled")).toEqual([]);
});
