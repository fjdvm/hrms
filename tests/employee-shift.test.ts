import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { employeesFor, EmployeeError } from "@/lib/employees";
import { FakePortal, portalFetch, FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM } from "./fake-portal";

const SHIFT_MIGRATION = "0042-employee-shift.sql";
let db: PGlite;
let handle: string;
const staff = { name: "Ada", username: "ada", email: "ada@example.test", role: "HR Officer" };
const employees = () => employeesFor(handle, db);
const migrationsDir = new URL("../migrations/", import.meta.url);
const migration = async (name: string) => db.exec(await readFile(new URL(name, migrationsDir), "utf8"));
const names = async () => (await readdir(migrationsDir)).filter((n) => n.endsWith(".sql")).sort();

/** One Employee (with its Offer) whose Work schedule text is as given. */
let count = 0;
async function employee(schedule: string) {
  count += 1;
  await db.query(`INSERT INTO hrms_offers (application_id,monthly_salary,start_date,employment_type,schedule,probation,reports_to,branch,created_by_name)
    VALUES ($1,19000,'2026-01-05','Full-time',$2,'None','Liza','Cainta','Ada')`, [-count, schedule]);
  await db.query(`INSERT INTO hrms_employees (employee_number,offer_id,application_id,full_name,email,position,branch,start_date,monthly_salary,employment_type,schedule,probation,reports_to,hired_by_name)
    VALUES ($1,$2,$3,$4,$5,'Cashier','Cainta','2026-01-05',19000,'Full-time',$6,'None','Liza','Ada')`,
  [`BR-EMP-${count}`, count, -count, `Employee ${count}`, `e${count}@example.test`, schedule]);
  return count;
}

async function start() {
  db = new PGlite();
  count = 0;
  for (const fixture of ["careers-job-postings.sql", "careers-applications.sql"]) {
    await db.exec(await readFile(new URL(`./fixtures/${fixture}`, import.meta.url), "utf8"));
  }
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text, email text)`);
}

beforeEach(() => {
  const portal = new FakePortal();
  handle = portal.signIn(staff, ["Employee Information"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});
afterEach(async () => { await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("backfills only the Employees whose schedule is 'Mon-Sat, 6 AM-2 PM' and leaves the schedule text as it is", async () => {
  await start();
  for (const name of (await names()).filter((n) => n < SHIFT_MIGRATION)) await migration(name);
  const saturday = [await employee("Mon-Sat, 6 AM-2 PM"), await employee("Mon-Sat, 6 AM-2 PM"), await employee("  Mon-Sat, 6 AM-2 PM  ")];
  const others = [await employee("Mon-Fri"), await employee("Mon-Fri"), await employee("Mon-Sat, 8 AM-5 PM")];
  await migration(SHIFT_MIGRATION);

  for (const id of saturday) {
    expect((await employees().read(id)).employment).toMatchObject({ shiftStart: "06:00", shiftEnd: "14:00", workingDays: [1, 2, 3, 4, 5, 6] });
  }
  for (const id of others) {
    expect((await employees().read(id)).employment).toMatchObject({ shiftStart: null, shiftEnd: null, workingDays: null });
  }
  const { rows } = await db.query<{ id: number; schedule: string }>(`SELECT id, schedule FROM hrms_employees ORDER BY id`);
  expect(rows.map((r) => r.schedule)).toEqual(["Mon-Sat, 6 AM-2 PM", "Mon-Sat, 6 AM-2 PM", "  Mon-Sat, 6 AM-2 PM  ", "Mon-Fri", "Mon-Fri", "Mon-Sat, 8 AM-5 PM"]);
  // The backfill is a data fix, not an edit by HR: it adds no history or audit entry.
  expect(await employees().history(saturday[0])).toHaveLength(1);
  expect((await db.query(`SELECT 1 FROM hrms_employee_audit WHERE kind = 'edit'`)).rows).toHaveLength(0);
});

it("is additive: an Employee hired after the migration has no shift", async () => {
  await start();
  for (const name of await names()) await migration(name);
  const id = await employee("Mon-Sat, 6 AM-2 PM");

  expect((await employees().read(id)).employment).toMatchObject({ shiftStart: null, shiftEnd: null, workingDays: null });
});

async function ready() {
  await start();
  for (const name of await names()) await migration(name);
  return employee("Mon-Fri");
}
const shift = { shiftStart: "08:00", shiftEnd: "17:00", workingDays: [5, 1, 2, 3, 4, 3] };

it("stores one fixed shift with sorted, distinct Working days, and reads it back", async () => {
  const id = await ready();
  await employees().editSection(id, "employment", shift);

  expect((await employees().read(id)).employment).toMatchObject({ shiftStart: "08:00", shiftEnd: "17:00", workingDays: [1, 2, 3, 4, 5], schedule: "Mon-Fri" });
});

it("refuses a Shift end that is not after the Shift start, with a specific reason, however the request arrives", async () => {
  const id = await ready();
  for (const [shiftStart, shiftEnd] of [["22:00", "06:00"], ["08:00", "08:00"]]) {
    await expect(employees().editSection(id, "employment", { ...shift, shiftStart, shiftEnd })).rejects.toMatchObject({ reason: "validation", detail: "shift-order" });
  }
  // Changing only one side is checked against the stored shift.
  await employees().editSection(id, "employment", shift);
  await expect(employees().editSection(id, "employment", { shiftEnd: "07:00" })).rejects.toMatchObject({ detail: "shift-order" });
  await expect(employees().editSection(id, "employment", { shiftStart: "17:00" })).rejects.toMatchObject({ detail: "shift-order" });
  expect((await employees().read(id)).employment).toMatchObject({ shiftStart: "08:00", shiftEnd: "17:00" });
});

it("needs at least one Working day, and only the days Monday to Sunday", async () => {
  const id = await ready();
  for (const workingDays of [[], [0], [8], [1.5], ["Mon"]]) {
    await expect(employees().editSection(id, "employment", { ...shift, workingDays })).rejects.toMatchObject({ detail: "shift-days" });
  }
});

it("keeps the shift whole: all three values together, or all cleared together", async () => {
  const id = await ready();
  await expect(employees().editSection(id, "employment", { shiftStart: "08:00" })).rejects.toMatchObject({ detail: "shift-incomplete" });
  await employees().editSection(id, "employment", shift);
  await expect(employees().editSection(id, "employment", { workingDays: null })).rejects.toMatchObject({ detail: "shift-incomplete" });

  await employees().editSection(id, "employment", { shiftStart: null, shiftEnd: null, workingDays: null });
  expect((await employees().read(id)).employment).toMatchObject({ shiftStart: null, shiftEnd: null, workingDays: null });
});

it("refuses times that are not a clock time", async () => {
  const id = await ready();
  for (const shiftStart of ["8:00", "24:00", "08:60", "08:00:00", 800, ""]) {
    const error = await employees().editSection(id, "employment", { ...shift, shiftStart }).catch((e) => e);
    expect(error).toBeInstanceOf(EmployeeError);
    expect(error.reason).toBe("validation");
  }
});

it("records a shift change in the Employee history and the audit log like other employment edits", async () => {
  const id = await ready();
  await employees().editSection(id, "employment", shift, "2026-12-01");
  await employees().editSection(id, "employment", { shiftEnd: "16:00" });

  const history = await employees().history(id);
  expect(history).toContainEqual(expect.objectContaining({ kind: "Changed", field: "shiftStart", actorName: "Ada", effectiveDate: "2026-12-01", oldValue: null, newValue: "08:00:00" }));
  expect(history).toContainEqual(expect.objectContaining({ kind: "Changed", field: "workingDays", newValue: [1, 2, 3, 4, 5] }));
  expect(history).toContainEqual(expect.objectContaining({ kind: "Changed", field: "shiftEnd", oldValue: "17:00:00", newValue: "16:00:00" }));
  const audit = await employees().activity(id);
  expect(audit.map((entry) => entry.field)).toEqual(expect.arrayContaining(["shiftStart", "shiftEnd", "workingDays"]));
});
