import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { PAGE, PageHeader } from "@/components/hiring/parts";
import { PerformanceNoAccess } from "@/components/performance/no-access";
import { PerformanceSkeleton } from "@/components/performance/performance-skeleton";
import { staffWithModule } from "@/lib/portal/staff";

/** Proves the Performance Module first (ADR-0004), then shows the page; later tickets fill the Evaluation list here. */
async function Content() {
  if (!(await staffWithModule("Performance"))) return <PerformanceNoAccess />;

  return (
    <div className={PAGE}>
      <PageHeader title="Performance" subtitle="Evaluate each Employee against their KPIs" />
      <Card className="rounded-xl shadow-none">
        <p className="p-xl text-center text-muted-foreground">Nothing to show yet.</p>
      </Card>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<PerformanceSkeleton />}>
      <Content />
    </Suspense>
  );
}
