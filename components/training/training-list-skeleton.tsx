import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PAGE } from "@/components/hiring/parts";

const ROWS = 6;

/** The Trainings list while it loads: header, tabs and table card sized like the real page. */
export function TrainingListSkeleton() {
  return (
    <div className={PAGE} aria-busy="true" aria-label="Loading trainings">
      <div className="flex flex-wrap items-center gap-sm">
        <div className="flex flex-1 flex-col gap-xs">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-72" />
        </div>
        <Skeleton className="h-[38px] w-[124px] rounded-lg" />
      </div>
      <Skeleton className="h-[106px] w-full rounded-xl" />
      <div className="flex gap-xs">
        {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[36px] w-[88px] rounded-lg" />)}
      </div>
      <Card className="flex flex-col gap-[14px] rounded-xl p-[20px] shadow-none">
        <Skeleton className="h-4 w-full" />
        {Array.from({ length: ROWS }, (_, i) => (
          <div key={i} className="flex items-center gap-md py-[6px]">
            <div className="flex w-[270px] flex-col gap-[6px]"><Skeleton className="h-4 w-48" /><Skeleton className="h-3 w-24" /></div>
            <div className="flex w-[230px] flex-col gap-[6px]"><Skeleton className="h-4 w-36" /><Skeleton className="h-3 w-28" /></div>
            <Skeleton className="h-4 w-[100px]" />
            <Skeleton className="h-4 w-[90px]" />
            <Skeleton className="h-4 w-[160px]" />
            <Skeleton className="h-[22px] w-20 rounded-full" />
          </div>
        ))}
        <Skeleton className="h-[38px] w-full rounded-lg" />
      </Card>
    </div>
  );
}
