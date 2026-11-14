import { Skeleton } from "@/components/ui/skeleton";
import { PAGE } from "@/components/hiring/parts";

export default function Loading() {
  return (
    <div className={PAGE} aria-busy="true" aria-label="Loading the training">
      <Skeleton className="h-4 w-20" />
      <div className="flex flex-col gap-xs"><Skeleton className="h-8 w-80 max-w-full" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <div className="flex flex-col items-start gap-[16px] lg:flex-row">
        <div className="flex w-full min-w-0 flex-1 flex-col gap-[16px]">
          <Skeleton className="h-[130px] w-full rounded-xl" />
          <Skeleton className="h-[240px] w-full rounded-xl" />
        </div>
        <Skeleton className="h-[220px] w-full rounded-xl lg:w-[340px]" />
      </div>
      <div className="grid gap-[16px] md:grid-cols-2"><Skeleton className="h-[200px] rounded-xl" /><Skeleton className="h-[170px] rounded-xl" /></div>
    </div>
  );
}
