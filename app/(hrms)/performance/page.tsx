import Link from "next/link";
import { Suspense } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PAGE, PageHeader } from "@/components/hiring/parts";
import { PerformanceNoAccess } from "@/components/performance/no-access";
import { PERFORMANCE_SUBTITLE, PERFORMANCE_TITLE, PerformanceListSkeleton, SetUpPeriodSkeleton } from "@/components/performance/performance-skeleton";
import { SetUpPeriodDialog } from "@/components/performance/set-up-period-dialog";
import { PerformanceError } from "@/lib/performance";
import { performanceForRequest } from "@/lib/portal/performance";
import { staffWithModule } from "@/lib/portal/staff";

const OUTLINE = "h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] shadow-none";

/** What the Set up period dialog needs, or null when the Portal or database cannot answer. Any other failure is a bug and is thrown. */
async function load() {
  try {
    const performance = await performanceForRequest();
    const [periods, dates, sets, kpis] = await Promise.all([performance.listPeriods(), performance.listNonWorkingDates(), performance.listWeightSets(), performance.listKpis()]);
    // Read after the request's data, so the clock is only used once the page is already dynamic.
    return { periods, dates, sets, kpis, today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) };
  } catch (error) {
    if (error instanceof PerformanceError) return null;
    throw error;
  }
}

/** The Set up period button. Shows nothing when the Portal or database cannot answer; the list reports that itself. */
async function SetUpPeriod() {
  const data = await load();
  return data ? <SetUpPeriodDialog today={data.today} periods={data.periods} nonWorkingDates={data.dates.map((entry) => entry.date)} sets={data.sets} kpis={data.kpis} /> : null;
}

/** The list later tickets fill; everything that awaits data lives here, behind the Suspense skeleton. */
async function EvaluationList() {
  return (
    <Card className="rounded-xl shadow-none">
      <p className="p-xl text-center text-muted-foreground">Nothing to show yet.</p>
    </Card>
  );
}

export default async function Page() {
  // Proves the Performance Module first (ADR-0004). The shell already asked the Portal, so this answer is reused.
  if (!(await staffWithModule("Performance"))) return <PerformanceNoAccess />;

  return (
    <div className={PAGE}>
      <PageHeader title={PERFORMANCE_TITLE} subtitle={PERFORMANCE_SUBTITLE}>
        <Suspense fallback={<SetUpPeriodSkeleton />}><SetUpPeriod /></Suspense>
        <Button asChild variant="outline" className={OUTLINE}><Link href="/performance/calendar">Company calendar</Link></Button>
        <Button asChild variant="outline" className={OUTLINE}><Link href="/performance/kpis">KPI setup</Link></Button>
      </PageHeader>
      <Suspense fallback={<PerformanceListSkeleton />}>
        <EvaluationList />
      </Suspense>
    </div>
  );
}
