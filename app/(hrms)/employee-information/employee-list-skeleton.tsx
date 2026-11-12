import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/hiring/parts";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** The static header plus placeholders sized like the tabs, filters and table, shared by loading.tsx and the Suspense fallback. */
export function EmployeeListSkeleton() {
  return (
    <>
      <PageHeader title="Employee information" subtitle={" "}>
        <Skeleton className="h-[38px] w-[88px] rounded-lg" />
      </PageHeader>
      <div className="flex flex-wrap items-center gap-[12px]">
        <Skeleton className="h-[36px] w-[260px] rounded-lg" />
        <Skeleton className="ml-auto h-[38px] w-[190px] rounded-lg" />
        <Skeleton className="h-[38px] w-[240px] rounded-lg" />
      </div>
      <TableSkeleton columns={7} showToolbar={false} />
    </>
  );
}
