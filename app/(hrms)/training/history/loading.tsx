import { Skeleton } from "@/components/ui/skeleton";
import { PAGE } from "@/components/hiring/parts";

export default function Loading() {
  return (
    <div className={PAGE} aria-busy="true" aria-label="Loading training history">
      <div className="flex flex-wrap items-center gap-sm">
        <div className="flex flex-1 flex-col gap-xs"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-80 max-w-full" /></div>
        <Skeleton className="h-[40px] w-[260px] rounded-lg" />
      </div>
      <Skeleton className="h-[92px] w-full rounded-xl" />
      <div className="flex gap-xs">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-[36px] w-[96px] rounded-lg" />)}</div>
      <Skeleton className="h-[320px] w-full rounded-xl" />
    </div>
  );
}
