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
  await employees(manager).replaceGovernmentIds(1, { sss: "34-1234567-8", philhealth: "123456789012", pagibigMid: "123456789012", tin: "123-456-789" });
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
  await expect(employees().replaceGovernmentIds(1, { sss: "1" })).rejects.toMatchObject({ reason: "denied" });
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
    VALUES (1,'nbi','upload','nbi-file','nbi.pdf',NULL,'2027-05-01'),
      (1,'resume','application','11','resume.pdf',NULL,NULL);
    INSERT INTO hrms_offer_documents (offer_id,document_type,status,file_id,submitted_at)
      VALUES (1,'nbi','Submitted','nbi-file','2026-11-01 00:00:00Z');
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
  await expect(employees(manager).replaceGovernmentIds(1, { sss: '34-1234567-8' })).rejects.toThrow('HRMS_EMPLOYEE_ENCRYPTION_KEY');
  vi.stubEnv('HRMS_EMPLOYEE_ENCRYPTION_KEY', Buffer.alloc(32, 7).toString('base64'));
  await employees(manager).replaceGovernmentIds(1, { sss: '34-1234567-8', tin: '123-456-789' });
  await db.exec(`UPDATE hrms_employee_government_ids SET tin = sss`);
  await expect(employees().read(1)).rejects.toThrow();
  expect((await db.query(`SELECT 1 FROM hrms_employee_audit WHERE kind = 'reveal'`)).rows).toHaveLength(0);
});


it("seeds four Onboarding scenarios and three Active records with one missing document, idempotently", async () => {
  await db.exec(`DELETE FROM hrms_employee_history; DELETE FROM hrms_employees; DELETE FROM hrms_offers`);
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

it("masks full-width government ID digits for an unauthorised role", async () => {
  const manager = portal.signIn({ ...staff, role: 'HRMS Manager' }, ['Employee Information']);
  await employees(manager).replaceGovernmentIds(1, { sss: '１２３４５６７８９' });
  expect((await employees().read(1)).governmentIds).toMatchObject({ sss: '１２••••••９' });
});

it("lists every Employee record with counts, summary, Branch filter and search, and an unauthorised Staff member is refused", async () => {
  await db.exec(`DELETE FROM hrms_employee_history; DELETE FROM hrms_employees; DELETE FROM hrms_offers`);
  const seeded = await seedEmployees(db);
  const all = await employees().list();
  expect(all.counts).toEqual({ all: 7, active: 3, onboarding: 4 });
  expect(all.summary).toEqual({ employees: 7, onboarding: 4, missingDocuments: all.rows.filter(r => r.documentsMissing > 0).length });
  expect(all.rows).toHaveLength(7);
  expect(all.rows[0]).toMatchObject({ employeeNumber: expect.stringMatching(/^BR-EMP-\d{4}$/), initials: expect.stringMatching(/^[A-Z]{1,2}$/), status: expect.stringMatching(/Onboarding|Active/) });
  const missing = all.rows.find(r => r.id === seeded.find(e => e.missing)!.employeeId)!;
  expect(missing.documentsLabel).toBe(`${missing.documentsSubmitted}/7 · ${7 - missing.documentsSubmitted} missing`);
  expect(all.rows.some(r => r.documentsLabel === "7/7 complete")).toBe(true);
  expect((await employees().list({ status: "Active" })).rows).toHaveLength(3);
  const branch = all.branches[0];
  const byBranch = await employees().list({ branch });
  expect(byBranch.rows.every(r => r.branch === branch)).toBe(true);
  expect(byBranch.counts.all).toBe(all.rows.filter(r => r.branch === branch).length);
  expect((await employees().list({ search: all.rows[0].employeeNumber })).rows.map(r => r.id)).toEqual([all.rows[0].id]);
  expect((await employees().list({ search: all.rows[1].name.toLowerCase() })).rows.map(r => r.id)).toContain(all.rows[1].id);
  expect((await employees().list({ search: "%" })).rows).toHaveLength(0);
  const noModule = portal.signIn(staff, ["Offers"]);
  await expect(employees(noModule).list()).rejects.toMatchObject({ reason: "denied" });
  await expect(employees(noModule).exportCsv()).rejects.toMatchObject({ reason: "denied" });
  await expect(employees("unknown").list()).rejects.toMatchObject({ reason: "invalid" });
  await expect(employees().list({ status: "Bogus" as never })).rejects.toMatchObject({ reason: "validation" });
});

it("exports the current list as CSV without government IDs or pay, even for a manager", async () => {
  const manager = portal.signIn({ ...staff, role: "HRMS Manager" }, ["Employee Information"]);
  await employees(manager).replaceGovernmentIds(1, { sss: "34-1234567-8" });
  await db.exec(`UPDATE hrms_employees SET full_name = '=HYPERLINK("x")', position = 'Cashier, Senior'`);
  const csv = await employees(manager).exportCsv();
  expect(csv.split("\r\n")[0]).toBe("Employee ID,Name,Email,Position,Department,Branch,Start date,Documents,Status");
  expect(csv).toContain(`BR-EMP-0001,"'=HYPERLINK(""x"")",maria@example.test,"Cashier, Senior",,Cainta,2026-01-01,0/7 · 7 missing,Onboarding`);
  expect(csv).not.toMatch(/1234567|19000|sss|salary|pay/i);
  expect((await employees(manager).exportCsv({ status: "Active" })).trim().split("\r\n")).toHaveLength(1);
});

it("lets a Module holder correct personal information with accountable old and new values", async () => {
  await employees().editSection(1, 'personal', { name: 'Maria Cruz' });
  expect((await employees().read(1)).personal.name).toBe('Maria Cruz');
  expect(await employees().activity(1)).toContainEqual(expect.objectContaining({ actorName: 'Ada', field: 'name', oldValue: 'Maria Santos', newValue: 'Maria Cruz' }));
});

it('rejects invalid dates, mobiles, required fields, section injection and unauthorised pay', async () => {
  for (const input of [{ birthday: '2026-02-30' }, { mobile: '123' }, { name: '' }, { email: 'bad' }, { monthlyPay: 1 }]) {
    await expect(employees().editSection(1,'personal',input)).rejects.toMatchObject({ reason: 'validation' });
  }
  await expect(employees().editSection(1,'contract',{ monthlyPay: 25000 })).rejects.toMatchObject({ reason: 'denied' });
  await expect(employees().editSection(1,'employment',{ startDate: '2026-03-01', probationEndDate: '2026-02-01' })).rejects.toMatchObject({ reason: 'validation' });
});

it('records the hire and every employment change with effective dates, hiding pay from other roles', async () => {
  expect(await employees().history(1)).toContainEqual(expect.objectContaining({ kind: 'Hired', effectiveDate: '2026-01-01', newValue: expect.objectContaining({ position: 'Cashier',schedule: 'Mon-Fri',probation: '6 months',startDate: '2026-01-01' }) }));
  await employees().editSection(1,'employment',{ position: 'Supervisor', department: 'Retail', branch: 'Taytay', employmentType: 'Regular', reportsTo: 'Ana' },'2026-12-01');
  const history = await employees().history(1);
  for (const [field,oldValue,newValue] of [['position','Cashier','Supervisor'],['department',null,'Retail'],['branch','Cainta','Taytay'],['employmentType','Full-time','Regular'],['reportsTo','Liza','Ana']]) {
    expect(history).toContainEqual(expect.objectContaining({ field,oldValue,newValue,effectiveDate: '2026-12-01' }));
  }
  for (const role of ['Super Admin','HRMS Manager']) {
    const manager = portal.signIn({ ...staff,role },['Employee Information']);
    await employees(manager).editSection(1,'contract',{ monthlyPay: role === 'Super Admin' ? 25000 : 26000 });
    expect(await employees(manager).history(1)).toContainEqual(expect.objectContaining({ field: 'monthlyPay',newValue: role === 'Super Admin' ? 25000 : 26000 }));
  }
  expect(JSON.stringify(await employees().history(1))).not.toMatch(/19000|25000|26000/);
  expect(JSON.stringify(await employees().activity(1))).not.toMatch(/19000|25000|26000/);
  const count = (await employees().history(1)).length;
  await employees().editSection(1,'employment',{ position: 'Supervisor' });
  expect(await employees().history(1)).toHaveLength(count);
});

it('edits emergency contacts and government IDs with redacted, newest-first activity', async () => {
  await employees().editSection(1,'emergencyContact',{ name: 'Juan',relationship: 'Brother',mobile: '+639171111111' });
  expect((await employees().read(1)).emergencyContact).toEqual({ name: 'Juan',relationship: 'Brother',mobile: '+639171111111' });
  const manager = portal.signIn({ ...staff,role: 'HRMS Manager' },['Employee Information']);
  await employees(manager).replaceGovernmentIds(1,{ sss: '34-1234567-8' });
  const activity = await employees().activity(1);
  expect(activity[0]).toMatchObject({ field: 'sss',oldValue: '[redacted]',newValue: '[redacted]',actorId: 'ada',actorName: 'Ada' });
  expect(JSON.stringify(activity)).not.toContain('1234567');
});

it('refuses every edit and read-model operation without Employee Information', async () => {
  const noModule = portal.signIn({ ...staff,role: 'Super Admin' },['Offers']);
  for (const section of ['personal','employment','emergencyContact','contract'] as const) {
    await expect(employees(noModule).editSection(1,section,{ name: 'X' })).rejects.toMatchObject({ reason: 'denied' });
  }
  await expect(employees(noModule).replaceGovernmentIds(1,{ sss: '123' })).rejects.toMatchObject({ reason: 'denied' });
  await expect(employees(noModule).activity(1)).rejects.toMatchObject({ reason: 'denied' });
  await expect(employees(noModule).history(1)).rejects.toMatchObject({ reason: 'denied' });
});

it('feeds hires and automatic status changes to Recent Activity without leaking pay', async () => {
  const { dashboardSummaryFor } = await import('@/lib/dashboard-data');
  const { dashboardRange } = await import('@/lib/dashboard');
  const range = dashboardRange('this-month',new Date('2026-11-13T00:00:00Z'));
  await db.exec(`UPDATE hrms_employees SET status='Active' WHERE id=1`);
  const summary = await dashboardSummaryFor(['/employee-information'],range,new Date(),db);
  expect(summary.recentActivity).toContainEqual(expect.objectContaining({ kind: 'hire',employeeName: 'Maria Santos' }));
  expect(summary.recentActivity?.[0]).toMatchObject({ kind: 'status-change',description: 'Onboarding → Active' });
  expect(await employees().activity(1)).toContainEqual(expect.objectContaining({ kind: 'status',actorName: 'System',field: 'status' }));
  expect(JSON.stringify(summary)).not.toContain('19000');
  expect(await dashboardSummaryFor([],range,new Date(),db)).not.toHaveProperty('recentActivity');
});

it('rolls back invalid edits without audit or history and records old and new government values privately', async () => {
  const before = await employees().history(1);
  await expect(employees().editSection(1,'employment',{ startDate: '2026-03-01',probationEndDate: '2026-02-01',position: 'Invalid' })).rejects.toMatchObject({ reason: 'validation' });
  expect((await employees().read(1)).employment.position).toBe('Cashier');
  expect(await employees().history(1)).toEqual(before);
  expect(await employees().activity(1)).toEqual([]);
  const manager = portal.signIn({ ...staff,role: 'HRMS Manager' },['Employee Information']);
  await employees(manager).replaceGovernmentIds(1,{ tin: '123-456-789' });
  await employees(manager).replaceGovernmentIds(1,{ tin: '987-654-321' });
  expect((await employees(manager).read(1)).governmentIds).toMatchObject({ tin: '987-654-321' });
  const edits = (await employees().activity(1)).filter(e => e.kind === 'edit');
  expect(edits).toHaveLength(2);
  expect(edits.every(e => e.oldValue === '[redacted]' && e.newValue === '[redacted]')).toBe(true);
});

const onboardingViewer = (role = "HRMS Manager") => portal.signIn({ ...staff, role }, ["Employee Onboarding"]);

it("lists only Onboarding records with account state, default work email, counts and summary", async () => {
  await db.exec(`DELETE FROM hrms_employee_history; DELETE FROM hrms_employees; DELETE FROM hrms_offers`);
  await seedEmployees(db);
  await db.exec(`UPDATE hrms_employees SET full_name = 'María Dela Cruz' WHERE full_name = 'Maria Santos';
    UPDATE hrms_employees SET no_account_needed_at = now(), no_account_needed_by = 'Ada' WHERE full_name = 'Jose Reyes'`);
  const page = await employees(onboardingViewer()).onboarding();
  expect(page.rows.map(r => [r.name, r.accountState])).toEqual(expect.arrayContaining([
    ["María Dela Cruz", "Not requested"], ["Jose Reyes", "No account needed"], ["Ana Cruz", "Requested"], ["Paolo Garcia", "Account created"]]));
  expect(page.rows).toHaveLength(4);
  expect(page.rows.map(r => r.name)).not.toEqual(expect.arrayContaining(["Liza Bautista"]));
  expect(page.rows.find(r => r.name === "María Dela Cruz")).toMatchObject({ workEmail: "maria.cruz@brenraphaels.ph", initials: "MD", employeeNumber: expect.stringMatching(/^BR-EMP-/), position: "Cashier", branch: "Cainta branch" });
  expect(page.rows.find(r => r.name === "Ana Cruz")).toMatchObject({ workEmail: "employee-demo-3@example.test", requestReference: expect.stringMatching(/^RQ-\d{4}$/) });
  expect(page.rows.find(r => r.name === "Paolo Garcia")).toMatchObject({ becomesActiveOn: expect.any(String) });
  expect(page.counts).toEqual({ all: 4, needsAccount: 1, requested: 1, accountCreated: 1, noAccountNeeded: 1 });
  expect(page.summary).toEqual({ needsAccount: 1, requested: 1, accountCreated: 1 });
  expect((await employees(onboardingViewer()).onboarding({ state: "Requested" })).rows.map(r => r.name)).toEqual(["Ana Cruz"]);
  expect((await employees(onboardingViewer()).onboarding({ search: "BR-EMP-0003" })).rows.map(r => r.name)).toEqual(["Ana Cruz"]);
  expect((await employees(onboardingViewer()).onboarding({ search: "dela cruz" })).rows.map(r => r.name)).toEqual(["María Dela Cruz"]);
});

it("ignores cancelled and declined requests, and flags a passed start date without an account", async () => {
  await db.exec(`DELETE FROM hrms_employee_history; DELETE FROM hrms_employees; DELETE FROM hrms_offers`);
  const [first] = await seedEmployees(db);
  await db.exec(`DELETE FROM hrms_account_requests;
    INSERT INTO hrms_account_requests (employee_id,status,work_email,portal_role,access_needed_from,personal_email,requester_id,requester_name)
      VALUES (${first.employeeId},'declined','x@brenraphaels.ph','HR Officer','2026-01-01','p@example.test','ada','Ada');
    UPDATE hrms_employees SET start_date = '2026-11-12' WHERE id = ${first.employeeId}`);
  const clock = (iso: string) => employeesFor(onboardingViewer(), db, undefined, () => new Date(iso));
  // Start date 2026-11-12 Manila: still its first day at 23:00, passed from midnight.
  const row = (await clock("2026-11-12T15:00:00Z").onboarding()).rows.find(r => r.id === first.employeeId)!;
  expect(row).toMatchObject({ accountState: "Not requested", requestStatus: "declined", overdue: false });
  expect((await clock("2026-11-12T16:00:00Z").onboarding()).rows.find(r => r.id === first.employeeId)!.overdue).toBe(true);
});

it("gives actions only to Super Admin and HRMS Manager; other holders get the page read-only", async () => {
  await db.exec(`DELETE FROM hrms_employee_history; DELETE FROM hrms_employees; DELETE FROM hrms_offers`);
  await seedEmployees(db);
  for (const role of ["Super Admin", "HRMS Manager"]) {
    const page = await employees(onboardingViewer(role)).onboarding();
    expect(page.canAct).toBe(true);
    expect(Object.fromEntries(page.rows.map(r => [r.accountState, r.actions]))).toEqual({
      "Not requested": ["request", "no-account-needed"], "Requested": ["remind", "cancel"], "Account created": [] });
  }
  const readOnly = await employees(onboardingViewer("HR Officer")).onboarding();
  expect(readOnly.canAct).toBe(false);
  expect(readOnly.rows).toHaveLength(4);
  expect(readOnly.rows.every(r => r.actions.length === 0)).toBe(true);
});

it("refuses Onboarding without the Module, with an invalid session or filter, or when the Portal is down", async () => {
  const onlyInformation = portal.signIn({ ...staff, role: "Super Admin" }, ["Employee Information"]);
  await expect(employees(onlyInformation).onboarding()).rejects.toMatchObject({ reason: "denied" });
  await expect(employees(onboardingViewer()).list()).rejects.toMatchObject({ reason: "denied" });
  await expect(employees("unknown").onboarding()).rejects.toMatchObject({ reason: "invalid" });
  await expect(employees(onboardingViewer()).onboarding({ state: "Bogus" as never })).rejects.toMatchObject({ reason: "validation" });
  portal.unavailable = true;
  await expect(employees(onboardingViewer()).onboarding()).rejects.toMatchObject({ reason: "unavailable" });
});

it("moves a hired Employee record out of Onboarding view once Active", async () => {
  expect((await employees(onboardingViewer()).onboarding()).rows.map(r => r.employeeNumber)).toEqual(["BR-EMP-0001"]);
  await db.exec(`UPDATE hrms_employees SET status = 'Active'`);
  expect((await employees(onboardingViewer()).onboarding()).rows).toEqual([]);
});
