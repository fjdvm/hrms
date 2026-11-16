// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PerformanceList } from "@/components/performance/performance-list";
import { PeriodSelector } from "@/components/performance/period-selector";
import type { SetUpPeriodData } from "@/components/performance/set-up-period-dialog";
import type { Roster, RosterRow } from "@/lib/performance-evaluations";
import type { Period } from "@/lib/performance-periods";

vi.mock("@/app/(hrms)/performance/actions", () => ({ openEvaluationPeriod: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

beforeEach(() => { vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const NOVEMBER: Period = { id: 2, type: "Month", kind: "Company", employeeId: null, start: "2026-11-01", end: "2026-11-30", graceMinutes: 10, name: "November 2026", createdByName: "Ada" };
const OCTOBER: Period = { ...NOVEMBER, id: 1, start: "2026-10-01", end: "2026-10-31", name: "October 2026" };
const SETUP: SetUpPeriodData = { today: "2026-11-16", periods: [NOVEMBER, OCTOBER], nonWorkingDates: [], sets: [], kpis: [] };

const row = (id: number, name: string, status: RosterRow["status"], extra: Partial<RosterRow> = {}): RosterRow => ({
  employeeId: id, employeeNumber: `BR-EMP-00${id}`, name, position: "Branch Cashier", branch: "Cainta branch", status,
  shift: { start: "06:00", end: "14:00", workingDays: [1, 2, 3, 4, 5, 6] },
  attendance: { imported: true, confirmedNone: false, openIssues: 0 }, weightSet: null,
  score: { outcome: "scored", value: 90 }, kpis: [], scheduledDays: 26, excusedDays: 0, rating: 80, ...extra,
});
const ROWS = [
  row(12, "Mylene Santos", "Evaluated", { score: { outcome: "scored", value: 93 } }),
  row(17, "Carla Mendoza", "Evaluated", { score: { outcome: "scored", value: 88.4 } }),
  row(24, "Angelica Cruz", "In review", { attendance: { imported: true, confirmedNone: false, openIssues: 2 } }),
  row(36, "Daniel Flores", "Draft", { attendance: { imported: false, confirmedNone: false, openIssues: 0 }, score: { outcome: "insufficient-data" } }),
  row(40, "Patricia Gomez", "Draft", { shift: null, attendance: { imported: false, confirmedNone: false, openIssues: 0 }, score: { outcome: "not-scored", reason: "shift-missing" } }),
];
function rosterOf(rows: RosterRow[], period = NOVEMBER): Roster {
  const evaluated = rows.filter((r) => r.status === "Evaluated").length;
  return {
    period, tab: "All", rows,
    counts: { All: rows.length, Draft: rows.filter((r) => r.status === "Draft").length, "In review": rows.filter((r) => r.status === "In review").length, Evaluated: evaluated },
    progress: { evaluated, total: rows.length, percent: rows.length ? Math.round((evaluated / rows.length) * 100) : 0 },
    notScored: rows.filter((r) => r.score.outcome === "not-scored").map((r) => ({ employeeId: r.employeeId, employeeNumber: r.employeeNumber, name: r.name })),
  };
}
const renderList = (rows = ROWS) => render(<PerformanceList roster={rosterOf(rows)} setup={SETUP} />);
const bodyRows = () => within(screen.getByRole("table")).getAllByRole("row").slice(1);
const rowNames = () => bodyRows().map((r) => within(r).getAllByRole("cell")[0].querySelector("span")?.textContent);

describe("the Performance list", () => {
  it("shows each Employee's name and number, position and branch, shift, score, attendance and status", () => {
    renderList();

    const cells = (r: HTMLElement) => within(r).getAllByRole("cell").map((c) => c.textContent);
    expect(cells(bodyRows()[0])).toEqual(["Mylene SantosBR-EMP-0012", "Branch CashierCainta branch", "6 AM – 2 PM", "93.0", "Imported", "Evaluated"]);
    expect(cells(bodyRows()[2])).toEqual(["Angelica CruzBR-EMP-0024", "Branch CashierCainta branch", "6 AM – 2 PM", "90.0", "Imported2 issues", "In review"]);
    expect(cells(bodyRows()[3])).toEqual(["Daniel FloresBR-EMP-0036", "Branch CashierCainta branch", "6 AM – 2 PM", "—", "Not imported", "Draft"]);
  });

  it("shows an Employee with no shift as Not scored: shift missing, and each row opens that Employee's evaluation page", () => {
    renderList();

    expect(within(bodyRows()[4]).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Patricia GomezBR-EMP-0040 · no shift yet", "Branch CashierCainta branch", "Not set", "—", "Not imported", "Not scored: shift missing"]);
    expect(within(bodyRows()[0]).getByRole("link").getAttribute("href")).toBe("/performance/evaluation/12?period=2");
    expect(within(bodyRows()[4]).getByRole("link").getAttribute("href")).toBe("/performance/evaluation/40?period=2");
  });

  it("shows the progress as a percentage and 'X of Y evaluated', with the warning and a Set shift link to the profile", () => {
    renderList();

    expect(screen.getByTestId("progress-percent").textContent).toBe("40%");
    expect(screen.getByText("2 of 5 evaluated")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("40");
    expect(screen.getByText("Evaluation progress · November 2026")).toBeTruthy();
    expect(screen.getByTestId("not-scored").textContent).toContain("1 employee is not scored: shift missing (Patricia Gomez)");
    expect(screen.getByRole("link", { name: "Set shift for Patricia Gomez" }).getAttribute("href")).toBe("/employee-information/40");
  });

  it("has no warning when everyone has a shift", () => {
    renderList(ROWS.slice(0, 4));

    expect(screen.queryByTestId("not-scored")).toBeNull();
    expect(screen.queryByText(/Set shift/)).toBeNull();
  });

  it("shows the counts on the tabs All, Draft, In review and Evaluated, and filters the rows by tab", async () => {
    renderList();
    expect(["All 5", "Draft 2", "In review 1", "Evaluated 2"].every((name) => screen.getByRole("button", { name }))).toBe(true);
    expect(rowNames()).toHaveLength(5);

    await userEvent.click(screen.getByRole("button", { name: "Draft 2" }));
    expect(rowNames()).toEqual(["Daniel Flores", "Patricia Gomez"]);
    await userEvent.click(screen.getByRole("button", { name: "In review 1" }));
    expect(rowNames()).toEqual(["Angelica Cruz"]);
    await userEvent.click(screen.getByRole("button", { name: "Evaluated 2" }));
    expect(rowNames()).toEqual(["Mylene Santos", "Carla Mendoza"]);
    await userEvent.click(screen.getByRole("button", { name: "All 5" }));
    expect(rowNames()).toHaveLength(5);
    expect(screen.getByRole("button", { name: "All 5" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("narrows by name or employee number within the tab, and says when nothing matches", async () => {
    renderList();
    const search = screen.getByRole("searchbox", { name: "Search employees" });

    await userEvent.type(search, "carla");
    expect(rowNames()).toEqual(["Carla Mendoza"]);
    await userEvent.clear(search);
    await userEvent.type(search, "0036");
    expect(rowNames()).toEqual(["Daniel Flores"]);
    await userEvent.click(screen.getByRole("button", { name: "Evaluated 2" }));
    expect(screen.getByText("No employees match your search.")).toBeTruthy();
  });

  it("says so when a tab has nobody", async () => {
    renderList(ROWS.slice(0, 2));

    await userEvent.click(screen.getByRole("button", { name: "Draft 0" }));

    expect(screen.getByText("No draft evaluations.")).toBeTruthy();
  });

  it("shows the Empty state with a way to set up a period when nobody is listed", async () => {
    renderList([]);

    expect(screen.getByText("Nothing to show yet")).toBeTruthy();
    expect(screen.getByText("No evaluations in November 2026 yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "All 0" })).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Set up period" }));
    expect(screen.getByRole("heading", { name: "Set up evaluation period" })).toBeTruthy();
  });
});

describe("the period selector", () => {
  it("shows the selected period and lists the others as links, latest first", async () => {
    render(<PeriodSelector selectedId={2} setup={SETUP} />);
    expect(screen.getByRole("button", { name: "Evaluation period" }).textContent).toBe("November 2026");

    await userEvent.click(screen.getByRole("button", { name: "Evaluation period" }));

    const links = screen.getAllByRole("menuitem").filter((item) => item.getAttribute("href"));
    expect(links.map((l) => [l.textContent, l.getAttribute("href")])).toEqual([["November 20261 – 30 Nov 2026", "/performance?period=2"], ["October 20261 – 31 Oct 2026", "/performance?period=1"]]);
  });

  it("opens the period dialog from 'Set up new period'", async () => {
    render(<PeriodSelector selectedId={2} setup={SETUP} />);

    await userEvent.click(screen.getByRole("button", { name: "Evaluation period" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Set up new period" }));

    expect(await screen.findByRole("heading", { name: "Set up evaluation period" })).toBeTruthy();
  });

  it("offers only the way to set up a period when none exists", async () => {
    render(<PeriodSelector selectedId={null} setup={{ ...SETUP, periods: [] }} />);

    expect(screen.getByRole("button", { name: "Evaluation period" }).textContent).toBe("No period yet");
    await userEvent.click(screen.getByRole("button", { name: "Evaluation period" }));
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Set up new period"]);
  });
});
