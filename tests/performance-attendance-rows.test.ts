import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { coverageOf, numberKey, validateRows, type RawAttendanceRow } from "@/lib/performance-attendance-rows";

const EMPLOYEES = new Map([
  ["2026-001", { id: 1, employeeNumber: "2026-001" }],
  ["br-emp-0002", { id: 2, employeeNumber: "BR-EMP-0002" }],
]);
const row = (overrides: Partial<RawAttendanceRow> = {}): RawAttendanceRow => ({ employeeNumber: "2026-001", date: "2026-11-03", timeIn: "08:00", timeOut: "17:00", ...overrides });
const reasons = (rows: unknown[]) => validateRows(rows as RawAttendanceRow[], EMPLOYEES).rejected.map((r) => [r.row, r.reason]);

describe("import row validation", () => {
  it("keeps good rows, matched to the Employee by employee number", () => {
    const { usable, rejected } = validateRows([row(), row({ employeeNumber: "BR-EMP-0002", date: "2026-11-04", timeIn: "07:55", timeOut: "16:30" })], EMPLOYEES);

    expect(rejected).toEqual([]);
    expect(usable).toEqual([
      { row: 1, employeeId: 1, employeeNumber: "2026-001", date: "2026-11-03", timeIn: "08:00", timeOut: "17:00" },
      { row: 2, employeeId: 2, employeeNumber: "BR-EMP-0002", date: "2026-11-04", timeIn: "07:55", timeOut: "16:30" },
    ]);
  });

  it("matches an employee number ignoring case and extra spaces, and nothing else", () => {
    expect(numberKey("  BR-EMP-0002 ")).toBe("br-emp-0002");
    const { usable } = validateRows([row({ employeeNumber: "  br-emp-0002 " }), row({ employeeNumber: "2026-001", date: "2026-11-05" })], EMPLOYEES);
    expect(usable.map((r) => r.employeeId)).toEqual([2, 1]);
    expect(reasons([row({ employeeNumber: "2026-01" }), row({ employeeNumber: "2026-0011" }), row({ employeeNumber: "2026 001" })])).toEqual([[1, "unknown-employee-number"], [2, "unknown-employee-number"], [3, "unknown-employee-number"]]);
  });

  it("rejects a row whose employee number matches nobody, including a blank or non-text one", () => {
    expect(reasons([row({ employeeNumber: "9999" }), row({ employeeNumber: "" }), row({ employeeNumber: "   " }), row({ employeeNumber: undefined as never }), row({ employeeNumber: 2026001 as never })]))
      .toEqual([[1, "unknown-employee-number"], [2, "unknown-employee-number"], [3, "unknown-employee-number"], [4, "unknown-employee-number"], [5, "unknown-employee-number"]]);
  });

  it("rejects a duplicate within the batch, keeps the first, and says which row it kept", () => {
    const { usable, rejected } = validateRows([row(), row({ date: "2026-11-04" }), row({ timeIn: "08:30" }), row({ employeeNumber: " 2026-001 ", timeIn: "09:00" })], EMPLOYEES);

    expect(usable.map((r) => [r.row, r.date, r.timeIn])).toEqual([[1, "2026-11-03", "08:00"], [2, "2026-11-04", "08:00"]]);
    expect(rejected).toEqual([
      { row: 3, employeeNumber: "2026-001", reason: "duplicate-in-batch", duplicateOf: 1 },
      { row: 4, employeeNumber: "2026-001", reason: "duplicate-in-batch", duplicateOf: 1 },
    ]);
  });

  it("is not a duplicate when another Employee or another date shares the value", () => {
    const { rejected } = validateRows([row(), row({ employeeNumber: "BR-EMP-0002" }), row({ date: "2026-11-04" })], EMPLOYEES);

    expect(rejected).toEqual([]);
  });

  it("rejects an invalid date", () => {
    expect(reasons([row({ date: "2026-02-30" }), row({ date: "03/11/2026" }), row({ date: "2026-11-3" }), row({ date: "" }), row({ date: undefined as never }), row({ date: 20261103 as never })]))
      .toEqual([[1, "invalid-date"], [2, "invalid-date"], [3, "invalid-date"], [4, "invalid-date"], [5, "invalid-date"], [6, "invalid-date"]]);
  });

  it("rejects an invalid time, and a time-out that is not after the time-in", () => {
    expect(reasons([row({ timeIn: "8:00" }), row({ timeIn: "25:00" }), row({ timeIn: "08:60" }), row({ timeIn: "08:00:00" }), row({ timeIn: "" }), row({ timeIn: undefined as never }), row({ timeIn: 800 as never }),
      row({ timeOut: "5pm" }), row({ timeOut: "24:00" }), row({ timeOut: "08:00" }), row({ timeOut: "07:59" }), row({ timeIn: "22:00", timeOut: "06:00" })]))
      .toEqual(Array.from({ length: 12 }, (_, i) => [i + 1, "invalid-time"]));
  });

  it("keeps a day with a time-in and no time-out: it is a day to resolve, not a bad row", () => {
    const { usable, rejected } = validateRows([row({ timeOut: null }), row({ date: "2026-11-04", timeOut: "" }), row({ date: "2026-11-05", timeOut: undefined as never })], EMPLOYEES);

    expect(rejected).toEqual([]);
    expect(usable.map((r) => r.timeOut)).toEqual([null, null, null]);
  });

  it("checks every rule on every row, in order, without stopping at the first bad one", () => {
    const { usable, rejected } = validateRows([row({ employeeNumber: "nope" }), row(), row({ date: "bad" }), row({ timeIn: "bad" }), row({ date: "2026-11-04" }), row({ date: "2026-11-04" }), null as never, 5 as never], EMPLOYEES);

    expect(usable.map((r) => r.row)).toEqual([2, 5]);
    expect(rejected.map((r) => [r.row, r.reason])).toEqual([[1, "unknown-employee-number"], [3, "invalid-date"], [4, "invalid-time"], [6, "duplicate-in-batch"], [7, "unknown-employee-number"], [8, "unknown-employee-number"]]);
  });

  it("is pure: it needs no database and reads no clock", () => {
    const source = readFileSync(new URL("../lib/performance-attendance-rows.ts", import.meta.url), "utf8");

    expect(source).not.toMatch(/from "\.\/database"|db\.query|\.query\(/);
    expect(source).not.toMatch(/new Date\(\)|Date\.now\(/);
  });
});

describe("whether rows cover a period", () => {
  const expected = { from: "2026-11-02", to: "2026-11-30" };

  it("covers when the rows reach the first and the last day anyone is scheduled", () => {
    expect(coverageOf(["2026-11-02", "2026-11-15", "2026-11-30"], expected)).toEqual({ covers: true, rowsFrom: "2026-11-02", rowsTo: "2026-11-30", expectedFrom: "2026-11-02", expectedTo: "2026-11-30", startsLate: false, endsEarly: false });
  });

  it("says when the rows start late or end early, and when there are none", () => {
    expect(coverageOf(["2026-11-05", "2026-11-30"], expected)).toMatchObject({ covers: false, startsLate: true, endsEarly: false, rowsFrom: "2026-11-05" });
    expect(coverageOf(["2026-11-02", "2026-11-27"], expected)).toMatchObject({ covers: false, startsLate: false, endsEarly: true, rowsTo: "2026-11-27" });
    expect(coverageOf([], expected)).toMatchObject({ covers: false, startsLate: true, endsEarly: true, rowsFrom: null, rowsTo: null });
  });

  it("ignores rows outside the period, and counts rows that run past either end", () => {
    expect(coverageOf(["2026-10-01", "2026-12-15"], expected)).toMatchObject({ covers: false, rowsFrom: null });
    expect(coverageOf(["2026-10-25", "2026-11-02", "2026-11-30", "2026-12-04"], expected).covers).toBe(true);
  });
});
