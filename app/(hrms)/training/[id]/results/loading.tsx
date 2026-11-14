import { Skeleton } from "@/components/ui/skeleton";
import { PAGE } from "@/components/hiring/parts";

export default function Loading() {
  return (
    <div className={PAGE} aria-busy="true" aria-label="Loading results">
      <Skeleton className="h-4 w-48" />
      <div className="flex flex-col gap-xs"><Skeleton className="h-8 w-48" /><Skeleton className="h-4 w-[28rem] max-w-full" /></div>
      <Skeleton className="h-[74px] w-full rounded-xl" />
      <Skeleton className="h-[48px] w-full rounded-[10px]" />
      <Skeleton className="h-[380px] w-full rounded-xl" />
    </div>
  );
}
