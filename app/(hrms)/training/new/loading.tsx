import { Skeleton } from "@/components/ui/skeleton";
import { PAGE } from "@/components/hiring/parts";

export default function Loading() {
  return (
    <div className={PAGE} aria-busy="true" aria-label="Loading the new training form">
      <Skeleton className="h-4 w-20" />
      <div className="flex flex-col gap-xs"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-[460px] max-w-full" /></div>
      <div className="flex flex-col items-start gap-[16px] lg:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-[16px]">
          <Skeleton className="h-[420px] w-full rounded-xl" />
          <Skeleton className="h-[220px] w-full rounded-xl" />
        </div>
        <div className="flex w-full shrink-0 flex-col gap-[16px] lg:w-[340px]">
          <Skeleton className="h-[170px] w-full rounded-xl" />
          <Skeleton className="h-[90px] w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
