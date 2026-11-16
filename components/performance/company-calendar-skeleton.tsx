import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE, PageHeader } from "@/components/hiring/parts";

export const CALENDAR_TITLE = "Company calendar";
export const CALENDAR_SUBTITLE = "Non-working dates · holidays and closures are not counted as absences";

/** The "Add date" button while the calendar loads, so the header does not shift. */
export const AddDateSkeleton = () => <Skeleton className="h-[38px] w-[110px] rounded-lg" />;

/** The summary, tabs and table while their data loads: the Suspense fallback under the static header. */
export function CompanyCalendarBodySkeleton() {
  return (
    <>
      <Card className="flex flex-wrap items-center gap-lg rounded-xl p-[20px] shadow-none">
        <div className="flex w-[300px] flex-col gap-[10px]"><Skeleton className="h-4 w-40" /><Skeleton className="h-8 w-24" /></div>
        <Skeleton className="h-10 min-w-[240px] flex-1" />
      </Card>
      <div className="flex flex-wrap items-center gap-[12px]">
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-[36px] w-[88px] rounded-lg" />)}
        <Skeleton className="ml-auto h-[38px] w-[240px] rounded-lg" />
      </div>
      <Card className="flex flex-col gap-[14px] rounded-xl p-[20px] shadow-none">
        <Skeleton className="h-4 w-full" />
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex items-center gap-md py-[6px]">
            <div className="flex w-[220px] flex-col gap-[6px]"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-44" /></div>
            <Skeleton className="h-4 w-[190px]" />
            <Skeleton className="h-4 w-[70px]" />
            <Skeleton className="h-4 w-[80px]" />
            <Skeleton className="h-4 w-[120px]" />
            <Skeleton className="h-[22px] w-20 rounded-full" />
          </div>
        ))}
      </Card>
    </>
  );
}

/** The whole Company calendar page while it loads, for loading.tsx. */
export function CompanyCalendarSkeleton() {
  return (
    <div className={PAGE} aria-busy="true" aria-label="Loading company calendar">
      <PageHeader title={CALENDAR_TITLE} subtitle={CALENDAR_SUBTITLE}><AddDateSkeleton /></PageHeader>
      <CompanyCalendarBodySkeleton />
    </div>
  );
}
