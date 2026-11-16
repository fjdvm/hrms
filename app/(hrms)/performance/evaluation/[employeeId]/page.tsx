import { Suspense } from "react";
import { Card } from "@/components/ui/card";
import { BackLink, PAGE } from "@/components/hiring/parts";
import { EvaluationBodySkeleton } from "@/components/performance/evaluation-skeleton";
import { EvaluationView } from "@/components/performance/evaluation-view";
import { PerformanceNoAccess } from "@/components/performance/no-access";
import { PerformanceRetry } from "@/components/performance/retry-button";
import { PerformanceError, PeriodError, RosterError } from "@/lib/performance";
import { pickPeriod } from "@/lib/performance-list";
import { performanceForRequest } from "@/lib/portal/performance";
import { staffWithModule } from "@/lib/portal/staff";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

function Message({ children, retry }: { children: React.ReactNode; retry?: boolean }) {
  return (
    <Card className="flex flex-col items-center gap-sm rounded-xl p-xl shadow-none">
      <p role="alert" className={retry ? "text-center text-destructive" : "text-center text-muted-foreground"}>{children}</p>
      {retry && <PerformanceRetry />}
    </Card>
  );
}

/** The evaluation, or why there is none: not found when the Employee is not in the period, an error when the Portal or database cannot answer. Any other failure is a bug and is thrown. */
async function load(employeeId: number, requested: string | undefined) {
  try {
    const performance = await performanceForRequest();
    const periods = await performance.listPeriods();
    // Read after the request's data, so the clock is only used once the page is already dynamic.
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
    const period = pickPeriod(periods, today, requested);
    if (!period) return { kind: "missing" as const };
    return { kind: "found" as const, detail: await performance.evaluationFor(employeeId, period.id) };
  } catch (error) {
    if (error instanceof RosterError || error instanceof PeriodError) return { kind: "missing" as const };
    if (error instanceof PerformanceError) return { kind: "error" as const };
    throw error;
  }
}

/** Everything that awaits data lives here, behind the skeleton, so the back link shows at once. */
async function EvaluationContent({ employeeId, period }: { employeeId: number; period: string | undefined }) {
  const result = await load(employeeId, period);
  if (result.kind === "error") return <Message retry>This evaluation could not be loaded. Please try again in a moment.</Message>;
  if (result.kind === "missing") return <Message>That evaluation could not be found. Choose an employee from the Performance list.</Message>;
  return <EvaluationView detail={result.detail} />;
}

export default async function Page({ params, searchParams }: PageProps<"/performance/evaluation/[employeeId]">) {
  // Proves the Performance Module first (ADR-0004); a Staff member without it sees No access inside the shell.
  if (!(await staffWithModule("Performance"))) return <PerformanceNoAccess />;
  const { employeeId } = await params;
  const period = one((await searchParams).period);
  const id = /^\d{1,9}$/.test(employeeId) ? Number(employeeId) : null;

  return (
    <div className={PAGE}>
      <BackLink href={period && /^\d+$/.test(period) ? `/performance?period=${period}` : "/performance"}>Performance</BackLink>
      {id === null ? <Message>That evaluation could not be found. Choose an employee from the Performance list.</Message> : (
        <Suspense fallback={<EvaluationBodySkeleton />}>
          <EvaluationContent employeeId={id} period={period} />
        </Suspense>
      )}
    </div>
  );
}
