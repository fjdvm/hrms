import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { DETAIL_WIDGET_HEIGHT, PEOPLE_WIDGET_HEIGHT } from "@/components/dashboard/detail-widget-card";
import { KEY_SUMMARY_CARD_HEIGHT } from "@/components/dashboard/key-summary-card";
import { Skeleton } from "@/components/ui/skeleton";
import { dashboardLayoutFor, dashboardRange } from "@/lib/dashboard";
import { getShell } from "@/lib/portal/staff";

export default async function Loading() {
  const { permittedPages } = await getShell();
  const now = new Date();
  const layout = dashboardLayoutFor(permittedPages, {}, dashboardRange(undefined, now), now);

  return (
    <div className="flex flex-col gap-lg p-md sm:p-lg">
      <div className="flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-xs">
          <Skeleton className="h-7 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        {permittedPages.includes("/job-postings") && (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Skeleton className="h-[34px] w-full rounded-lg sm:w-64" />
            <Skeleton className="h-[34px] w-full rounded-lg sm:w-[84px]" />
          </div>
        )}
      </div>
      <DashboardGrid
        layout={layout}
        card={(card) => <Skeleton key={card.label} className={`${KEY_SUMMARY_CARD_HEIGHT} rounded-xl`} />}
        widget={(widget, stretch) => (
          <Skeleton key={widget.id} className={`${stretch ? PEOPLE_WIDGET_HEIGHT : DETAIL_WIDGET_HEIGHT} rounded-xl`} />
        )}
      />
    </div>
  );
}
