import { cache, Suspense } from "react";
import { Card } from "@/components/ui/card";
import { PAGE, PageHeader } from "@/components/hiring/parts";
import { AddDateSkeleton, CALENDAR_SUBTITLE, CALENDAR_TITLE, CompanyCalendarBodySkeleton } from "@/components/performance/company-calendar-skeleton";
import { CompanyCalendar } from "@/components/performance/company-calendar";
import { NonWorkingDateDialog } from "@/components/performance/non-working-date-dialog";
import { PerformanceNoAccess } from "@/components/performance/no-access";
import { PerformanceRetry } from "@/components/performance/retry-button";
import { PerformanceError } from "@/lib/performance";
import { performanceForRequest } from "@/lib/portal/performance";
import { staffWithModule } from "@/lib/portal/staff";

/** The dates and periods, or null when the Portal or database cannot answer. Any other failure is a bug and is thrown. Shared by the header and the body. */
const load = cache(async () => {
  try {
    const performance = await performanceForRequest();
    const [entries, periods] = await Promise.all([performance.listNonWorkingDates(), performance.listPeriods()]);
    // Read after the request's data, so the clock is only used once the page is already dynamic.
    return { entries, periods, today: new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" }) };
  } catch (error) {
    if (error instanceof PerformanceError) return null;
    throw error;
  }
});

async function AddDate() {
  const data = await load();
  return data ? <NonWorkingDateDialog entries={data.entries} periods={data.periods} /> : null;
}

/** Everything that awaits data lives here, behind the skeleton, so the header shows at once. */
async function CalendarContent() {
  const data = await load();
  if (!data) {
    return (
      <Card className="flex flex-col items-center gap-sm rounded-xl p-xl shadow-none">
        <p role="alert" className="text-center text-destructive">The company calendar could not be loaded. Please try again in a moment.</p>
        <PerformanceRetry />
      </Card>
    );
  }
  return <CompanyCalendar entries={data.entries} periods={data.periods} today={data.today} />;
}

export default async function Page() {
  // Proves the Performance Module first (ADR-0004); a Staff member without it sees No access inside the shell.
  if (!(await staffWithModule("Performance"))) return <PerformanceNoAccess />;

  return (
    <div className={PAGE}>
      <PageHeader title={CALENDAR_TITLE} subtitle={CALENDAR_SUBTITLE}>
        <Suspense fallback={<AddDateSkeleton />}><AddDate /></Suspense>
      </PageHeader>
      <Suspense fallback={<CompanyCalendarBodySkeleton />}>
        <CalendarContent />
      </Suspense>
    </div>
  );
}
