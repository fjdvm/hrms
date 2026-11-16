import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE, PageHeader } from "@/components/hiring/parts";

export const KPI_SETUP_TITLE = "KPI setup";
export const KPI_SETUP_SUBTITLE = "Starter set of five KPIs · each weight set totals 100";

/** The weights summary, tabs and KPI table while their data loads: the Suspense fallback under the static header. */
export function KpiSetupBodySkeleton() {
  return (
    <>
      <Card className="flex flex-wrap items-center gap-lg rounded-xl p-[20px] shadow-none">
        <div className="flex w-[300px] flex-col gap-[10px]"><Skeleton className="h-4 w-40" /><Skeleton className="h-9 w-32" /><Skeleton className="h-[6px] w-full" /></div>
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
            <div className="flex w-[260px] flex-col gap-[6px]"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-48" /></div>
            <Skeleton className="h-4 w-[130px]" />
            <Skeleton className="h-4 w-[90px]" />
            <Skeleton className="h-4 w-[40px]" />
            <Skeleton className="h-4 w-[50px]" />
            <Skeleton className="h-[22px] w-20 rounded-full" />
          </div>
        ))}
      </Card>
    </>
  );
}

/** The whole KPI Setup page while it loads, for loading.tsx. */
export function KpiSetupSkeleton() {
  return (
    <div className={PAGE} aria-busy="true" aria-label="Loading KPI setup">
      <PageHeader title={KPI_SETUP_TITLE} subtitle={KPI_SETUP_SUBTITLE} />
      <KpiSetupBodySkeleton />
    </div>
  );
}
