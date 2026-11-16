import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { PAGE, PageHeader } from "@/components/hiring/parts";
import { PerformanceNoAccess } from "@/components/performance/no-access";
import { PERFORMANCE_SUBTITLE, PERFORMANCE_TITLE, PerformanceListSkeleton } from "@/components/performance/performance-skeleton";
import { staffWithModule } from "@/lib/portal/staff";

/** The list later tickets fill; everything that awaits data lives here, behind the Suspense skeleton. */
async function EvaluationList() {
  return (
    <Card className="rounded-xl shadow-none">
      <p className="p-xl text-center text-muted-foreground">Nothing to show yet.</p>
    </Card>
  );
}

export default async function Page() {
  // Proves the Performance Module first (ADR-0004). The shell already asked the Portal, so this answer is reused.
  if (!(await staffWithModule("Performance"))) return <PerformanceNoAccess />;

  return (
    <div className={PAGE}>
      <PageHeader title={PERFORMANCE_TITLE} subtitle={PERFORMANCE_SUBTITLE} />
      <Suspense fallback={<PerformanceListSkeleton />}>
        <EvaluationList />
      </Suspense>
    </div>
  );
}
