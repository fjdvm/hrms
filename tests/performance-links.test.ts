import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LinkError, NEW_ACCOUNT_REASON, performanceFor, type RawAttendanceRow } from "@/lib/performance";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
let count = 0;
const clock = new Date("2026-12-01T02:00:00Z");
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => clock);
const GATEWAY = "https://gateway.test";
const NOV = { type: "Month", year: 2026, month: 11 } as const;

beforeEach(async () => {
  count = 0;
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) await db.exec(await readFile(new URL(name, directory), "utf8"));
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  portal = new FakePortal();
  handle = portal.signIn(staff, ["Performance"]);
  const portalOnly = portalFetch(portal);
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) =>
    String(input).startsWith(GATEWAY) ? new Response(JSON.stringify({ id: "x" }), { status: 201 }) : portalOnly(input as never, init));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
  vi.stubEnv("API_GATEWAY_URL", GATEWAY);
  vi.stubEnv("API_GATEWAY_KEY", "gateway-key");
  vi.spyOn(console, "error").mockImplementation(() => {});
  // The sales KPI and a Branch Cashier set that weighs it (the items carry the real weights; the legacy columns keep a valid total of their own).
  await db.query(`INSERT INTO hrms_kpis (id, name, description, source, target, sort_order) VALUES ('sales', 'Sales', 'Net sales per present day', 'POS', '100%', 6)`);
  const id = (await db.query<{ id: number }>(`INSERT INTO hrms_weight_sets (name, position, position_key, attendance_rate, punctuality, full_shift, training_completion, evaluator_rating, created_by_id, created_by_name, updated_by_id, updated_by_name)
    VALUES ('Branch Cashier', 'Branch Cashier', 'branch cashier', 20, 20, 20, 20, 20, 'u', 'U', 'u', 'U') RETURNING id`)).rows[0].id;
  await db.query(`INSERT INTO hrms_weight_set_items (set_id, kpi_id, weight) VALUES ($1, 'attendanceRate', 30), ($1, 'punctuality', 20), ($1, 'fullShift', 10), ($1, 'trainingCompletion', 10), ($1, 'evaluatorRating', 20), ($1, 'sales', 10)`, [id]);
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function employee(name: string, position = "Branch Cashier") {
  count += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, '2026-01-05', 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [count])).rows[0].id;
  return (await db.query<{ id: number }>(`INSERT INTO hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, status, hired_by_name, shift_start, shift_end, working_days)
    VALUES ($1, $2, $3, $4, $5, $6, 'Retail', 'Cainta branch', '2026-01-05', 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Active', 'Ada', '08:00', '17:00', '{1,2,3,4,5}') RETURNING id`,
  [`2026-${String(count).padStart(3, "0")}`, offer, count, name, `emp${count}@example.test`, position])).rows[0].id;
}
const problem = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(LinkError);
  return error as LinkError;
};
const auditRows = async () => (await db.query<{ actor_id: string; actor_name: string; action: string; subject: string; subject_id: string; detail: Record<string, unknown> }>(
  `SELECT actor_id, actor_name, action, subject, subject_id, detail FROM hrms_performance_audit WHERE action LIKE 'pos-account-%' ORDER BY id`)).rows;

describe("linking a POS account", () => {
  it("links an account to a cashier and records who, when and the Employee and account in the audit log", async () => {
    const ana = await employee("Ana Cruz");
    const link = await performance().linkPosAccount({ employeeId: ana, portalUserId: " u-pos-1 " });

    expect(link).toMatchObject({ portalUserId: "u-pos-1", employeeId: ana, linkedByName: "Ada Okafor", linkReason: null, unlinkedAt: null });
    expect(await performance().listPosAccounts(ana)).toEqual([link]);
    expect(await auditRows()).toEqual([{ actor_id: "u-ada", actor_name: "Ada Okafor", action: "pos-account-linked", subject: "employee", subject_id: String(ana),
      detail: { linkId: link.id, employeeId: ana, employeeNumber: "2026-001", portalUserId: "u-pos-1", reason: null } }]);
  });

  it("refuses an Employee who is not a cashier, with the reason, and records nothing", async () => {
    const ben = await employee("Ben Reyes", "Barista");
    const error = await problem(performance().linkPosAccount({ employeeId: ben, portalUserId: "u-pos-1" }));

    expect(error.problem).toBe("not-cashier");
    expect(error.message).toBe("Not a cashier position");
    expect(await performance().listPosAccounts(ben)).toEqual([]);
    expect(await auditRows()).toEqual([]);
    expect((await problem(performance().linkPosAccount({ employeeId: 9999, portalUserId: "u-pos-1" }))).problem).toBe("unknown-employee");
  });

  it("gives an Employee a second account only with the reason, and adds their accounts together", async () => {
    const ana = await employee("Ana Cruz");
    await performance().linkPosAccount({ employeeId: ana, portalUserId: "u-pos-1" });

    expect((await problem(performance().linkPosAccount({ employeeId: ana, portalUserId: "u-pos-2" }))).problem).toBe("reason-required");
    expect((await problem(performance().linkPosAccount({ employeeId: ana, portalUserId: "u-pos-2", reason: "Because" }))).problem).toBe("reason-invalid");
    const second = await performance().linkPosAccount({ employeeId: ana, portalUserId: "u-pos-2", reason: NEW_ACCOUNT_REASON });

    expect(second.linkReason).toBe(NEW_ACCOUNT_REASON);
    expect((await performance().listPosAccounts(ana)).map((link) => link.portalUserId)).toEqual(["u-pos-1", "u-pos-2"]);
    expect((await auditRows()).map((row) => row.detail.reason)).toEqual([null, NEW_ACCOUNT_REASON]);
  });

  it("refuses the reason for a first account, and an account that is already linked, to anyone", async () => {
    const ana = await employee("Ana Cruz");
    const cai = await employee("Cai Lim");
    expect((await problem(performance().linkPosAccount({ employeeId: ana, portalUserId: "u-pos-1", reason: NEW_ACCOUNT_REASON }))).problem).toBe("reason-not-needed");
    await performance().linkPosAccount({ employeeId: ana, portalUserId: "u-pos-1" });

    const taken = await problem(performance().linkPosAccount({ employeeId: cai, portalUserId: "u-pos-1" }));
    expect(taken.problem).toBe("account-taken");
    expect(taken.extra.heldBy).toBe(ana);
    expect((await problem(performance().linkPosAccount({ employeeId: ana, portalUserId: "u-pos-1", reason: NEW_ACCOUNT_REASON }))).problem).toBe("account-taken");
    expect((await problem(performance().linkPosAccount({ employeeId: cai, portalUserId: "u pos; DROP" }))).problem).toBe("account-invalid");
  });

  it("allows only one active link per account in the database", async () => {
    const ana = await employee("Ana Cruz");
    const cai = await employee("Cai Lim");
    await performance().linkPosAccount({ employeeId: ana, portalUserId: "u-pos-1" });

    await expect(db.query(`INSERT INTO hrms_pos_account_links (portal_user_id, employee_id, linked_by_id, linked_by_name) VALUES ('u-pos-1', $1, 'u', 'U')`, [cai])).rejects.toThrow();
  });
});

describe("unlinking a POS account", () => {
  it("needs a reason, ends the link and keeps it in the history, then lets the account go to someone else", async () => {
    const ana = await employee("Ana Cruz");
    const cai = await employee("Cai Lim");
    const link = await performance().linkPosAccount({ employeeId: ana, portalUserId: "u-pos-1" });

    expect((await problem(performance().unlinkPosAccount(link.id, { reason: undefined }))).problem).toBe("unlink-reason-required");
    expect((await problem(performance().unlinkPosAccount(link.id, { reason: "Felt like it" }))).problem).toBe("unlink-reason-required");
    expect((await problem(performance().unlinkPosAccount(link.id, { reason: "Other" }))).problem).toBe("note-required");
    expect((await problem(performance().unlinkPosAccount(link.id, { reason: "Other", note: "   " }))).problem).toBe("note-required");
    expect((await problem(performance().unlinkPosAccount(link.id, { reason: "Other", note: "x".repeat(301) }))).problem).toBe("note-too-long");
    expect(await performance().listPosAccounts(ana)).toHaveLength(1);

    const ended = await performance().unlinkPosAccount(link.id, { reason: "Wrong person linked" });
    expect(ended).toMatchObject({ id: link.id, unlinkedByName: "Ada Okafor", unlinkReason: "Wrong person linked", unlinkNote: null });
    expect(await performance().listPosAccounts(ana)).toEqual([]);
    expect((await db.query(`SELECT id FROM hrms_pos_account_links`)).rows).toHaveLength(1);
    expect((await problem(performance().unlinkPosAccount(link.id, { reason: "Wrong person linked" }))).problem).toBe("already-unlinked");
    expect((await problem(performance().unlinkPosAccount(9999, { reason: "Wrong person linked" }))).problem).toBe("unknown-link");

    await performance().linkPosAccount({ employeeId: cai, portalUserId: "u-pos-1" });
    expect((await auditRows()).map((row) => [row.action, row.subject_id])).toEqual([["pos-account-linked", String(ana)], ["pos-account-unlinked", String(ana)], ["pos-account-linked", String(cai)]]);
  });

  it("records the reason and the note in the audit log", async () => {
    const ana = await employee("Ana Cruz");
    const link = await performance().linkPosAccount({ employeeId: ana, portalUserId: "u-pos-1" });
    await performance().unlinkPosAccount(link.id, { reason: "Other", note: "  Shared   till login.  " });

    const [, unlinked] = await auditRows();
    expect(unlinked).toMatchObject({ actor_id: "u-ada", actor_name: "Ada Okafor", action: "pos-account-unlinked",
      detail: { linkId: link.id, employeeId: ana, employeeNumber: "2026-001", portalUserId: "u-pos-1", reason: "Other", note: "Shared till login." } });
  });

  it("is refused to a session without the Performance Module", async () => {
    const ana = await employee("Ana Cruz");
    const other = performance(portal.signIn({ ...staff, id: "u-bo", username: "bo", name: "Bo Lee" }, ["Applications"]));

    await expect(other.linkPosAccount({ employeeId: ana, portalUserId: "u-pos-1" })).rejects.toThrow();
    expect(await auditRows()).toEqual([]);
  });
});

describe("naming POS accounts", () => {
  it("takes the name from the Portal directory, and carries the staff number and branch only when there is no match", async () => {
    portal.directory = [{ id: "u-pos-1", username: "maria", name: "Maria Santos", modules: ["Point of sale"] }];
    const rows = await performance().describePosAccounts([
      { portalUserId: "u-pos-1", staffNumber: "S-1", branch: "Cainta" }, { portalUserId: "u-pos-9", staffNumber: "S-9", branch: "Antipolo" }, { portalUserId: "u-pos-8" }]);

    expect(rows).toEqual([
      { portalUserId: "u-pos-1", name: "Maria Santos", staffNumber: "S-1", branch: "Cainta" },
      { portalUserId: "u-pos-9", name: null, staffNumber: "S-9", branch: "Antipolo" },
      { portalUserId: "u-pos-8", name: null, staffNumber: null, branch: null }]);
  });

  it("falls back to the staff number and branch when the Portal cannot answer", async () => {
    const rows = await performanceFor(handle, db, () => clock, {}, async () => null).describePosAccounts([{ portalUserId: "u-pos-1", staffNumber: "S-1", branch: "Cainta" }]);

    expect(rows).toEqual([{ portalUserId: "u-pos-1", name: null, staffNumber: "S-1", branch: "Cainta" }]);
  });
});

describe("submitted and reopened Evaluations", () => {
  const days = Array.from({ length: 30 }, (_, i) => `2026-11-${String(i + 1).padStart(2, "0")}`).filter((d) => {
    const day = new Date(`${d}T00:00:00Z`).getUTCDay();
    return day >= 1 && day <= 5;
  });
  const stored = async () => JSON.stringify([(await db.query(`SELECT * FROM hrms_evaluation_submissions ORDER BY id`)).rows, (await db.query(`SELECT * FROM hrms_evaluation_results ORDER BY submission_id, kpi_id`)).rows]);

  it("stay as they are when an account is linked or unlinked; a reopened one reads the links as they are then", async () => {
    const id = await employee("Ana Cruz");
    const rows: RawAttendanceRow[] = days.map((date) => ({ employeeNumber: "2026-001", date, timeIn: "08:00", timeOut: "17:00" }));
    await performance().importAttendance({ fileName: "ana.csv", rows });
    const period = await performance().openPeriod(NOV);
    const t = (await db.query<{ id: number }>(`INSERT INTO hrms_trainings (title, trainer, training_date, start_time, end_time, mode, location, created_by_name)
      VALUES ('Session', 'QA', '2026-11-02', '09:00', '11:00', 'In person', 'Kitchen', 'Ada') RETURNING id`)).rows[0].id;
    await db.query(`INSERT INTO hrms_training_assignments (training_id, employee_id, status) VALUES ($1, $2, 'Completed')`, [t, id]);
    await performance().saveRating(id, period.id, { rating: 80, comments: "Reliable." });
    await performance().submitEvaluation(id, period.id);
    const before = await stored();
    const evaluated = await performance().evaluationFor(id, period.id);

    const link = await performance().linkPosAccount({ employeeId: id, portalUserId: "u-pos-1" });
    expect(await performance().evaluationFor(id, period.id)).toEqual(evaluated);
    await performance().unlinkPosAccount(link.id, { reason: "Wrong person linked" });
    expect(await performance().evaluationFor(id, period.id)).toEqual(evaluated);
    expect(await stored()).toBe(before);

    // Reopened: it is recomputed, and reads the active links when it does. No scoring rule reads sales yet, so the figures do not move.
    await performance().reopenEvaluation(id, period.id, "A bad import was corrected.");
    const reopened = await performance().evaluationFor(id, period.id);
    await performance().linkPosAccount({ employeeId: id, portalUserId: "u-pos-2" });
    expect(await performance().evaluationFor(id, period.id)).toEqual(reopened);
    expect(await stored()).toBe(before);
    expect((await performance().listPosAccounts(id)).map((l) => l.portalUserId)).toEqual(["u-pos-2"]);
  });
});
