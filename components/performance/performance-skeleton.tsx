import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE, PageHeader } from "@/components/hiring/parts";

const ROWS = 6;

export const PERFORMANCE_TITLE = "Performance";
export const PERFORMANCE_SUBTITLE = "Evaluate each Employee against their KPIs";

/** The tabs and table card of the Performance list while its data loads: the Suspense fallback under the static header. */
export function PerformanceListSkeleton() {
  return (
    <>
      <div className="flex gap-xs">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[36px] w-[88px] rounded-lg" />)}
      </div>
      <Card className="flex flex-col gap-[14px] rounded-xl p-[20px] shadow-none">
        <Skeleton className="h-4 w-full" />
        {Array.from({ length: ROWS }, (_, i) => (
          <div key={i} className="flex items-center gap-md py-[6px]">
            <div className="flex w-[240px] flex-col gap-[6px]"><Skeleton className="h-4 w-44" /><Skeleton className="h-3 w-24" /></div>
            <Skeleton className="h-4 w-[190px]" />
            <Skeleton className="h-4 w-[130px]" />
            <Skeleton className="h-4 w-[80px]" />
            <Skeleton className="h-[22px] w-20 rounded-full" />
          </div>
        ))}
      </Card>
    </>
  );
}

/** The whole page while it loads, for loading.tsx: the same header and list skeleton the page renders. */
export function PerformanceSkeleton() {
  return (
    <div className={PAGE} aria-busy="true" aria-label="Loading performance">
      <PageHeader title={PERFORMANCE_TITLE} subtitle={PERFORMANCE_SUBTITLE}>
        <Skeleton className="h-[38px] w-[108px] rounded-lg" />
      </PageHeader>
      <PerformanceListSkeleton />
    </div>
  );
}
