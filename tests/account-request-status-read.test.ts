import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { employeesFor } from "@/lib/employees";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
const staff = { id: "u-1", name: "Ada Manager", username: "ada", email: "ada@example.test", role: "HRMS Manager" };
const sign = (role = "HRMS Manager", modules = ["Employee Onboarding"]) => portal.signIn({ ...staff, role }, modules);
const employees = (session = sign()) => employeesFor(session, db);
const input = (over: Record<string, unknown> = {}) => ({ workEmail: "maria.santos@brenraphaels.ph", roleId: "role-officer", moduleIds: ["m-applications", "m-offers"], ...over });

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

it("reads the request for the panel: details, Modules by system, and each step with time and actor", async () => {
  await employees().requestAccount(1, input({ note: "Front counter" }));
  const pending = await employees().accountRequestStatus(1);
  expect(pending).toMatchObject({ reference: "RQ-0001", status: "requested", workEmail: "maria.santos@brenraphaels.ph", role: "HR Officer",
    neededFrom: "2026-12-01", requestedBy: "Ada Manager", employee: { name: "Maria Santos", employeeNumber: "BR-EMP-0001" }, overdue: false, daysSinceSeen: null });
  expect(pending.modules.flatMap((m) => m.names)).toEqual(expect.arrayContaining(["Applications", "Offers"]));
  expect(pending.steps.map((s) => [s.label, s.done])).toEqual([["Sent to admin portal", true], ["Seen by admin", false], ["Account created", false], ["Login details sent to Maria", false]]);
  expect(pending.steps[0].actor).toBe("Ada Manager");
  await db.exec(`INSERT INTO hrms_account_request_events (request_id,status,actor_name,occurred_at) VALUES (1,'seen','IT Admin','2026-11-12T06:40:00Z');
    UPDATE hrms_account_requests SET status='seen'`);
  const seen = await employees().accountRequestStatus(1);
  expect(seen.steps[1]).toMatchObject({ done: true, actor: "IT Admin", at: "2026-11-12T06:40:00.000Z" });
});

it("flags a request whose start date has passed with no account, and clears the flag once the account exists", async () => {
  await employees().requestAccount(1, input());
  await db.exec(`UPDATE hrms_employees SET start_date = '2020-01-01'`);
  expect((await employees().accountRequestStatus(1)).overdue).toBe(true);
  await db.exec(`INSERT INTO hrms_account_request_events (request_id,status,actor_name) VALUES (1,'account_created','IT Admin')`);
  expect((await employees().accountRequestStatus(1)).overdue).toBe(false);
});

it("refuses a read without the Module, for a person with no active request, and for a bad id", async () => {
  await expect(employees(sign("HR Officer", [])).accountRequestStatus(1)).rejects.toMatchObject({ reason: "denied" });
  await expect(employees().accountRequestStatus(2)).rejects.toMatchObject({ reason: "not-found" });
  await expect(employees().accountRequestStatus(0)).rejects.toMatchObject({ reason: "validation" });
});

it("ignores a cancelled request: only the active one is shown", async () => {
  await employees().requestAccount(1, input());
  await db.exec(`UPDATE hrms_account_requests SET status = 'cancelled'`);
  await expect(employees().accountRequestStatus(1)).rejects.toMatchObject({ reason: "not-found" });
});
