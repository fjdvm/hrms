// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TopSales, TopSalesRow } from "@/lib/performance-top-sales";

const topSales = vi.fn();
vi.mock("@/lib/portal/performance", () => ({ performanceForRequest: async () => ({ topSales, posGoLive: async () => null }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { TopSalesCard } from "@/components/performance/top-sales-card";
import { TopSalesSkeleton } from "@/components/performance/top-sales-skeleton";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-16T04:00:00Z"));
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  topSales.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const row = (rank: number, id: number, name: string, netSales: number, orders: number, presentDays: number): TopSalesRow => ({ rank, employeeId: id, employeeNumber: `BR-EMP-00${id}`, name, netSales, orders, presentDays });
const CARLA = row(1, 17, "Carla Mendoza", 186420.5, 412, 26);
const RANKED: TopSales = {
  month: "2026-11", range: { from: "2026-11-01", to: "2026-11-30" }, positionDate: "2026-11-16", provisional: true,
  branches: [
    { branch: "Cainta branch", mapped: true, ranking: [CARLA, row(2, 31, "Liza Navarro", 171980, 389, 26), row(3, 50, "Third Place", 10, 1, 1)] },
    { branch: "Taytay branch", mapped: true, ranking: [row(1, 24, "Angelica Cruz", 142310, 331, 26), row(2, 40, "Patricia Gomez", 98640, 247, 0)] },
  ],
  overall: [CARLA], notShown: { unlinkedAccounts: 1, notCashiers: 0 },
};
const show = async (search: Record<string, string> = {}) => render(await TopSalesCard({ searchParams: Promise.resolve(search) }));

describe("the Top sales card", () => {
  it("reads the current month by default and shows the top seller panel", async () => {
    topSales.mockResolvedValue(RANKED);
    await show();
    expect(topSales).toHaveBeenCalledWith({ year: 2026, month: 11 });
    const panel = screen.getByRole("region", { name: "Top seller" });
    expect(within(panel).getByText("Carla Mendoza")).toBeTruthy();
    expect(within(panel).getByText("BR-EMP-0017")).toBeTruthy();
    expect(within(panel).getByText("₱186,420.50")).toBeTruthy();
    expect(within(panel).getByText("412")).toBeTruthy();
    expect(within(panel).getByText("26")).toBeTruthy();
    expect(within(panel).getByText("₱7,170.02")).toBeTruthy();
    expect(within(panel).getByText("Sold at Cainta branch")).toBeTruthy();
  });

  it("shows only the top two cashiers of each branch, with rank, number, net sales, orders and present days", async () => {
    topSales.mockResolvedValue(RANKED);
    await show();
    const table = within(screen.getByRole("region", { name: "Top by branch" })).getByRole("table");
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);
    expect(within(rows[0]).getByText("Cainta branch")).toBeTruthy();
    expect(within(rows[0]).getByText("3 cashiers")).toBeTruthy();
    expect(within(rows[1]).getByText("Liza Navarro")).toBeTruthy();
    expect(within(rows[3]).getByText("Not imported")).toBeTruthy();
    expect(screen.queryByText("Third Place")).toBeNull();
  });

  it("is a Provisional recognition card and never calls itself Employee of the month", async () => {
    topSales.mockResolvedValue(RANKED);
    const { container } = await show();
    expect(screen.getByText("Provisional")).toBeTruthy();
    expect(screen.getByText(/Recognition only, not part of Evaluations/)).toBeTruthy();
    expect(container.textContent).not.toMatch(/employee of the month/i);
    expect(screen.getByText(/1 staff member with POS sales is not shown/)).toBeTruthy();
  });

  it("drops the Provisional badge once a later import has re-read the month", async () => {
    topSales.mockResolvedValue({ ...RANKED, provisional: false });
    await show({ salesMonth: "2026-10" });
    expect(topSales).toHaveBeenCalledWith({ year: 2026, month: 10 });
    expect(screen.queryByText("Provisional")).toBeNull();
  });

  it("has its own month selector whose months are links that keep the Evaluation period", async () => {
    topSales.mockResolvedValue(RANKED);
    await show({ period: "2" });
    await userEvent.click(screen.getByRole("button", { name: "Top sales month" }));
    const october = screen.getByRole("menuitem", { name: /October 2026/ });
    expect(october.getAttribute("href")).toBe("/performance?period=2&salesMonth=2026-10");
  });

  it("shows the Empty state with an Import POS sales button when there are no sales", async () => {
    topSales.mockResolvedValue({ ...RANKED, branches: [], overall: [], provisional: true, notShown: { unlinkedAccounts: 0, notCashiers: 0 } });
    await show();
    expect(screen.getByText("No POS sales imported for November 2026 yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Import POS sales" })).toBeTruthy();
  });

  it("opens the Import POS sales dialog from the Empty state, which says so when the go-live date is not set", async () => {
    topSales.mockResolvedValue({ ...RANKED, branches: [], overall: [], provisional: true, notShown: { unlinkedAccounts: 0, notCashiers: 0 } });
    await show();
    await userEvent.click(screen.getByRole("button", { name: "Import POS sales" }));

    expect(screen.getByRole("heading", { name: "Import POS sales" })).toBeTruthy();
    expect(screen.getByRole("dialog").textContent).toContain("The POS go-live date is not set yet, so nothing is read.");
  });

  it("shows the Error state with Try again, inside the card, when the ranking cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    topSales.mockRejectedValue(new Error("database unreachable"));
    await show();
    expect(screen.getByRole("alert").textContent).toContain("We couldn’t load top sales. Check your connection, then try again.");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    expect(screen.getByText("Nothing loaded")).toBeTruthy();
  });

  it("has a Loading skeleton with the recognition-only line", () => {
    render(<TopSalesSkeleton />);
    expect(screen.getByLabelText("Loading top sales")).toBeTruthy();
    expect(screen.getByText(/Recognition only, not part of Evaluations/)).toBeTruthy();
  });
});
