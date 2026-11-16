import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KpiError, PerformanceError, performanceFor } from "@/lib/performance";
import { FAKE_PORTAL_URL, FAKE_SECRET, FAKE_SYSTEM, FakePortal, portalFetch } from "./fake-portal";

let db: PGlite;
let portal: FakePortal;
let handle: string;
const staff = { id: "u-ada", name: "Ada Okafor", username: "ada", email: "ada@example.test", role: "HR Officer" };
const performance = (session: string | undefined = handle) => performanceFor(session, db, () => new Date("2026-11-16T02:00:00Z"));
const WEIGHTS = { attendanceRate: 40, punctuality: 20, fullShift: 10, trainingCompletion: 10, evaluatorRating: 20 };

beforeEach(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL("./fixtures/careers-job-postings.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("./fixtures/careers-applications.sql", import.meta.url), "utf8"));
  await db.exec(`CREATE TABLE applicant_profiles (applicant_id text PRIMARY KEY, full_name text NOT NULL, email text NOT NULL UNIQUE)`);
  const directory = new URL("../migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
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
  expect(error).toBeInstanceOf(KpiError);
  return error as KpiError;
};
const audit = async () => (await db.query<{ actor_id: string; actor_name: string; action: string; subject: string; subject_id: string; detail: Record<string, unknown> | null }>(
  `SELECT actor_id, actor_name, action, subject, subject_id, detail FROM hrms_performance_audit ORDER BY id`)).rows;

describe("the seeded KPIs and default set", () => {
  it("lists the five starter KPIs, all Active, with source, target and weight in the default set", async () => {
    const kpis = await performance().listKpis();

    expect(kpis.map((k) => [k.id, k.name, k.source, k.target, k.status, k.defaultWeight])).toEqual([
      ["attendanceRate", "Attendance rate", "Attendance import", "100%", "Active", 30],
      ["punctuality", "Punctuality", "Attendance import", "100%", "Active", 25],
      ["fullShift", "Full shift", "Attendance import", "100%", "Active", 15],
      ["trainingCompletion", "Training completion", "Training", "100%", "Active", 15],
      ["evaluatorRating", "Evaluator rating", "Staff rating", "100", "Active", 15],
    ]);
    expect(kpis[0].description).toBe("Days present ÷ scheduled days");
  });

  it("lists the default set first with its total", async () => {
    const sets = await performance().listWeightSets();

    expect(sets).toHaveLength(1);
    expect(sets[0]).toMatchObject({ name: "Default set", isDefault: true, position: null, total: 100, weights: { attendanceRate: 30, punctuality: 25, fullShift: 15, trainingCompletion: 15, evaluatorRating: 15 } });
  });
});

describe("activating and deactivating a KPI", () => {
  it("deactivates and reactivates a KPI and records who did it", async () => {
    const after = await performance().setKpiStatus("fullShift", "Inactive");
    expect(after.find((k) => k.id === "fullShift")?.status).toBe("Inactive");
    expect(after.filter((k) => k.status === "Active")).toHaveLength(4);
    await performance().setKpiStatus("fullShift", "Active");

    expect(await audit()).toEqual([
      { actor_id: "u-ada", actor_name: "Ada Okafor", action: "kpi-deactivated", subject: "kpi", subject_id: "fullShift", detail: { status: "Inactive" } },
      { actor_id: "u-ada", actor_name: "Ada Okafor", action: "kpi-activated", subject: "kpi", subject_id: "fullShift", detail: { status: "Active" } },
    ]);
    expect((await db.query<{ updated_by_name: string }>(`SELECT updated_by_name FROM hrms_kpis WHERE id = 'fullShift'`)).rows[0].updated_by_name).toBe("Ada Okafor");
  });

  it("records nothing when the status does not change", async () => {
    await performance().setKpiStatus("punctuality", "Active");

    expect(await audit()).toEqual([]);
  });

  it("refuses an unknown KPI or status, and offers no delete", async () => {
    expect((await problem(performance().setKpiStatus("nope", "Active"))).problem).toBe("unknown-kpi");
    expect((await problem(performance().setKpiStatus("punctuality", "Deleted"))).problem).toBe("unknown-status");
    expect(Object.keys(performance()).filter((name) => /delete|remove/i.test(name) && /kpi|weight/i.test(name))).toEqual([]);
    expect((await db.query(`SELECT 1 FROM hrms_kpis`)).rows).toHaveLength(5);
  });
});

describe("saving a weight set", () => {
  it("creates a position set whose weights total 100, and records who made it", async () => {
    const created = await performance().saveWeightSet({ position: "Branch Cashier", weights: WEIGHTS });

    expect(created).toMatchObject({ name: "Branch Cashier", isDefault: false, position: "Branch Cashier", total: 100, weights: WEIGHTS, updatedByName: "Ada Okafor" });
    expect((await performance().listWeightSets()).map((s) => s.name)).toEqual(["Default set", "Branch Cashier"]);
    expect(await audit()).toEqual([{ actor_id: "u-ada", actor_name: "Ada Okafor", action: "weight-set-created", subject: "weight-set", subject_id: String(created.id), detail: { position: "Branch Cashier", weights: WEIGHTS } }]);
  });

  it("refuses weights that do not total 100 with the total, and saves nothing", async () => {
    for (const bump of [-1, 1]) {
      const error = await problem(performance().saveWeightSet({ position: "Branch Cashier", weights: { ...WEIGHTS, attendanceRate: 40 + bump } }));
      expect(error.problem).toBe("weights-total");
      expect(error.extra.total).toBe(100 + bump);
    }
    const edit = await problem(performance().saveWeightSet({ id: 1, weights: { ...WEIGHTS, attendanceRate: 50 } }));
    expect(edit.problem).toBe("weights-total");
    expect((await performance().listWeightSets())[0].weights.attendanceRate).toBe(30);
    expect(await audit()).toEqual([]);
  });

  it("refuses malformed weights, however the request arrives", async () => {
    const { attendanceRate: _omitted, ...missing } = WEIGHTS;
    void _omitted;
    for (const weights of [null, undefined, "40", [], missing, { ...WEIGHTS, extra: 0 }, { ...WEIGHTS, punctuality: -5, fullShift: 35 },
      { ...WEIGHTS, attendanceRate: 40.5, punctuality: 19.5 }, { ...WEIGHTS, attendanceRate: "40" }, { ...WEIGHTS, attendanceRate: Number.NaN }, { ...WEIGHTS, evaluatorRating: 120, attendanceRate: -60 }]) {
      expect((await problem(performance().saveWeightSet({ position: "Branch Cashier", weights }))).problem).toBe("weights-invalid");
    }
  });

  it("is backed by the database, so even a direct write cannot save a set that does not total 100", async () => {
    await expect(db.query(`INSERT INTO hrms_weight_sets (name, position, position_key, attendance_rate, punctuality, full_shift, training_completion, evaluator_rating, created_by_id, created_by_name, updated_by_id, updated_by_name)
      VALUES ('X', 'X', 'x', 50, 50, 50, 0, 0, 'a', 'A', 'a', 'A')`)).rejects.toThrow();
    await expect(db.query(`UPDATE hrms_weight_sets SET attendance_rate = 31 WHERE is_default`)).rejects.toThrow();
  });

  it("edits the default set's weights, which has no position", async () => {
    const [{ id }] = await performance().listWeightSets();
    const edited = await performance().saveWeightSet({ id, weights: WEIGHTS });

    expect(edited).toMatchObject({ id, name: "Default set", isDefault: true, position: null, weights: WEIGHTS, total: 100 });
    expect((await problem(performance().saveWeightSet({ id, position: "Cashier", weights: WEIGHTS }))).problem).toBe("default-position");
    expect((await audit()).map((a) => a.action)).toEqual(["weight-set-updated"]);
  });

  it("edits a position set's weights and renames its position", async () => {
    const { id } = await performance().saveWeightSet({ position: "Cashier", weights: WEIGHTS });
    const edited = await performance().saveWeightSet({ id, position: "Branch Cashier", weights: { ...WEIGHTS, attendanceRate: 30, evaluatorRating: 30 } });

    expect(edited).toMatchObject({ id, name: "Branch Cashier", position: "Branch Cashier", total: 100 });
    expect((await performance().weightSetFor("branch cashier")).id).toBe(id);
    expect((await performance().weightSetFor("Cashier")).isDefault).toBe(true);
  });

  it("refuses an unknown set", async () => {
    for (const id of [999, 0, -1, 1.5]) expect((await problem(performance().saveWeightSet({ id, position: "X", weights: WEIGHTS }))).problem).toBe("unknown-set");
  });
});

describe("positions on weight sets", () => {
  it("cleans a position and refuses empty, long or odd ones instead of changing them", async () => {
    const cleaned = await performance().saveWeightSet({ position: "  Branch   Cashier ", weights: WEIGHTS });
    expect(cleaned.position).toBe("Branch Cashier");

    for (const [position, expected] of [["", "position-empty"], ["   ", "position-empty"], [null, "position-empty"], [undefined, "position-empty"], [42, "position-empty"],
      ["x".repeat(101), "position-too-long"], ["Cashier<script>", "position-characters"], ["Cash\u0000ier", "position-characters"], ["Cash;ier", "position-characters"]] as const) {
      expect((await problem(performance().saveWeightSet({ position: position as string, weights: WEIGHTS }))).problem).toBe(expected);
    }
    expect((await performance().saveWeightSet({ position: "Sales & Marketing Lead (Branch)", weights: WEIGHTS })).total).toBe(100);
  });

  it("lets a position have only one set, whatever its case or spacing, and names the set that has it", async () => {
    await performance().saveWeightSet({ position: "Branch Cashier", weights: WEIGHTS });

    const again = await problem(performance().saveWeightSet({ position: "  branch   CASHIER ", weights: WEIGHTS }));
    expect(again.problem).toBe("position-taken");
    expect(again.extra.conflictsWith).toBe("Branch Cashier");

    const other = await performance().saveWeightSet({ position: "Stock Clerk", weights: WEIGHTS });
    const clash = await problem(performance().saveWeightSet({ id: other.id, position: "BRANCH CASHIER", weights: WEIGHTS }));
    expect(clash.problem).toBe("position-taken");
    expect(await performance().saveWeightSet({ id: other.id, position: "Stock Clerk", weights: { ...WEIGHTS, attendanceRate: 30, evaluatorRating: 30 } })).toMatchObject({ position: "Stock Clerk" });
  });
});

describe("which set applies to an Employee", () => {
  it("is the position set on an exact match, ignoring case and extra spaces, and returns its name", async () => {
    const set = await performance().saveWeightSet({ position: "Branch Cashier", weights: WEIGHTS });

    for (const position of ["Branch Cashier", "branch cashier", "  BRANCH   CASHIER  ", "Branch\tCashier"]) {
      expect(await performance().weightSetFor(position)).toMatchObject({ id: set.id, name: "Branch Cashier", isDefault: false, weights: WEIGHTS });
    }
  });

  it("is the default set when no position set matches", async () => {
    await performance().saveWeightSet({ position: "Branch Cashier", weights: WEIGHTS });

    for (const position of ["Branch Cashier II", "Cashier", "Branch", "", "   ", null, undefined]) {
      expect(await performance().weightSetFor(position)).toMatchObject({ name: "Default set", isDefault: true, total: 100 });
    }
  });

  it("does not treat SQL pattern characters in a position as a match", async () => {
    await performance().saveWeightSet({ position: "Cashier", weights: WEIGHTS });

    expect((await performance().weightSetFor("%")).isDefault).toBe(true);
    expect((await performance().weightSetFor("Cash_er")).isDefault).toBe(true);
  });
});

describe("access is the Module grant alone", () => {
  it("refuses every operation to Staff without the Performance Module, whatever their role", async () => {
    const other = portal.signIn({ ...staff, role: "Super Admin" }, ["Training", "Employee Information"]);
    const denied = performance(other);

    for (const call of [() => denied.listKpis(), () => denied.setKpiStatus("fullShift", "Inactive"), () => denied.listWeightSets(),
      () => denied.saveWeightSet({ position: "Cashier", weights: WEIGHTS }), () => denied.weightSetFor("Cashier")]) {
      await expect(call()).rejects.toMatchObject({ reason: "denied" });
    }
    expect(await audit()).toEqual([]);
    expect((await performance().listKpis()).every((k) => k.status === "Active")).toBe(true);
  });

  it("holds for any role that has the Module, and never reads a bad session as no access", async () => {
    const plain = portal.signIn({ ...staff, role: "Cashier" }, ["Performance"]);
    await expect(performance(plain).listKpis()).resolves.toHaveLength(5);
    const signedOut = performanceFor(undefined, db);
    await expect(signedOut.listKpis()).rejects.toBeInstanceOf(PerformanceError);
    await expect(signedOut.listKpis()).rejects.toMatchObject({ reason: "invalid" });
    portal.unavailable = true;
    await expect(performance(plain).listWeightSets()).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("records each Staff member's own name on what they change", async () => {
    const bea = portal.signIn({ ...staff, id: "u-bea", name: "Bea Reyes", username: "bea" }, ["Performance"]);
    await performance().setKpiStatus("punctuality", "Inactive");
    await performance(bea).setKpiStatus("punctuality", "Active");

    expect((await audit()).map((a) => [a.actor_name, a.action])).toEqual([["Ada Okafor", "kpi-deactivated"], ["Bea Reyes", "kpi-activated"]]);
  });
});
