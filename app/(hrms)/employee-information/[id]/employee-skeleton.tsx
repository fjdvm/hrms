import { Skeleton } from "@/components/ui/skeleton";
import { ProfileColumns } from "@/components/hiring/parts";

export function EmployeeSkeleton() {
  return (
    <div role="status" aria-label="Loading" className="flex flex-col gap-[20px]">
      <Skeleton className="h-4 w-40" />
      <div className="flex items-center gap-[16px]">
        <Skeleton className="size-[56px] rounded-full" />
        <div className="flex flex-col gap-xs"><Skeleton className="h-7 w-56" /><Skeleton className="h-4 w-96 max-w-full" /></div>
      </div>
      <Skeleton className="h-9 w-80 max-w-full" />
      <ProfileColumns main={<Skeleton className="h-[260px] w-full rounded-xl" />} aside={<Skeleton className="h-[260px] w-full rounded-xl" />} />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
