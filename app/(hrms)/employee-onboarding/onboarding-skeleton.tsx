import { Skeleton } from "@/components/ui/skeleton";
import { PageHeader } from "@/components/hiring/parts";
import { TableSkeleton } from "@/components/shared/table-skeleton";

/** The static header plus placeholders sized like the summary cards, tabs and table, shared by loading.tsx and the Suspense fallback. */
export function OnboardingSkeleton() {
  return (
    <>
      <PageHeader title="Onboarding" subtitle={" "} />
      <div className="grid gap-[16px] sm:grid-cols-3">
        {[0, 1, 2].map((key) => <Skeleton key={key} className="h-[84px] rounded-xl" />)}
      </div>
      <div className="flex flex-wrap items-center gap-[12px]">
        <Skeleton className="h-[36px] w-[420px] max-w-full rounded-lg" />
        <Skeleton className="ml-auto h-[38px] w-[240px] rounded-lg" />
      </div>
      <TableSkeleton columns={6} showToolbar={false} />
    </>
  );
}
