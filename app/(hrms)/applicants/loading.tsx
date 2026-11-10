import { TableSkeleton } from "@/components/shared/table-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-lg p-md sm:p-lg">
      <Skeleton className="h-7 w-40" />
      <TableSkeleton columns={6} showToolbar={false} />
    </div>
  );
}
