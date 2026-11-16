import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeriodError, performanceFor } from "@/lib/performance";
import { scoreEvaluation } from "@/lib/performance-scoring";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => new Date("2026-11-16T02:00:00Z"));
let employeeCount = 0;

/** An Employee with a shift (Working days as ISO weekdays), or none. */
async function employee(name: string, { start = "2026-01-05", days }: { start?: string; days?: number[] } = {}) {
  employeeCount += 1;
  const offer = (await db.query<{ id: number }>(`INSERT INTO public.hrms_offers (application_id, status, monthly_salary, start_date, employment_type, schedule, probation, reports_to, branch, created_by_name)
    VALUES ($1, 'Accepted', 19000, $2, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Cainta branch', 'Ada') RETURNING id`, [employeeCount, start])).rows[0].id;
  const id = (await db.query<{ id: number }>(`INSERT INTO public.hrms_employees (employee_number, offer_id, application_id, full_name, email, position, department, branch, start_date, monthly_salary, employment_type, schedule, probation, reports_to, hired_by_name)
    VALUES ($1, $2, $3, $4, $5, 'Branch Cashier', 'Retail', 'Cainta branch', $6, 19000, 'Full-time', 'Mon-Fri', 'None', 'Paolo', 'Ada') RETURNING id`,
  [`2026-${String(employeeCount).padStart(3, "0")}`, offer, employeeCount, name, `${name.split(" ")[0].toLowerCase()}@example.test`, start])).rows[0].id;
  if (days) await db.query(`UPDATE public.hrms_employees SET shift_start = '08:00', shift_end = '17:00', working_days = $2::smallint[] WHERE id = $1`, [id, days]);
  return id;
}
const NOV = { type: "Month", year: 2026, month: 11 } as const;

beforeEach(async () => {
  employeeCount = 0;
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  await db.exec(`CREATE SCHEMA neon_auth; CREATE TABLE neon_auth."user" (id text PRIMARY KEY);`);
  portal = new FakePortal();
  handle = portal.signIn(staff, ["Performance"]);
  vi.stubGlobal("fetch", portalFetch(portal));
  vi.stubEnv("PORTAL_URL", FAKE_PORTAL_URL);
  vi.stubEnv("PORTAL_SYSTEM_NAME", FAKE_SYSTEM);
  vi.stubEnv("PORTAL_SYSTEM_SECRET", FAKE_SECRET);
  vi.stubEnv("HRMS_DEV_BYPASS", "");
});
afterEach(async () => { if (!db.closed) await db.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

const problem = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => undefined, (e: unknown) => e);
  expect(error).toBeInstanceOf(PeriodError);
  return error as PeriodError;
};
const audit = async () => (await db.query<{ actor_name: string; action: string; subject: string; detail: unknown }>(`SELECT actor_name, action, subject, detail FROM hrms_performance_audit ORDER BY id`)).rows;

describe("opening an Evaluation period", () => {
  it("fills the dates of a Month and of a Quarter, with a 10 minute grace by default", async () => {
    const month = await performance().openPeriod({ type: "Month", year: 2026, month: 11 });
    const quarter = await performance().openPeriod({ type: "Quarter", year: 2027, quarter: 1 });

    expect(month).toMatchObject({ type: "Month", kind: "Company", employeeId: null, start: "2026-11-01", end: "2026-11-30", graceMinutes: 10, name: "November 2026", createdByName: "Ada Okafor" });
    expect(quarter).toMatchObject({ type: "Quarter", start: "2027-01-01", end: "2027-03-31", graceMinutes: 10, name: "Q1 2027" });
  });

  it("takes a Custom range, and a grace period per period", async () => {
    const custom = await performance().openPeriod({ type: "Custom", start: "2026-11-03", end: "2026-11-20", graceMinutes: 15 });
    const sameDay = await performance().openPeriod({ type: "Custom", start: "2026-12-01", end: "2026-12-01", graceMinutes: 0 });

    expect(custom).toMatchObject({ type: "Custom", start: "2026-11-03", end: "2026-11-20", graceMinutes: 15, name: "3 Nov – 20 Nov 2026" });
    expect(sameDay).toMatchObject({ start: "2026-12-01", end: "2026-12-01", graceMinutes: 0 });
    expect((await performance().listPeriods()).map((p) => p.start)).toEqual(["2026-12-01", "2026-11-03"]);
  });

  it("refuses a Custom end before its start, an impossible range and a bad date, however the request arrives", async () => {
    expect((await problem(performance().openPeriod({ type: "Custom", start: "2026-11-20", end: "2026-11-19" }))).problem).toBe("end-before-start");
    expect((await problem(performance().openPeriod({ type: "Custom", start: "2026-01-01", end: "2027-01-02" }))).problem).toBe("range-too-long");
    expect((await performance().openPeriod({ type: "Custom", start: "2026-01-01", end: "2026-12-31" })).type).toBe("Custom");
    for (const [start, end] of [["2026-02-30", "2026-03-01"], ["Nov 3", "2026-11-20"], ["2026-11-03", ""], ["1999-12-31", "2000-01-02"], [undefined, "2026-11-20"], [20261103, "2026-11-20"]] as const) {
      expect((await problem(performance().openPeriod({ type: "Custom", start, end } as never))).problem).toBe("dates-invalid");
    }
  });

  it("refuses a bad type, month, quarter, year or grace period", async () => {
    expect((await problem(performance().openPeriod({ type: "Week" } as never))).problem).toBe("type-invalid");
    expect((await problem(performance().openPeriod(null as never))).problem).toBe("type-invalid");
    for (const input of [{ type: "Month", year: 2026, month: 13 }, { type: "Month", year: 2026, month: 0 }, { type: "Month", year: 1999, month: 1 }, { type: "Month", year: 2026.5, month: 1 },
      { type: "Quarter", year: 2026, quarter: 5 }, { type: "Quarter", year: 2101, quarter: 1 }, { type: "Month", year: "2026", month: 1 }]) {
      expect((await problem(performance().openPeriod(input as never))).problem).toBe("year-invalid");
    }
    for (const graceMinutes of [-1, 121, 1.5, "10", Number.NaN, null]) {
      expect((await problem(performance().openPeriod({ ...NOV, graceMinutes } as never))).problem).toBe("grace-invalid");
    }
    expect(await performance().listPeriods()).toEqual([]);
  });

  it("refuses a period that overlaps another by date and names the one it overlaps", async () => {
    await performance().openPeriod({ type: "Quarter", year: 2026, quarter: 4 });

    const month = await problem(performance().openPeriod(NOV));
    expect(month.problem).toBe("overlap");
    expect(month.extra.overlaps?.name).toBe("Q4 2026");
    const custom = await problem(performance().openPeriod({ type: "Custom", start: "2026-12-31", end: "2027-01-10" }));
    expect(custom.extra.overlaps?.name).toBe("Q4 2026");
    // A single shared day is still an overlap; the day before and the day after are not.
    expect((await problem(performance().openPeriod({ type: "Custom", start: "2026-10-01", end: "2026-10-01" }))).problem).toBe("overlap");
    expect((await performance().openPeriod({ type: "Custom", start: "2026-09-01", end: "2026-09-30" })).name).toBe("1 Sep – 30 Sep 2026");
    expect((await performance().openPeriod({ type: "Custom", start: "2027-01-01", end: "2027-01-31" })).start).toBe("2027-01-01");
    expect(await performance().listPeriods()).toHaveLength(3);
  });

  it("refuses the other way round too: a small period first, then a bigger one over it", async () => {
    await performance().openPeriod({ type: "Custom", start: "2026-11-10", end: "2026-11-12" });

    const quarter = await problem(performance().openPeriod({ type: "Quarter", year: 2026, quarter: 4 }));
    expect(quarter.extra.overlaps?.name).toBe("10 Nov – 12 Nov 2026");
  });

  it("is backed by the database, so even a direct write cannot overlap two company-wide periods", async () => {
    await performance().openPeriod(NOV);

    await expect(db.query(`INSERT INTO hrms_evaluation_periods (type, start_date, end_date, created_by_id, created_by_name) VALUES ('Custom', '2026-11-30', '2026-12-05', 'a', 'A')`)).rejects.toThrow();
    await expect(db.query(`INSERT INTO hrms_evaluation_periods (type, start_date, end_date, created_by_id, created_by_name) VALUES ('Custom', '2026-12-05', '2026-12-01', 'a', 'A')`)).rejects.toThrow();
    expect((await db.query(`SELECT 1 FROM hrms_evaluation_periods`)).rows).toHaveLength(1);
  });

  it("carries a kind and a nullable Employee reference, empty for every company-wide period, with no open or closed state", async () => {
    const period = await performance().openPeriod(NOV);
    const columns = (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = 'hrms_evaluation_periods'`)).rows.map((r) => r.column_name);

    expect(period).toMatchObject({ kind: "Company", employeeId: null });
    expect(columns).toEqual(expect.arrayContaining(["kind", "employee_id"]));
    expect(columns.filter((c) => /status|state|closed|open/i.test(c))).toEqual([]);
    const ana = await employee("Ana Cruz");
    await expect(db.query(`INSERT INTO hrms_evaluation_periods (type, kind, employee_id, start_date, end_date, created_by_id, created_by_name) VALUES ('Custom', 'Company', ${ana}, '2027-05-01', '2027-05-10', 'a', 'A')`)).rejects.toThrow();
    // A later per-Employee period fits without a migration, and does not collide with a company-wide one.
    await db.query(`INSERT INTO hrms_evaluation_periods (type, kind, employee_id, start_date, end_date, created_by_id, created_by_name) VALUES ('Custom', 'Employee', ${ana}, '2026-11-10', '2026-11-12', 'a', 'A')`);
  });

  it("records who opened it", async () => {
    await performance().openPeriod({ ...NOV, graceMinutes: 5 });

    expect(await audit()).toEqual([{ actor_name: "Ada Okafor", action: "period-opened", subject: "period", detail: { type: "Month", start: "2026-11-01", end: "2026-11-30", graceMinutes: 5 } }]);
  });
});

describe("the company calendar", () => {
  it("keeps non-working dates with a name, a type, optional notes and who added them", async () => {
    const holiday = await performance().addNonWorkingDate({ date: "2026-11-30", name: "Bonifacio Day", type: "Holiday" });
    await performance().addNonWorkingDate({ date: "2026-11-02", name: "  Inventory   closure ", type: "Closure", notes: "  Stock count, all branches  " });
    await performance().addNonWorkingDate({ date: "2026-12-24", name: "Company outing (Antipolo)", type: "Other", notes: "" });

    expect(holiday).toMatchObject({ date: "2026-11-30", name: "Bonifacio Day", type: "Holiday", notes: null, addedByName: "Ada Okafor" });
    expect(await performance().listNonWorkingDates()).toEqual([
      expect.objectContaining({ date: "2026-11-02", name: "Inventory closure", type: "Closure", notes: "Stock count, all branches" }),
      expect.objectContaining({ date: "2026-11-30", name: "Bonifacio Day" }),
      expect.objectContaining({ date: "2026-12-24", name: "Company outing (Antipolo)", type: "Other", notes: null }),
    ]);
    expect((await performance().listNonWorkingDates({ from: "2026-11-01", to: "2026-11-30" })).map((e) => e.date)).toEqual(["2026-11-02", "2026-11-30"]);
  });

  it("does not add the same date twice, however it is written, and says which entry has it", async () => {
    await performance().addNonWorkingDate({ date: "2026-11-30", name: "Bonifacio Day", type: "Holiday" });

    const again = await problem(performance().addNonWorkingDate({ date: "2026-11-30", name: "Another name", type: "Closure" }));
    expect(again.problem).toBe("date-taken");
    expect(again.extra.existing).toBe("Bonifacio Day");
    await expect(db.query(`INSERT INTO hrms_company_calendar (date, name, type, created_by_id, created_by_name) VALUES ('2026-11-30', 'X', 'Other', 'a', 'A')`)).rejects.toThrow();
    expect(await performance().listNonWorkingDates()).toHaveLength(1);
  });

  it("refuses a bad date, name, type or notes instead of changing them", async () => {
    const ok = { date: "2026-12-25", name: "Christmas Day", type: "Holiday" };
    for (const [change, expected] of [[{ date: "2026-02-30" }, "date-invalid"], [{ date: "" }, "date-invalid"], [{ date: "1999-12-25" }, "date-invalid"], [{ date: undefined }, "date-invalid"],
      [{ name: "" }, "name-empty"], [{ name: "   " }, "name-empty"], [{ name: "x".repeat(101) }, "name-too-long"], [{ name: "Day<b>" }, "name-characters"], [{ name: "Day\u0000" }, "name-characters"], [{ name: 5 }, "name-characters"],
      [{ type: "Birthday" }, "calendar-type-invalid"], [{ type: undefined }, "calendar-type-invalid"], [{ notes: "x".repeat(501) }, "notes-invalid"], [{ notes: "a\u0007b" }, "notes-invalid"], [{ notes: 5 }, "notes-invalid"]] as const) {
      expect((await problem(performance().addNonWorkingDate({ ...ok, ...change } as never))).problem).toBe(expected);
    }
    expect(await performance().listNonWorkingDates()).toEqual([]);
    await expect(performance().listNonWorkingDates({ from: "2026-12-01", to: "2026-11-01" })).rejects.toBeInstanceOf(PeriodError);
  });

  it("records who added a date", async () => {
    await performance().addNonWorkingDate({ date: "2026-11-30", name: "Bonifacio Day", type: "Holiday" });

    expect(await audit()).toEqual([{ actor_name: "Ada Okafor", action: "non-working-date-added", subject: "calendar", detail: { date: "2026-11-30", name: "Bonifacio Day", type: "Holiday" } }]);
  });
});

describe("scheduled days", () => {
  it("works out a Mon–Fri and a Mon–Sat Employee's days in a month", async () => {
    const period = await performance().openPeriod(NOV);
    const fri = await employee("Ana Cruz", { days: [1, 2, 3, 4, 5] });
    const sat = await employee("Bea Reyes", { days: [1, 2, 3, 4, 5, 6] });

    const ana = await performance().scheduleFor(fri, period.id);
    const bea = await performance().scheduleFor(sat, period.id);
    expect(ana).toMatchObject({ scorable: true, excusedDays: [] });
    expect(ana.scorable && ana.scheduledDays).toHaveLength(21);
    expect(bea.scorable && bea.scheduledDays).toHaveLength(25);
  });

  it("starts a mid-period joiner at their start date", async () => {
    const period = await performance().openPeriod(NOV);
    const joiner = await employee("Cy Dela Cruz", { start: "2026-11-16", days: [1, 2, 3, 4, 5] });
    const late = await employee("Dan Uy", { start: "2026-12-07", days: [1, 2, 3, 4, 5] });
    const midweek = await employee("Eli Ramos", { start: "2026-11-18", days: [1, 2, 3, 4, 5, 6] });

    const cy = await performance().scheduleFor(joiner, period.id);
    expect(cy.scorable && cy.scheduledDays).toHaveLength(11);
    expect(cy.scorable && cy.scheduledDays[0]).toBe("2026-11-16");
    const dan = await performance().scheduleFor(late, period.id);
    expect(dan).toEqual({ scorable: true, scheduledDays: [], excusedDays: [] });
    const eli = await performance().scheduleFor(midweek, period.id);
    expect(eli.scorable && eli.scheduledDays[0]).toBe("2026-11-18");
    expect(eli.scorable && eli.scheduledDays).toHaveLength(11);
  });

  it("takes a holiday off a Working day, and ignores one on a weekend the Employee does not work", async () => {
    const period = await performance().openPeriod(NOV);
    const fri = await employee("Ana Cruz", { days: [1, 2, 3, 4, 5] });
    const sat = await employee("Bea Reyes", { days: [1, 2, 3, 4, 5, 6] });
    await performance().addNonWorkingDate({ date: "2026-11-30", name: "Bonifacio Day", type: "Holiday" }); // a Monday
    await performance().addNonWorkingDate({ date: "2026-11-07", name: "Inventory", type: "Closure" }); // a Saturday
    await performance().addNonWorkingDate({ date: "2026-11-08", name: "Town fiesta", type: "Other" }); // a Sunday
    await performance().addNonWorkingDate({ date: "2026-12-25", name: "Christmas Day", type: "Holiday" }); // another period

    const ana = await performance().scheduleFor(fri, period.id);
    const bea = await performance().scheduleFor(sat, period.id);
    expect(ana.scorable && ana.scheduledDays).toHaveLength(20);
    expect(ana.scorable && ana.scheduledDays).not.toContain("2026-11-30");
    expect(bea.scorable && bea.scheduledDays).toHaveLength(23);
    expect(bea.scorable && bea.scheduledDays).not.toContain("2026-11-07");
  });

  it("applies one calendar to every period a date falls in, so a holiday is entered once", async () => {
    const month = await performance().openPeriod({ type: "Month", year: 2026, month: 12 });
    const custom = await performance().openPeriod({ type: "Custom", start: "2027-01-01", end: "2027-01-31" });
    const ana = await employee("Ana Cruz", { days: [1, 2, 3, 4, 5] });
    const before = await performance().scheduleFor(ana, month.id);
    await performance().addNonWorkingDate({ date: "2026-12-25", name: "Christmas Day", type: "Holiday" }); // a Friday
    await performance().addNonWorkingDate({ date: "2027-01-01", name: "New Year's Day", type: "Holiday" }); // a Friday

    const after = await performance().scheduleFor(ana, month.id);
    expect(before.scorable && before.scheduledDays).toHaveLength(23);
    expect(after.scorable && after.scheduledDays).toHaveLength(22);
    expect((await performance().scheduleFor(ana, custom.id)) as { scheduledDays: string[] }).toMatchObject({ scheduledDays: expect.not.arrayContaining(["2027-01-01"]) });
  });

  it("reports an Employee with no shift as not scorable, not as zero", async () => {
    const period = await performance().openPeriod(NOV);
    const none = await employee("Fay Lim");

    expect(await performance().scheduleFor(none, period.id)).toEqual({ scorable: false, reason: "no-shift" });
  });

  it("refuses an unknown period or Employee", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz", { days: [1, 2, 3, 4, 5] });

    for (const id of [999, 0, -1, 1.5]) expect((await problem(performance().scheduleFor(ana, id))).problem).toBe("unknown-period");
    for (const id of [999, 0, -1]) expect((await problem(performance().scheduleFor(id, period.id))).problem).toBe("unknown-employee");
  });
});

describe("excused days", () => {
  it("records excused days per Employee and period, with who recorded them", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz", { days: [1, 2, 3, 4, 5] });
    const bea = await employee("Bea Reyes", { days: [1, 2, 3, 4, 5] });

    expect(await performance().excuseDays(ana, period.id, ["2026-11-10", "2026-11-04", "2026-11-04"])).toEqual(["2026-11-04", "2026-11-10"]);
    expect(await performance().excuseDays(ana, period.id, ["2026-11-10", "2026-11-12"])).toEqual(["2026-11-04", "2026-11-10", "2026-11-12"]);
    expect(await performance().excuseDays(bea, period.id, ["2026-11-05"])).toEqual(["2026-11-05"]);
    const rows = (await db.query<{ employee_id: number; recorded_by_name: string }>(`SELECT employee_id, recorded_by_name FROM hrms_excused_days ORDER BY employee_id, date`)).rows;
    expect(rows.map((r) => [r.employee_id, r.recorded_by_name])).toEqual([[ana, "Ada Okafor"], [ana, "Ada Okafor"], [ana, "Ada Okafor"], [bea, "Ada Okafor"]]);
    // Only newly excused days are logged.
    expect((await audit()).filter((a) => a.action === "days-excused").map((a) => (a.detail as { dates: string[] }).dates)).toEqual([["2026-11-04", "2026-11-10"], ["2026-11-12"], ["2026-11-05"]]);
  });

  it("refuses a day outside the period, a bad date or list, and an unknown Employee or period", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz", { days: [1, 2, 3, 4, 5] });

    expect((await problem(performance().excuseDays(ana, period.id, ["2026-12-01"]))).problem).toBe("day-outside-period");
    expect((await problem(performance().excuseDays(ana, period.id, ["2026-11-10", "2026-10-31"]))).problem).toBe("day-outside-period");
    for (const dates of [[], ["2026-02-30"], ["Nov 10"], [20261110], "2026-11-10", null, Array.from({ length: 367 }, () => "2026-11-10")]) {
      expect((await problem(performance().excuseDays(ana, period.id, dates as never))).problem).toBe("dates-invalid");
    }
    expect((await problem(performance().excuseDays(999, period.id, ["2026-11-10"]))).problem).toBe("unknown-employee");
    expect((await problem(performance().excuseDays(ana, 999, ["2026-11-10"]))).problem).toBe("unknown-period");
    expect((await db.query(`SELECT 1 FROM hrms_excused_days`)).rows).toHaveLength(0);
  });

  it("is subtracted from the scheduled days when the score is worked out", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz", { days: [1, 2, 3, 4, 5] });
    await performance().excuseDays(ana, period.id, ["2026-11-02", "2026-11-03"]);
    const schedule = await performance().scheduleFor(ana, period.id);
    if (!schedule.scorable) throw new Error("expected a scorable Employee");

    expect(schedule.excusedDays).toEqual(["2026-11-02", "2026-11-03"]);
    const rows = schedule.scheduledDays.filter((day) => !schedule.excusedDays.includes(day)).map((date) => ({ date, timeIn: "08:00", timeOut: "17:00" }));
    const scoring = scoreEvaluation({ rows, shift: { start: "08:00", end: "17:00" }, graceMinutes: period.graceMinutes, scheduledDays: schedule.scheduledDays, excusedDays: schedule.excusedDays,
      training: { completed: 0, due: 0 }, rating: 90, weights: { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 } });
    expect(scoring.counts).toMatchObject({ counted: 19, present: 19 });
    expect(scoring.results.find((r) => r.kpi === "attendanceRate")).toMatchObject({ result: 100 });
  });
});

describe("access is the Module grant alone", () => {
  it("refuses every operation to Staff without the Performance Module, whatever their role", async () => {
    const period = await performance().openPeriod(NOV);
    const ana = await employee("Ana Cruz", { days: [1, 2, 3, 4, 5] });
    const denied = performance(portal.signIn({ ...staff, role: "Super Admin" }, ["Training", "Employee Information"]));

    for (const call of [() => denied.listPeriods(), () => denied.openPeriod({ type: "Month", year: 2027, month: 1 }), () => denied.listNonWorkingDates(),
      () => denied.addNonWorkingDate({ date: "2026-12-25", name: "Christmas Day", type: "Holiday" }), () => denied.excuseDays(ana, period.id, ["2026-11-10"]), () => denied.scheduleFor(ana, period.id)]) {
      await expect(call()).rejects.toMatchObject({ reason: "denied" });
    }
    expect(await performance().listPeriods()).toHaveLength(1);
    expect(await performance().listNonWorkingDates()).toEqual([]);
    expect((await db.query(`SELECT 1 FROM hrms_excused_days`)).rows).toHaveLength(0);
  });

  it("records each Staff member's own name, and never reads a bad session as no access", async () => {
    const bea = portal.signIn({ ...staff, id: "u-bea", name: "Bea Reyes", username: "bea", role: "Cashier" }, ["Performance"]);
    await performance().openPeriod(NOV);
    await performance(bea).addNonWorkingDate({ date: "2026-11-30", name: "Bonifacio Day", type: "Holiday" });

    expect((await audit()).map((a) => [a.actor_name, a.action])).toEqual([["Ada Okafor", "period-opened"], ["Bea Reyes", "non-working-date-added"]]);
    await expect(performanceFor(undefined, db).listPeriods()).rejects.toMatchObject({ reason: "invalid" });
    portal.unavailable = true;
    await expect(performance(bea).listPeriods()).rejects.toMatchObject({ reason: "unavailable" });
  });
});
