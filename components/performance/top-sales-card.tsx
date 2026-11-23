import { TriangleAlert, BarChart3 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { TopSalesError } from "@/lib/performance";
import { EMPTY_NOTE, emptyTitle, footerNote, isEmpty, monthChoices, pickSalesMonth } from "@/lib/performance-top-sales-view";
import { performanceForRequest } from "@/lib/portal/performance";
import { ImportPosSalesDialog } from "./import-pos-sales-dialog";
import { PosLinksDialog } from "./pos-links-dialog";
import { PerformanceRetry } from "./retry-button";
import { TopSalesBody } from "./top-sales-parts";
import { TopSalesHeader } from "./top-sales-skeleton";
import { TopSalesMonthSelector } from "./top-sales-month-selector";

/** The footer note, with the entry point that opens the POS cashier links dialog. */
const Footer = ({ children }: { children: React.ReactNode }) => (
  <div className="flex items-start gap-sm rounded-lg bg-muted px-[12px] py-[10px]">
    <p className="flex-1 text-xs text-muted-foreground">{children}</p>
    <PosLinksDialog />
  </div>
);

const CARD = "flex flex-col gap-[16px] overflow-hidden rounded-xl p-[20px] shadow-none";

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** What the card reads for one month: the ranking, or null when it cannot be read. A failure here is shown inside the card and never reaches the list. */
async function read(year: number, month: number) {
  try {
    return await (await performanceForRequest()).topSales({ year, month });
  } catch (error) {
    if (!(error instanceof TopSalesError)) console.error("Top sales could not be loaded", error);
    return null;
  }
}

/**
 * The Top sales card: the overall top seller and the top two cashiers per branch for one calendar month, with its own month selector. It
 * reads on load and again only when a month is picked or Try again is clicked; nothing is polled. It sits behind its own Suspense boundary.
 */
export async function TopSalesCard({ searchParams }: { searchParams: Search }) {
  const query = await searchParams;
  // The clock is read after the request is known, so the page is already dynamic.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const month = pickSalesMonth(today, one(query.salesMonth));
  const data = await read(month.year, month.month);
  const header = (
    <TopSalesHeader title={`Top sales · ${month.label}`}>
      {data?.provisional && <Badge variant="warning">Provisional</Badge>}
      <TopSalesMonthSelector choices={monthChoices(today)} selected={month.value} period={one(query.period)} />
    </TopSalesHeader>
  );

  if (!data) {
    return (
      <Card className={CARD}>
        {header}
        <div role="alert" className="flex flex-wrap items-center gap-sm rounded-lg bg-[#fbe6e0] px-[14px] py-[12px] text-sm font-medium text-[#9a3412]">
          <TriangleAlert aria-hidden className="size-4" />
          <span className="flex-1">We couldn’t load top sales. Check your connection, then try again.</span>
          <PerformanceRetry />
        </div>
        <p className="py-[40px] text-center text-sm text-[#6e6680]">Nothing loaded</p>
      </Card>
    );
  }

  if (isEmpty(data)) {
    // The empty state opens the same Import POS sales dialog as the header; the go-live date decides what it says.
    const goLive = await (await performanceForRequest()).posGoLive().catch(() => null);
    return (
      <Card className={CARD}>
        {header}
        <div className="flex flex-col items-center gap-[8px] py-[28px] text-center">
          <div className="flex size-[56px] items-center justify-center rounded-full bg-[#efe6f8]"><BarChart3 aria-hidden className="size-[26px] text-[#5b2a86]" /></div>
          <p className="text-lg font-semibold text-[#1f1a2e]">{emptyTitle(data, month.label)}</p>
          <p className="max-w-[560px] text-sm text-[#6e6680]">Import POS sales to see the top seller and the top cashiers by branch. Sales are read from the POS only when you click Import.</p>
          <ImportPosSalesDialog goLiveDate={goLive?.date ?? null} today={today} variant="primary" />
        </div>
        <Footer>{data.notShown.unlinkedAccounts + data.notShown.notCashiers > 0 ? footerNote(data) : EMPTY_NOTE}</Footer>
      </Card>
    );
  }

  return (
    <Card className={CARD}>
      {header}
      <TopSalesBody data={data} />
      <Footer>{footerNote(data)}</Footer>
    </Card>
  );
}
