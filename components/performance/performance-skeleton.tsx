import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE, PageHeader } from "@/components/hiring/parts";
import { TopSalesSkeleton } from "./top-sales-skeleton";

const ROWS = 6;

export const PERFORMANCE_TITLE = "Performance";
export const PERFORMANCE_SUBTITLE = "Weighted scores per evaluation period";

const TABS = ["All", "Draft", "In review", "Evaluated"];
const COLUMNS: [string, string][] = [["Employee", "w-[250px]"], ["Position", "w-[210px]"], ["Shift", "w-[110px]"], ["Score", "w-[110px]"], ["Attendance import", "w-[170px]"], ["Status", "flex-1"]];

/** The period selector while the periods load. */
export const PeriodSelectorSkeleton = () => <Skeleton className="h-[38px] w-[150px] rounded-lg" />;

/** The progress card, tabs and table card of the Performance list while its data loads, as in the Figma Loading frame: the Suspense fallback under the static header. */
export function PerformanceListSkeleton() {
  return (
    <>
      <Card className="flex flex-wrap items-center gap-lg rounded-xl p-[20px] shadow-none">
        <div className="flex w-[300px] max-w-full flex-col gap-[10px]"><Skeleton className="h-4 w-48" /><Skeleton className="h-8 w-28" /><Skeleton className="h-[6px] w-full" /></div>
        <Skeleton className="h-10 min-w-[240px] flex-1" />
      </Card>
      <TopSalesSkeleton />
      <div className="flex flex-wrap items-center gap-xs" aria-hidden>
        {TABS.map((name, i) => <span key={name} className={`rounded-lg px-[14px] py-[8px] text-sm font-medium ${i === 0 ? "bg-accent text-primary" : "text-muted-foreground"}`}>{name}</span>)}
      </div>
      <Card className="flex flex-col gap-[14px] overflow-hidden rounded-xl p-[20px] shadow-none">
        <div className="flex gap-md border-b border-border-subtle pb-[6px] text-xs font-medium text-muted-foreground" aria-hidden>
          {COLUMNS.map(([name, width]) => <span key={name} className={width}>{name}</span>)}
        </div>
        {Array.from({ length: ROWS }, (_, i) => (
          <div key={i} className="flex items-center gap-md py-[6px]">
            <div className="flex w-[250px] flex-col gap-[6px]"><Skeleton className="h-4 w-44" /><Skeleton className="h-3 w-24" /></div>
            <div className="flex w-[210px] flex-col gap-[6px]"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-24" /></div>
            <Skeleton className="h-4 w-[80px]" />
            <Skeleton className="h-4 w-[60px]" />
            <Skeleton className="h-4 w-[100px]" />
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
        <PeriodSelectorSkeleton />
        <Skeleton className="h-[38px] w-[150px] rounded-lg" />
        <Skeleton className="h-[38px] w-[108px] rounded-lg" />
      </PageHeader>
      <PerformanceListSkeleton />
    </div>
  );
}
