import { describe, expect, it } from "vitest";
import type { TopSales, TopSalesRow } from "@/lib/performance-top-sales";
import { emptyTitle, footerNote, initialsOf, monthChoices, perPresentDay, pickSalesMonth, presentDaysText, salesMonthHref, soldAtText } from "@/lib/performance-top-sales-view";

const row = (id: number, name: string, netSales: number, extra: Partial<TopSalesRow> = {}): TopSalesRow => ({ rank: 1, employeeId: id, employeeNumber: `BR-EMP-00${id}`, name, netSales, orders: 10, presentDays: 5, ...extra });
const data = (extra: Partial<TopSales> = {}): TopSales => ({
  month: "2026-11", range: { from: "2026-11-01", to: "2026-11-30" }, positionDate: "2026-11-30", provisional: true,
  branches: [{ branch: "Cainta branch", mapped: true, ranking: [row(17, "Carla Mendoza", 100)] }], overall: [row(17, "Carla Mendoza", 100)],
  notShown: { unlinkedAccounts: 1, notCashiers: 0 }, ...extra,
});

describe("Top sales months", () => {
  it("offers the current month first and the eleven before it, across a year end", () => {
    const choices = monthChoices("2026-02-10");
    expect(choices).toHaveLength(12);
    expect(choices[0]).toMatchObject({ value: "2026-02", label: "February 2026" });
    expect(choices[2]).toMatchObject({ value: "2025-12", label: "December 2025" });
    expect(choices[11].value).toBe("2025-03");
  });
  it("opens on the requested month when offered, else on the current month", () => {
    expect(pickSalesMonth("2026-11-16", "2026-09").value).toBe("2026-09");
    expect(pickSalesMonth("2026-11-16", "2027-01").value).toBe("2026-11");
    expect(pickSalesMonth("2026-11-16", "garbage").value).toBe("2026-11");
    expect(pickSalesMonth("2026-11-16").value).toBe("2026-11");
  });
  it("keeps the open Evaluation period in a month link", () => {
    expect(salesMonthHref("2026-10", "2")).toBe("/performance?period=2&salesMonth=2026-10");
    expect(salesMonthHref("2026-10")).toBe("/performance?salesMonth=2026-10");
  });
});

describe("Top sales wording", () => {
  it("computes net sales per present day, and none without a present day", () => {
    expect(perPresentDay({ netSales: 186420.5, presentDays: 26 })).toBeCloseTo(7170.02, 2);
    expect(perPresentDay({ netSales: 50, presentDays: 0 })).toBeNull();
    expect(presentDaysText(26)).toBe("26 days");
    expect(presentDaysText(1)).toBe("1 day");
    expect(presentDaysText(0)).toBe("Not imported");
  });
  it("takes initials from the first and last name", () => {
    expect(initialsOf("Carla Mendoza")).toBe("CM");
    expect(initialsOf("Maria Clara de la Cruz")).toBe("MC");
    expect(initialsOf("Madonna")).toBe("M");
  });
  it("says where the top seller sold", () => {
    const seller = row(17, "Carla Mendoza", 100);
    expect(soldAtText(data(), seller)).toBe("Sold at Cainta branch");
    const two = data({ branches: [{ branch: "A", mapped: true, ranking: [seller] }, { branch: "B", mapped: true, ranking: [seller] }] });
    expect(soldAtText(two, seller)).toBe("Sold at 2 branches");
  });
  it("says why a month is Provisional and how many staff with sales are not shown", () => {
    expect(footerNote(data())).toBe("Provisional until an import run in December has re-read November, because voids and refunds can change totals. 1 staff member with POS sales is not shown: not linked to an employee or not a cashier position.");
    expect(footerNote(data({ provisional: false, notShown: { unlinkedAccounts: 2, notCashiers: 1 } }))).toBe("3 staff members with POS sales are not shown: not linked to an employee or not a cashier position.");
    expect(footerNote(data({ provisional: false, notShown: { unlinkedAccounts: 0, notCashiers: 0 } }))).toBe("No staff with POS sales are left out.");
    expect(footerNote(data({ month: "2026-12" }))).toContain("an import run in January has re-read December");
  });
  it("titles the Empty state by whether any sales exist at all", () => {
    expect(emptyTitle(data({ notShown: { unlinkedAccounts: 0, notCashiers: 0 } }), "November 2026")).toBe("No POS sales imported for November 2026 yet");
    expect(emptyTitle(data(), "November 2026")).toBe("No cashier sales to rank for November 2026");
  });
});
