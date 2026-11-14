import { Skeleton } from "@/components/ui/skeleton";
import { PAGE } from "@/components/hiring/parts";

export default function Loading() {
  return (
    <div className={PAGE} aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-[34px] w-full" />
      <Skeleton className="h-[520px] w-full rounded-xl" />
    </div>
  );
}
