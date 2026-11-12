import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import pg from "pg";
import { encryptEmployeeId } from "../lib/employee-encryption.ts";

/** Synthetic data only; uses HRMS-owned tables so no Careers profile is modified. Caller owns the transaction. */
export async function seedEmployees(db) {
  await db.query(`INSERT INTO public.job_postings
    (id,title,department,description,requirements,employment_type,location,required_documents,screening_criteria,status)
    VALUES ('hrms-employee-demo','Cashier','Retail','Synthetic employee seed','','Full time','Cainta branch','[]','[]','closed')
    ON CONFLICT (id) DO NOTHING`);
  const scenarios = [
    { name: "Maria Santos", status: "Onboarding", account: null },
    { name: "Jose Reyes", status: "Onboarding", account: null },
    { name: "Ana Cruz", status: "Onboarding", account: "requested" },
    { name: "Paolo Garcia", status: "Onboarding", account: "account_created" },
    { name: "Liza Bautista", status: "Active", account: "login_sent" },
    { name: "Carlo Ramos", status: "Active", account: "login_sent" },
    { name: "Mia Rivera", status: "Active", account: "login_sent", missing: "nbi" },
  ];
  const results = [];
  for (const [index, scenario] of scenarios.entries()) {
    const email = `employee-demo-${index + 1}@example.test`;
    const existing = await db.query(`SELECT id FROM public.hrms_employees WHERE email = $1`, [email]);
    if (existing.rows[0]) { results.push({ ...scenario, employeeId: existing.rows[0].id }); continue; }
    const application = (await db.query(`INSERT INTO public.hrms_manual_applications
      (full_name,email,mobile,address,job_posting_id,expected_salary,available_from,added_by_name,status)
      VALUES ($1,$2,'09170000000','Cainta, Rizal','hrms-employee-demo',19000,CURRENT_DATE,'Demo seed','Hired') RETURNING id`, [scenario.name,email])).rows[0];
    const offer = (await db.query(`INSERT INTO public.hrms_offers
      (application_id,status,monthly_salary,start_date,employment_type,schedule,probation,reports_to,branch,created_by_name)
      VALUES ($1,'Accepted',19000,CASE WHEN $2 = 'Onboarding' THEN CURRENT_DATE + 30 ELSE CURRENT_DATE - 90 END,
        'Full-time','Mon-Sat, 6 AM-2 PM','6 months','HRMS Manager','Cainta branch','Demo seed') RETURNING id,start_date`, [application.id,scenario.status])).rows[0];
    const employee = (await db.query(`INSERT INTO public.hrms_employees
      (employee_number,offer_id,application_id,full_name,email,position,department,branch,start_date,monthly_salary,
       employment_type,schedule,probation,reports_to,status,hired_by_name,birthday,sex,civil_status,mobile,home_address,probation_end_date)
      SELECT 'BR-EMP-' || lpad(nextval('public.hrms_employee_number_seq')::text,4,'0'),o.id,o.application_id,$2,$3,
        'Cashier','Retail',o.branch,o.start_date,o.monthly_salary,o.employment_type,o.schedule,o.probation,o.reports_to,$4,
        'Demo seed','1998-05-12','Female','Single','09170000000','Cainta, Rizal',(o.start_date + interval '6 months')::date
      FROM public.hrms_offers o WHERE o.id = $1 RETURNING id`, [offer.id,scenario.name,email,scenario.status])).rows[0];
    const id = employee.id;
    await db.query(`INSERT INTO public.hrms_employee_government_ids (employee_id,sss,philhealth,pagibig_mid,tin) VALUES ($1,$2,$3,$4,$5)`,
      [id,...Object.entries({ sss: '34-1234567-8', philhealth: '123456789012', pagibigMid: '123456789012', tin: '123-456-789' }).map(([field,value]) => encryptEmployeeId(value,id,field))]);
    await db.query(`INSERT INTO public.hrms_employee_emergency_contacts VALUES ($1,'Juan Santos','Sibling','09171111111')`, [id]);
    // Synthetic filenames are metadata only. Never forge gateway file ids or pretend demo files can be viewed.
    for (const type of ['resume','valid-id','nbi','health','sss','philhealth','pagibig']) {
      if (type === scenario.missing) continue;
      await db.query(`INSERT INTO public.hrms_employee_documents (employee_id,document_type,source,file_name,uploaded_at,valid_until)
        VALUES ($1,$2,'upload',$2 || '-demo.pdf',CURRENT_TIMESTAMP,CURRENT_DATE + 180)`, [id,type]);
    }
    if (scenario.account) await db.query(`INSERT INTO public.hrms_account_requests
      (employee_id,status,work_email,portal_role,requested_modules,access_needed_from,personal_email,requester_id,requester_name)
      VALUES ($1,$2,$3,'HR Officer','[]',$4,$3,'demo-seed','Demo seed')`, [id,scenario.account,email,offer.start_date]);
    results.push({ ...scenario, employeeId: id });
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  nextEnv.loadEnvConfig(process.cwd());
  if (process.env.HRMS_ALLOW_DEMO_SEED !== 'true') throw new Error('Set HRMS_ALLOW_DEMO_SEED=true to explicitly enable synthetic employee data');
  if (!process.env.DIRECT_URL) throw new Error('DIRECT_URL is required');
  const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(730031)');
    const result = await seedEmployees(client);
    await client.query('COMMIT');
    console.log(`Seeded ${result.length} Employee records`);
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Employee seed failed; check the database schema and encryption key configuration');
    process.exitCode = 1;
  } finally { await client.end(); }
}
