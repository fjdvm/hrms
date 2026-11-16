import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { BackLink, PAGE, ProfileColumns } from "@/components/hiring/parts";

/** The header, banner, cards and checklist of the evaluation page while its data loads: the Suspense fallback under the static back link. */
export function EvaluationBodySkeleton() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-sm">
        <div className="flex min-w-0 flex-1 flex-col gap-[8px]"><Skeleton className="h-7 w-64" /><Skeleton className="h-4 w-96 max-w-full" /></div>
        <Skeleton className="h-[38px] w-[150px] rounded-lg" />
      </div>
      <Skeleton className="h-[48px] w-full rounded-xl" />
      <ProfileColumns
        main={
          <>
            <Card className="flex flex-col gap-[14px] rounded-xl p-[20px] shadow-none">
              <Skeleton className="h-4 w-40" />
              <div className="grid grid-cols-2 gap-[16px] sm:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="flex flex-col gap-[6px]"><Skeleton className="h-3 w-16" /><Skeleton className="h-4 w-24" /></div>)}</div>
            </Card>
            <Card className="flex flex-col gap-[14px] rounded-xl p-[20px] shadow-none">
              <Skeleton className="h-4 w-72" />
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="flex items-center gap-md py-[6px]">
                  <div className="flex w-[240px] flex-col gap-[6px]"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-32" /></div>
                  <Skeleton className="h-4 w-[110px]" /><Skeleton className="h-4 w-[60px]" /><Skeleton className="h-4 w-[40px]" /><Skeleton className="ml-auto h-4 w-[40px]" />
                </div>
              ))}
            </Card>
            <Card className="flex flex-col gap-[12px] rounded-xl p-[20px] shadow-none"><Skeleton className="h-4 w-24" /><Skeleton className="h-4 w-full" /><Skeleton className="h-4 w-2/3" /></Card>
          </>
        }
        aside={
          <Card className="flex flex-col gap-[12px] rounded-xl p-[20px] shadow-none">
            <Skeleton className="h-4 w-32" />
            {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[54px] w-full rounded-lg" />)}
          </Card>
        }
      />
    </>
  );
}

/** The whole evaluation page while it loads, for loading.tsx: the same back link and body skeleton the page renders. */
export function EvaluationSkeleton() {
  return (
    <div className={PAGE} aria-busy="true" aria-label="Loading evaluation">
      <BackLink href="/performance">Performance</BackLink>
      <EvaluationBodySkeleton />
    </div>
  );
}
