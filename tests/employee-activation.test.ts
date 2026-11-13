import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { employeeActivationJob, activateDue } from "@/lib/employee-activation";
import { accountRequestStatusFor } from "@/lib/account-request-status";
import { employeesFor } from "@/lib/employees";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
const at = (iso: string) => () => new Date(iso);
// Manila is UTC+8: 2026-11-30T16:00Z is the first instant of 1 December in Manila.
const BEFORE_START = "2026-11-30T15:59:59Z";
const START_DAY = "2026-11-30T16:00:00Z";
const staff = { id: "u-1", name: "Ada Manager", username: "ada", email: "ada@example.test" };
const sign = (role = "HRMS Manager") => portal.signIn({ ...staff, role }, ["Employee Onboarding"]);
const employees = (role?: string, now = at(START_DAY)) => employeesFor(sign(role), db, undefined, now);
const one = async <T,>(sql: string) => (await db.query<T>(sql)).rows[0];
const status = async (id = 1) => (await one<{ status: string }>(`SELECT status FROM hrms_employees WHERE id = ${id}`)).status;
const notices = async () => (await db.query<{ id: string; payload: Record<string, unknown> }>(`SELECT id, payload FROM hrms_staff_notifications WHERE id LIKE 'employee.active:%' ORDER BY id`)).rows;
const audit = async () => (await db.query<{ actor_name: string; kind: string; field: string; old_value: unknown; new_value: unknown }>(
  `SELECT actor_name, kind, field, old_value, new_value FROM hrms_employee_audit WHERE employee_id = 1 AND field IN ('status','no_account_needed_at') ORDER BY id`)).rows;
const setRequest = (state: string) => db.exec(`UPDATE hrms_account_requests SET status = '${state}' WHERE employee_id = 1`);
const webhook = (state: string, now = at(START_DAY)) => accountRequestStatusFor(db, now).receive({ reference: "RQ-0001", status: state, actor: "Portal Admin", occurredAt: "2026-11-20T03:00:00Z" });

beforeEach(async () => {
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
  vi.stubEnv("CRON_SECRET", "cron-secret");
  await db.exec(`INSERT INTO hrms_offers (application_id,monthly_salary,start_date,employment_type,schedule,probation,reports_to,branch,created_by_name)
    VALUES (-1,19000,'2026-12-01','Full-time','Mon-Fri','6 months','Liza','Cainta','Ada');
    INSERT INTO hrms_employees (employee_number,offer_id,application_id,full_name,email,position,branch,start_date,monthly_salary,employment_type,schedule,probation,reports_to,hired_by_name)
    VALUES ('BR-EMP-0001',1,-1,'Maria Santos','maria.personal@example.test','Cashier','Cainta','2026-12-01',19000,'Full-time','Mon-Fri','6 months','Liza','Ada');
    INSERT INTO hrms_account_requests (employee_id,status,work_email,portal_role,access_needed_from,personal_email,requester_id,requester_name)
    VALUES (1,'requested','maria@brenraphaels.ph','HR Officer','2026-12-01','maria.personal@example.test','user-9','Ada Manager');
    INSERT INTO hrms_account_request_events (request_id,status,actor_name) VALUES (1,'requested','Ada Manager')`);
});
afterEach(async () => { await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("account first, then the start date: Active on the start date itself, not the day before, and the requester is told by System", async () => {
  await webhook("account_created", at("2026-11-20T00:00:00Z"));
  expect(await status()).toBe("Onboarding");
  expect(await activateDue(db, at(BEFORE_START))).toBe(0);
  expect(await status()).toBe("Onboarding");
  expect(await activateDue(db, at(START_DAY))).toBe(1);
  expect(await status()).toBe("Active");
  expect(await audit()).toEqual([{ actor_name: "System", kind: "status", field: "status", old_value: "Onboarding", new_value: "Active" }]);
  const [notice] = await notices();
  expect(notice.id).toBe("employee.active:1");
  expect(notice.payload).toMatchObject({ type: "employee.active", title: "Maria Santos is now Active", recipientIds: ["user-9"] });
});

it("login sent counts as an account too", async () => {
  await setRequest("login_sent");
  expect(await activateDue(db, at(START_DAY))).toBe(1);
  expect(await status()).toBe("Active");
});

it("start date first, then the account: the webhook that reports the account makes the person Active at once", async () => {
  await webhook("seen", at("2026-12-05T00:00:00Z"));
  expect(await status()).toBe("Onboarding");
  await webhook("account_created", at("2026-12-05T00:00:00Z"));
  expect(await status()).toBe("Active");
  expect((await notices()).map((n) => n.payload.recipientIds)).toEqual([["user-9"]]);
  // a repeat delivery changes nothing and tells nobody twice
  await webhook("account_created", at("2026-12-06T00:00:00Z"));
  expect(await notices()).toHaveLength(1);
  expect((await audit()).filter((r) => r.field === "status")).toHaveLength(1);
});

it("the webhook before the start date leaves the person Onboarding until the job runs on the start date", async () => {
  await webhook("account_created", at("2026-11-20T00:00:00Z"));
  expect(await status()).toBe("Onboarding");
  const job = employeeActivationJob(db, at(START_DAY), async () => {});
  expect(await (await job(new Request("https://hrms.test/api/cron/employee-activation", { headers: { authorization: "Bearer cron-secret" } }))).json()).toEqual({ ok: true, activated: 1 });
  expect(await status()).toBe("Active");
});

it("no account: a start date that passes leaves the person Onboarding and flagged", async () => {
  await db.exec(`DELETE FROM hrms_account_request_events; DELETE FROM hrms_account_requests`);
  expect(await activateDue(db, at("2026-12-10T00:00:00Z"))).toBe(0);
  await setRequest("requested");
  expect(await status()).toBe("Onboarding");
  const page = await employees("HRMS Manager", at("2026-12-10T00:00:00Z")).onboarding();
  expect(page.rows[0]).toMatchObject({ accountState: "Not requested", overdue: true });
  expect(await notices()).toEqual([]);
});

it("a requested, cancelled or declined request never makes anyone Active", async () => {
  for (const state of ["requested", "seen", "cancelled", "declined"]) {
    await setRequest(state);
    expect(await activateDue(db, at("2026-12-10T00:00:00Z"))).toBe(0);
  }
  expect(await status()).toBe("Onboarding");
});

it("No account needed: only Super Admin and HRMS Manager may set it, and it is logged with who and when", async () => {
  await db.exec(`DELETE FROM hrms_account_request_events; DELETE FROM hrms_account_requests`);
  for (const role of ["HR Officer", "Employee"]) await expect(employees(role).setNoAccountNeeded(1)).rejects.toMatchObject({ reason: "denied" });
  await expect(employeesFor("unknown", db).setNoAccountNeeded(1)).rejects.toMatchObject({ reason: "invalid" });
  expect((await one<{ no_account_needed_at: unknown }>(`SELECT no_account_needed_at FROM hrms_employees WHERE id = 1`)).no_account_needed_at).toBeNull();
  await employees("Super Admin", at("2026-11-25T02:00:00Z")).setNoAccountNeeded(1);
  const row = await one<{ no_account_needed_at: Date; no_account_needed_by: string }>(`SELECT no_account_needed_at, no_account_needed_by FROM hrms_employees WHERE id = 1`);
  expect(row.no_account_needed_at.toISOString()).toBe("2026-11-25T02:00:00.000Z");
  expect(row.no_account_needed_by).toBe("u-1");
  expect((await audit())[0]).toMatchObject({ actor_name: "Ada Manager", kind: "edit", field: "no_account_needed_at", old_value: null });
  const page = await employees().onboarding();
  expect(page.rows[0]).toMatchObject({ accountState: "No account needed", actions: ["undo-no-account-needed"] });
  await expect(employees().setNoAccountNeeded(1)).rejects.toMatchObject({ reason: "conflict" });
  await expect(employees().setNoAccountNeeded(99)).rejects.toMatchObject({ reason: "not-found" });
});

it("No account needed: not offered to someone with an active request", async () => {
  await expect(employees().setNoAccountNeeded(1)).rejects.toMatchObject({ reason: "conflict" });
});

it("No account needed makes the person Active on the start date, telling the person who set it", async () => {
  await db.exec(`DELETE FROM hrms_account_request_events; DELETE FROM hrms_account_requests`);
  await employees().setNoAccountNeeded(1);
  expect(await activateDue(db, at(BEFORE_START))).toBe(0);
  expect(await activateDue(db, at(START_DAY))).toBe(1);
  expect(await activateDue(db, at("2026-12-02T00:00:00Z"))).toBe(0);
  expect(await status()).toBe("Active");
  expect((await notices())[0].payload.recipientIds).toEqual(["u-1"]);
});

it("undo: clears who and when until the person is Active, logs it, and then is refused", async () => {
  await db.exec(`DELETE FROM hrms_account_request_events; DELETE FROM hrms_account_requests`);
  await employees().setNoAccountNeeded(1);
  await employees("Super Admin").undoNoAccountNeeded(1);
  expect(await one(`SELECT 1 FROM hrms_employees WHERE id = 1 AND no_account_needed_at IS NULL AND no_account_needed_by IS NULL`)).toBeTruthy();
  expect((await audit()).filter((r) => r.field === "no_account_needed_at").map((r) => [r.actor_name, r.new_value === null])).toEqual([["Ada Manager", false], ["Ada Manager", true]]);
  expect((await employees().onboarding()).rows[0].accountState).toBe("Not requested");
  await expect(employees("HR Officer").undoNoAccountNeeded(1)).rejects.toMatchObject({ reason: "denied" });
  await expect(employees().undoNoAccountNeeded(1)).rejects.toMatchObject({ reason: "conflict" });
  // an undone decision no longer makes anyone Active
  expect(await activateDue(db, at("2026-12-10T00:00:00Z"))).toBe(0);
  await employees().setNoAccountNeeded(1);
  await activateDue(db, at(START_DAY));
  await expect(employees().undoNoAccountNeeded(1)).rejects.toMatchObject({ reason: "conflict" });
  expect(await status()).toBe("Active");
});

it("the job's route handler refuses a missing or wrong secret and changes nothing", async () => {
  await setRequest("account_created");
  const job = employeeActivationJob(db, at(START_DAY), async () => {});
  for (const authorization of [undefined, "Bearer wrong", "cron-secret"]) {
    expect((await job(new Request("https://hrms.test/api/cron/employee-activation", { headers: authorization ? { authorization } : {} }))).status).toBe(401);
  }
  vi.stubEnv("CRON_SECRET", "");
  expect((await job(new Request("https://hrms.test/x", { headers: { authorization: "Bearer " } }))).status).toBe(401);
  expect(await status()).toBe("Onboarding");
});

it("the job is idempotent and delivers the notification it queued", async () => {
  await setRequest("account_created");
  const delivered = vi.fn(async () => {});
  const job = employeeActivationJob(db, at(START_DAY), delivered);
  const run = async () => (await job(new Request("https://hrms.test/x", { headers: { authorization: "Bearer cron-secret" } }))).json();
  expect(await run()).toEqual({ ok: true, activated: 1 });
  expect(await run()).toEqual({ ok: true, activated: 0 });
  expect(delivered).toHaveBeenCalledTimes(2);
  expect(await notices()).toHaveLength(1);
  expect((await audit()).filter((r) => r.field === "status")).toHaveLength(1);
});
