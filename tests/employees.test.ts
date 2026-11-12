import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { seedEmployees } from "../scripts/seed-employees.mjs";
import { employeesFor } from "@/lib/employees";
import { FakePortal, portalFetch, FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const staff = { name: "Ada", username: "ada", email: "ada@example.test", role: "HR Officer" };
const employees = (session = handle) => employeesFor(session, db);

beforeEach(async () => {
  db = new PGlite();
  for (const fixture of ["careers-job-postings.sql", "careers-applications.sql"]) {
    await db.exec(await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"));
  }
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text, email text)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter(n => n.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  portal = new FakePortal();
  handle = portal.signIn(staff, ["Employee Information"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("HRMS_EMPLOYEE_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  await db.exec(`INSERT INTO hrms_offers (application_id,monthly_salary,start_date,employment_type,schedule,probation,reports_to,branch,created_by_name)
    VALUES (-1,19000,'2026-01-01','Full-time','Mon-Fri','6 months','Liza','Cainta','Ada');
    INSERT INTO hrms_employees (employee_number,offer_id,application_id,full_name,email,position,branch,start_date,monthly_salary,employment_type,schedule,probation,reports_to,hired_by_name)
    VALUES ('BR-EMP-0001',1,-1,'Maria Santos','maria@example.test','Cashier','Cainta','2026-01-01',19000,'Full-time','Mon-Fri','6 months','Liza','Ada');`);
});
afterEach(async () => { await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("returns a complete detail with seven missing documents and absent pay for an HR Officer", async () => {
  const detail = await employees().read(1);
  expect(detail.personal).toMatchObject({ name: "Maria Santos", birthday: null, age: null });
  expect(detail.employment).toMatchObject({ hiredFrom: { offerId: 1, applicationId: -1 } });
  expect(detail.contract).not.toHaveProperty("monthlyPay");
  expect(detail.documents).toHaveLength(7);
  expect(detail.documents.every(d => d.viewUrl === null)).toBe(true);
  expect(detail.governmentIds).toBe("Not provided yet");
  expect(detail.emergencyContact).toBe("Not provided yet");
});

it("stores ciphertext, masks IDs and omits pay for other roles, and logs privileged disclosures", async () => {
  const manager = portal.signIn({ ...staff, role: "HRMS Manager" }, ["Employee Information"]);
  await employees(manager).setGovernmentIds(1, { sss: "34-1234567-8", philhealth: "123456789012", pagibigMid: "123456789012", tin: "123-456-789" });
  const restricted = await employees().read(1);
  expect(restricted.governmentIds).toMatchObject({ sss: "34-•••••••-8", tin: "12•-•••-••9" });
  expect(restricted.contract).not.toHaveProperty("monthlyPay");
  const ciphertext = (await db.query<{ sss: string }>(`SELECT sss FROM hrms_employee_government_ids`)).rows[0].sss;
  expect(ciphertext).not.toContain("1234567");
  expect(ciphertext).toMatch(/^v1:/);
  for (const role of ["Super Admin", "HRMS Manager"]) {
    const allowed = portal.signIn({ ...staff, role }, ["Employee Information"]);
    const full = await employees(allowed).read(1);
    expect(full.governmentIds).toMatchObject({ sss: "34-1234567-8", tin: "123-456-789" });
    expect(full.contract).toHaveProperty("monthlyPay", 19000);
  }
  const audit = (await db.query<{ actor_id: string; field: string; occurred_at: Date }>(`SELECT actor_id,field,occurred_at FROM hrms_employee_audit WHERE kind = 'reveal'`)).rows;
  expect(audit).toHaveLength(10);
  expect(audit).toContainEqual({ actor_id: "ada", field: "sss", occurred_at: expect.any(Date) });
  await expect(employees().setGovernmentIds(1, { sss: "1" })).rejects.toMatchObject({ reason: "denied" });
});

it("refuses detail access without the Module, invalid sessions and invalid or missing records", async () => {
  const noModule = portal.signIn({ ...staff, role: "Super Admin" }, ["Offers"]);
  await expect(employees(noModule).read(1)).rejects.toMatchObject({ reason: "denied" });
  await expect(employees("unknown").read(1)).rejects.toMatchObject({ reason: "invalid" });
  await expect(employees().read(0)).rejects.toMatchObject({ reason: "validation" });
  await expect(employees().read(999)).rejects.toMatchObject({ reason: "not-found" });
  portal.unavailable = true;
  await expect(employees().read(1)).rejects.toMatchObject({ reason: "unavailable" });
});

it("returns age on the Manila date, emergency contact and private document URLs with upload and validity dates", async () => {
  await db.exec(`UPDATE hrms_employees SET birthday = '2000-11-14', sex = 'Female', civil_status = 'Single', mobile = '09170000000', home_address = 'Cainta';
    INSERT INTO hrms_employee_emergency_contacts VALUES (1,'Juan Santos','Brother','09171111111');
    INSERT INTO hrms_employee_documents (employee_id,document_type,source,file_id,file_name,uploaded_at,valid_until)
    VALUES (1,'nbi','upload','nbi-file','nbi.pdf','2026-11-01 00:00:00Z','2027-05-01'),
      (1,'resume','application','11','resume.pdf',NULL,NULL);
    INSERT INTO job_postings (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
      VALUES ('posting','Cashier','Retail','','','Full time','Manila','[]','[]','open');
    INSERT INTO applications (applicant_id,job_posting_id,reference_number,status,profile_snapshot,documents_snapshot,consented_at)
      VALUES ('person','posting','REF','Hired','{}','[{"id":11}]',now());
    UPDATE hrms_employees SET application_id = 1;
    CREATE TABLE applicant_documents (id integer PRIMARY KEY, applicant_id text, file_id text, created_at timestamptz);
    INSERT INTO applicant_documents VALUES (11,'person','actual-resume-file','2026-10-01 00:00:00Z');`);
  const detail = await employeesFor(handle, db, { viewUrl: async id => `https://files.example.test/${id}?signed=yes` }, () => new Date('2026-11-13T16:01:00Z')).read(1);
  expect(detail.personal).toMatchObject({ age: 26, mobile: '09170000000', homeAddress: 'Cainta' });
  expect(detail.emergencyContact).toEqual({ name: 'Juan Santos', relationship: 'Brother', mobile: '09171111111' });
  expect(detail.documents.find(d => d.type === 'nbi')).toMatchObject({ uploadedAt: expect.stringContaining('2026-11-01'), validUntil: '2027-05-01', viewUrl: 'https://files.example.test/nbi-file?signed=yes' });
  expect(detail.documents.find(d => d.type === 'resume')).toMatchObject({ uploadedAt: expect.stringContaining('2026-10-01'), viewUrl: 'https://files.example.test/actual-resume-file?signed=yes' });
});

it("rejects a missing encryption key and authenticated ciphertext tampering", async () => {
  const manager = portal.signIn({ ...staff, role: 'HRMS Manager' }, ['Employee Information']);
  vi.stubEnv('HRMS_EMPLOYEE_ENCRYPTION_KEY', '');
  await expect(employees(manager).setGovernmentIds(1, { sss: '34-1234567-8' })).rejects.toThrow('HRMS_EMPLOYEE_ENCRYPTION_KEY');
  vi.stubEnv('HRMS_EMPLOYEE_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  await employees(manager).setGovernmentIds(1, { sss: '34-1234567-8', tin: '123-456-789' });
  await db.exec(`UPDATE hrms_employee_government_ids SET tin = sss`);
  await expect(employees().read(1)).rejects.toThrow();
  expect((await db.query(`SELECT 1 FROM hrms_employee_audit WHERE kind = 'reveal'`)).rows).toHaveLength(0);
});


it("seeds four Onboarding scenarios and three Active records with one missing document, idempotently", async () => {
  await db.exec(`DELETE FROM hrms_employees; DELETE FROM hrms_offers`);
  const seeded = await seedEmployees(db);
  expect(seeded.filter(e => e.status === 'Onboarding').map(e => e.account)).toEqual([null,null,'requested','account_created']);
  expect(seeded.filter(e => e.status === 'Active')).toHaveLength(3);
  expect((await seedEmployees(db)).map(e => e.employeeId)).toEqual(seeded.map(e => e.employeeId));
  const requests = (await db.query<{ status: string }>(`SELECT status FROM hrms_account_requests ORDER BY id`)).rows;
  expect(requests.map(r => r.status)).toEqual(['requested','account_created','login_sent','login_sent','login_sent']);
  const missing = seeded.find(e => e.missing)!;
  const detail = await employees().read(missing.employeeId);
  expect(detail.documents.filter(d => d.status === 'Not provided yet').map(d => d.type)).toEqual(['nbi']);
});
