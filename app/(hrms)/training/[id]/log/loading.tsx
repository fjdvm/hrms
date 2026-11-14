import { Skeleton } from "@/components/ui/skeleton";
import { PAGE } from "@/components/hiring/parts";

export default function Loading() {
  return (
    <div className={PAGE} aria-busy="true" aria-label="Loading the notification log">
      <Skeleton className="h-4 w-40" />
      <div className="flex flex-col gap-xs"><Skeleton className="h-8 w-56" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      <div className="flex gap-xs">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[36px] w-[120px] rounded-lg" />)}</div>
      <Skeleton className="h-[320px] w-full rounded-xl" />
    </div>
  );
}
