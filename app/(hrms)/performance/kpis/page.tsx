import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { PAGE, PageHeader } from "@/components/hiring/parts";
import { KpiSetup } from "@/components/performance/kpi-setup";
import { KPI_SETUP_SUBTITLE, KPI_SETUP_TITLE, KpiSetupBodySkeleton } from "@/components/performance/kpi-setup-skeleton";
import { PerformanceNoAccess } from "@/components/performance/no-access";
import { PerformanceRetry } from "@/components/performance/retry-button";
import { PerformanceError } from "@/lib/performance";
import { performanceForRequest } from "@/lib/portal/performance";
import { staffWithModule } from "@/lib/portal/staff";

/** The KPIs and weight sets, or null when the Portal or database cannot answer. Any other failure is a bug and is thrown. */
async function load() {
  try {
    const performance = await performanceForRequest();
    const [kpis, sets] = await Promise.all([performance.listKpis(), performance.listWeightSets()]);
    return { kpis, sets };
  } catch (error) {
    if (error instanceof PerformanceError) return null;
    throw error;
  }
}

/** Everything that awaits data lives here, behind the skeleton, so the header shows at once. */
async function KpiSetupContent() {
  const data = await load();
  if (!data) {
    return (
      <Card className="flex flex-col items-center gap-sm rounded-xl p-xl shadow-none">
        <p role="alert" className="text-center text-destructive">KPI setup could not be loaded. Please try again in a moment.</p>
        <PerformanceRetry />
      </Card>
    );
  }
  return <KpiSetup kpis={data.kpis} sets={data.sets} />;
}

export default async function Page() {
  // Proves the Performance Module first (ADR-0004); a Staff member without it sees No access inside the shell.
  if (!(await staffWithModule("Performance"))) return <PerformanceNoAccess />;

  return (
    <div className={PAGE}>
      <PageHeader title={KPI_SETUP_TITLE} subtitle={KPI_SETUP_SUBTITLE} />
      <Suspense fallback={<KpiSetupBodySkeleton />}>
        <KpiSetupContent />
      </Suspense>
    </div>
  );
}
