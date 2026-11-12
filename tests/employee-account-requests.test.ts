import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountRequestError } from "@/lib/account-requests";
import { employeesFor } from "@/lib/employees";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
const staff = { id: "u-1", name: "Ada Manager", username: "ada", email: "ada@example.test", role: "HRMS Manager" };
const sign = (role = "HRMS Manager", modules = ["Employee Onboarding"]) => portal.signIn({ ...staff, role }, modules);
const employees = (session = sign()) => employeesFor(session, db);
const input = (over: Record<string, unknown> = {}) => ({ workEmail: "maria.santos@brenraphaels.ph", roleId: "role-officer", moduleIds: ["m-applications", "m-offers"], ...over });
const count = async (sql: string) => (await db.query<{ n: number }>(sql)).rows[0].n;

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
  await db.exec(`INSERT INTO hrms_offers (application_id,monthly_salary,start_date,employment_type,schedule,probation,reports_to,branch,created_by_name)
    VALUES (-1,19000,'2026-12-01','Full-time','Mon-Fri','6 months','Liza','Cainta','Ada'),(-2,19000,'2026-12-01','Full-time','Mon-Fri','6 months','Liza','Cainta','Ada');
    INSERT INTO hrms_employees (employee_number,offer_id,application_id,full_name,email,position,branch,start_date,monthly_salary,employment_type,schedule,probation,reports_to,hired_by_name,mobile)
    VALUES ('BR-EMP-0001',1,-1,'Maria Santos','maria.personal@example.test','Cashier','Cainta','2026-12-01',19000,'Full-time','Mon-Fri','6 months','Liza','Ada','09171234567'),
      ('BR-EMP-0002',2,-2,'Jose Reyes','jose@example.test','Cashier','Cainta','2026-12-01',19000,'Full-time','Mon-Fri','6 months','Liza','Ada',NULL)`);
});
afterEach(async () => { await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("serves the Portal's Roles and Modules for the dialog, only to Staff who may act", async () => {
  const options = await employees().accountRequestOptions();
  expect(options.roles[0]).toEqual({ id: "role-officer", name: "HR Officer", moduleIds: ["m-applications", "m-offers"] });
  expect(options.systems.map((s) => s.name)).toEqual(["HRMS", "POS"]);
  await expect(employees(sign("HR Officer")).accountRequestOptions()).rejects.toMatchObject({ reason: "denied" });
  portal.unavailable = true;
  await expect(employees().accountRequestOptions()).rejects.toMatchObject({ reason: "unavailable" });
});

it("sends a request to the Portal with the personal email, creates RQ-0001 and its first event, defaulting needed-from to the start date", async () => {
  const sent = await employees().requestAccount(1, input({ note: "  Starts at the front counter  " }));
  expect(sent).toEqual({ reference: "RQ-0001", status: "requested" });
  expect(portal.receivedRequests).toEqual([{
    reference: "RQ-0001",
    employee: { name: "Maria Santos", workEmail: "maria.santos@brenraphaels.ph", personalEmail: "maria.personal@example.test", mobile: "09171234567", position: "Cashier", branch: "Cainta", startDate: "2026-12-01" },
    roleId: "role-officer", moduleIds: ["m-applications", "m-offers"], neededFrom: "2026-12-01", note: "Starts at the front counter", requestedBy: { name: "Ada Manager" },
  }]);
  const row = (await db.query<Record<string, unknown>>(`SELECT * FROM hrms_account_requests`)).rows[0];
  expect(row).toMatchObject({ reference: "RQ-0001", employee_id: 1, status: "requested", work_email: "maria.santos@brenraphaels.ph", portal_role: "HR Officer",
    personal_email: "maria.personal@example.test", requester_name: "Ada Manager", note: "Starts at the front counter" });
  expect(String(row.access_needed_from)).toContain("2026");
  expect(row.requested_modules).toEqual([{ id: "m-applications", name: "Applications", system: "HRMS" }, { id: "m-offers", name: "Offers", system: "HRMS" }]);
  expect((await db.query(`SELECT status, actor_name FROM hrms_account_request_events`)).rows).toEqual([{ status: "requested", actor_name: "Ada Manager" }]);
  const second = await employees().requestAccount(2, input({ workEmail: "Jose.Reyes@brenraphaels.ph", neededFrom: "2026-11-20", moduleIds: ["m-pos"], roleId: "role-cashier" }));
  expect(second.reference).toBe("RQ-0002");
  expect(portal.receivedRequests[1]).toMatchObject({ neededFrom: "2026-11-20", note: null, employee: { workEmail: "jose.reyes@brenraphaels.ph", mobile: null } });
});

it("lets only Super Admin and HRMS Manager send, and refuses everyone else without touching the Portal or database", async () => {
  for (const role of ["Super Admin", "HRMS Manager"]) await expect(employees(sign(role)).requestAccount(role === "Super Admin" ? 1 : 2, input({ workEmail: `${role[0]}@brenraphaels.ph` }))).resolves.toMatchObject({ status: "requested" });
  await db.exec(`DELETE FROM hrms_account_requests`);
  portal.receivedRequests.length = 0;
  await expect(employees(sign("HR Officer")).requestAccount(1, input())).rejects.toMatchObject({ reason: "denied" });
  await expect(employees(sign("Super Admin", ["Employee Information"])).requestAccount(1, input())).rejects.toMatchObject({ reason: "denied" });
  await expect(employees("unknown").requestAccount(1, input())).rejects.toMatchObject({ reason: "invalid" });
  expect(portal.receivedRequests).toEqual([]);
  expect(await count(`SELECT count(*)::int AS n FROM hrms_account_requests`)).toBe(0);
});

it("validates the work email, Role, Modules, date and note, with a message per field", async () => {
  const problems = async (over: Record<string, unknown>) => (await employees().requestAccount(1, input(over)).catch((e: AccountRequestError) => e)) as AccountRequestError;
  expect((await problems({ workEmail: "" })).problems.workEmail).toMatch(/Enter the work email/);
  for (const bad of ["maria", "a@b", "a b@c.ph", "<x>@c.ph", "x".repeat(250) + "@c.ph"]) expect((await problems({ workEmail: bad })).problems.workEmail).toMatch(/valid work email/);
  expect((await problems({ roleId: undefined })).problems.roleId).toMatch(/Choose a Portal Role/);
  expect((await problems({ roleId: "role-made-up" })).problems.roleId).toMatch(/Portal's list/);
  expect((await problems({ moduleIds: [] })).problems.moduleIds).toMatch(/at least one Module/);
  expect((await problems({ moduleIds: "m-offers" })).problems.moduleIds).toMatch(/at least one Module/);
  expect((await problems({ moduleIds: ["m-made-up"] })).problems.moduleIds).toMatch(/Portal's list/);
  expect((await problems({ neededFrom: "2026-02-31" })).problems.neededFrom).toMatch(/valid date/);
  expect((await problems({ neededFrom: "soon" })).problems.neededFrom).toMatch(/valid date/);
  expect((await problems({ note: "x".repeat(1001) })).problems.note).toMatch(/under 1000/);
  expect((await problems({ note: "bad\u0000note" })).problems.note).toMatch(/control characters/);
  for (const e of await Promise.all([problems({ workEmail: "" }), problems({ moduleIds: [] })])) expect(e.reason).toBe("validation");
  expect(portal.receivedRequests).toEqual([]);
  expect(await count(`SELECT count(*)::int AS n FROM hrms_account_requests`)).toBe(0);
  await expect(employees().requestAccount(0, input())).rejects.toMatchObject({ reason: "validation" });
  await expect(employees().requestAccount(99, input())).rejects.toMatchObject({ reason: "not-found" });
});

it("refuses a second request while one is active, whatever its state, and allows a new one with a new reference after Cancelled or Declined", async () => {
  await employees().requestAccount(1, input());
  for (const status of ["requested", "seen", "account_created", "login_sent"]) {
    await db.exec(`UPDATE hrms_account_requests SET status = '${status}'`);
    await expect(employees().requestAccount(1, input({ workEmail: "other@brenraphaels.ph" }))).rejects.toMatchObject({ reason: "conflict" });
  }
  expect(portal.receivedRequests).toHaveLength(1);
  expect(await count(`SELECT count(*)::int AS n FROM hrms_account_requests`)).toBe(1);
  for (const [index, status] of ["cancelled", "declined"].entries()) {
    await db.exec(`UPDATE hrms_account_requests SET status = '${status}' WHERE id = (SELECT max(id) FROM hrms_account_requests)`);
    const next = await employees().requestAccount(1, input());
    expect(next.reference).toBe(`RQ-000${index + 2}`);
  }
  expect(await count(`SELECT count(*)::int AS n FROM hrms_account_requests WHERE status = 'requested'`)).toBe(1);
});

it("enforces one active request per Employee record in the database itself", async () => {
  await db.exec(`INSERT INTO hrms_account_requests (employee_id,status,work_email,portal_role,access_needed_from,personal_email,requester_id,requester_name)
    VALUES (1,'requested','a@brenraphaels.ph','HR Officer','2026-12-01','p@example.test','u','U')`);
  await expect(db.exec(`INSERT INTO hrms_account_requests (employee_id,status,work_email,portal_role,access_needed_from,personal_email,requester_id,requester_name)
    VALUES (1,'seen','b@brenraphaels.ph','HR Officer','2026-12-01','p@example.test','u','U')`)).rejects.toThrow();
  await db.exec(`UPDATE hrms_account_requests SET status = 'declined'`);
  await db.exec(`INSERT INTO hrms_account_requests (employee_id,status,work_email,portal_role,access_needed_from,personal_email,requester_id,requester_name)
    VALUES (1,'seen','b@brenraphaels.ph','HR Officer','2026-12-01','p@example.test','u','U')`);
});

it("refuses a work email used by an active request or by a Portal User, but frees it once the request is cancelled", async () => {
  await employees().requestAccount(1, input());
  await expect(employees().requestAccount(2, input({ workEmail: "MARIA.SANTOS@brenraphaels.ph" }))).rejects.toMatchObject({ reason: "email-taken", problems: { workEmail: expect.any(String) } });
  expect(portal.receivedRequests).toHaveLength(1);
  portal.portalUserEmails.push("Jose.Reyes@brenraphaels.ph");
  await expect(employees().requestAccount(2, input({ workEmail: "jose.reyes@brenraphaels.ph" }))).rejects.toMatchObject({ reason: "email-taken" });
  expect(await count(`SELECT count(*)::int AS n FROM hrms_account_requests WHERE employee_id = 2`)).toBe(0);
  await db.exec(`UPDATE hrms_account_requests SET status = 'cancelled'`);
  await expect(employees().requestAccount(2, input())).resolves.toMatchObject({ status: "requested" });
});

it("creates no request, and says so, when the Portal is unavailable or refuses", async () => {
  portal.unavailable = true;
  await expect(employees().requestAccount(1, input())).rejects.toMatchObject({ reason: "unavailable" });
  portal.unavailable = false;
  portal.accountRequestStatus = 500;
  await expect(employees().requestAccount(1, input())).rejects.toMatchObject({ reason: "unavailable" });
  portal.accountRequestStatus = 400;
  await expect(employees().requestAccount(1, input())).rejects.toMatchObject({ reason: "unavailable" });
  expect(await count(`SELECT count(*)::int AS n FROM hrms_account_requests`)).toBe(0);
  expect(await count(`SELECT count(*)::int AS n FROM hrms_account_request_events`)).toBe(0);
  portal.accountRequestStatus = null;
  vi.stubGlobal("fetch", (async (request: RequestInfo | URL, init?: RequestInit) => {
    if (String(request).includes("account-requests") && init?.method === "POST") throw new Error("socket hang up");
    return portalFetch(portal)(request, init);
  }) as typeof fetch);
  await expect(employees().requestAccount(1, input())).rejects.toMatchObject({ reason: "unavailable" });
  expect(await count(`SELECT count(*)::int AS n FROM hrms_account_requests`)).toBe(0);
  vi.stubGlobal("fetch", portalFetch(portal));
  await expect(employees().requestAccount(1, input())).resolves.toMatchObject({ status: "requested" });
});

it("treats a malformed Roles and Modules answer from the Portal as unavailable", async () => {
  portal.accountRequestOptions = { roles: [{ id: "r", name: "", moduleIds: [] }], systems: [] };
  await expect(employees().accountRequestOptions()).rejects.toMatchObject({ reason: "unavailable" });
  await expect(employees().requestAccount(1, input())).rejects.toMatchObject({ reason: "unavailable" });
});

it("only requests for people who are still Onboarding, and settles two concurrent sends to exactly one request", async () => {
  await db.exec(`UPDATE hrms_employees SET status = 'Active' WHERE id = 2`);
  await expect(employees().requestAccount(2, input())).rejects.toMatchObject({ reason: "conflict" });
  const results = await Promise.allSettled([employees().requestAccount(1, input()), employees().requestAccount(1, input())]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await count(`SELECT count(*)::int AS n FROM hrms_account_requests WHERE employee_id = 1`)).toBe(1);
  expect(portal.receivedRequests.filter((r) => r.reference === "RQ-0001")).toHaveLength(1);
});

it("shows a sent request as Requested in the Onboarding read model", async () => {
  await employees().requestAccount(1, input());
  const page = await employees(sign()).onboarding();
  expect(page.rows.find((r) => r.id === 1)).toMatchObject({ accountState: "Requested", requestReference: "RQ-0001", workEmail: "maria.santos@brenraphaels.ph", actions: ["remind", "cancel"] });
  expect(page.summary.requested).toBe(1);
});
