import Link from "next/link";
import { cache, Suspense } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PAGE, PageHeader } from "@/components/hiring/parts";
import { PerformanceNoAccess } from "@/components/performance/no-access";
import { PerformanceList } from "@/components/performance/performance-list";
import { PERFORMANCE_SUBTITLE, PERFORMANCE_TITLE, ImportPosButtonSkeleton, PerformanceListSkeleton, PeriodSelectorSkeleton } from "@/components/performance/performance-skeleton";
import { ImportPosSalesDialog } from "@/components/performance/import-pos-sales-dialog";
import { PeriodSelector } from "@/components/performance/period-selector";
import { PerformanceRetry } from "@/components/performance/retry-button";
import { SetUpPeriodDialog } from "@/components/performance/set-up-period-dialog";
import { PerformanceError, RosterError } from "@/lib/performance";
import { pickPeriod } from "@/lib/performance-list";
import { performanceForRequest } from "@/lib/portal/performance";
import { staffWithModule } from "@/lib/portal/staff";

const OUTLINE = "h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] shadow-none";
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/**
 * The periods, the selected period's roster and what the Set up period dialog needs, or null when the Portal or database cannot
 * answer. Any other failure is a bug and is thrown. Shared by the header's selector and the list so the data is read once.
 */
const load = cache(async (searchParams: Promise<Record<string, string | string[] | undefined>>) => {
  try {
    const { period: requested } = await searchParams;
    const performance = await performanceForRequest();
    const [periods, dates, sets, kpis] = await Promise.all([performance.listPeriods(), performance.listNonWorkingDates(), performance.listWeightSets(), performance.listKpis()]);
    // Read after the request's data, so the clock is only used once the page is already dynamic.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const selected = pickPeriod(periods, today, one(requested));
    const roster = selected ? await performance.roster(selected.id) : null;
    return { setup: { today, periods, nonWorkingDates: dates.map((entry) => entry.date), sets, kpis }, selected: selected ?? null, roster };
  } catch (error) {
    if (error instanceof PerformanceError || error instanceof RosterError) return null;
    throw error;
  }
});

type Search = Promise<Record<string, string | string[] | undefined>>;

/**
 * The Import POS sales button for every Performance Module holder: the go-live date decides what its dialog says, so it is read behind a skeleton
 * like the rest of the header's data. Nothing is read from the POS here; that happens only when a Staff member presses Read from POS.
 */
async function ImportPosControl() {
  let goLive;
  try {
    goLive = await (await performanceForRequest()).posGoLive();
  } catch (error) {
    if (error instanceof PerformanceError) return null;
    throw error;
  }
  // Read after the request's data, so the clock is only used once the page is already dynamic.
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  return <ImportPosSalesDialog goLiveDate={goLive?.date ?? null} today={today} />;
}

async function Controls({ searchParams }: { searchParams: Search }) {
  const data = await load(searchParams);
  return data ? <PeriodSelector selectedId={data.selected?.id ?? null} setup={data.setup} /> : null;
}

/** The progress, tabs and rows; the Figma Error frame when the Portal or database cannot answer; and an empty state with no period at all. */
async function EvaluationList({ searchParams }: { searchParams: Search }) {
  const data = await load(searchParams);
  if (!data) {
    return (
      <>
        <div role="alert" className="flex flex-wrap items-center gap-sm rounded-xl bg-[#fbe6e0] px-[20px] py-[14px] text-sm text-[#9a3412]">
          <TriangleAlert aria-hidden className="size-4" />
          <span className="flex-1">We couldn’t load evaluations. Check your connection, then try again.</span>
          <PerformanceRetry />
        </div>
        <Card className="rounded-xl p-[20px] shadow-none"><p className="p-xl text-center text-muted-foreground">Nothing loaded</p></Card>
      </>
    );
  }
  if (!data.roster) {
    return (
      <Card className="flex flex-col items-center gap-sm rounded-xl p-xl text-center shadow-none">
        <p className="text-base font-semibold text-foreground">No evaluation period yet</p>
        <p className="max-w-[460px] text-[13px] text-muted-foreground">Set up a period, import attendance and set each employee’s shift. Employees then appear here to be scored.</p>
        <SetUpPeriodDialog {...data.setup} trigger="plus" />
      </Card>
    );
  }
  return <PerformanceList key={data.roster.period.id} roster={data.roster} setup={data.setup} />;
}

export default async function Page({ searchParams }: PageProps<"/performance">) {
  // Proves the Performance Module first (ADR-0004). The shell already asked the Portal, so this answer is reused.
  if (!(await staffWithModule("Performance"))) return <PerformanceNoAccess />;

  return (
    <div className={PAGE}>
      <PageHeader title={PERFORMANCE_TITLE} subtitle={PERFORMANCE_SUBTITLE}>
        <Suspense fallback={<PeriodSelectorSkeleton />}><Controls searchParams={searchParams} /></Suspense>
        <Suspense fallback={<ImportPosButtonSkeleton />}><ImportPosControl /></Suspense>
        <Button asChild variant="outline" className={OUTLINE}><Link href="/performance/calendar">Company calendar</Link></Button>
        <Button asChild variant="outline" className={OUTLINE}><Link href="/performance/kpis">KPI setup</Link></Button>
      </PageHeader>
      <Suspense fallback={<PerformanceListSkeleton />}>
        <EvaluationList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
