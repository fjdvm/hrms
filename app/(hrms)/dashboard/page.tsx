import { Download } from "lucide-react";
import { KeySummaryCard } from "@/components/dashboard/key-summary-card";
import { DashboardGrid } from "@/components/dashboard/dashboard-grid";
import { DetailWidget } from "@/components/dashboard/detail-widget";
import { DETAIL_WIDGET_HEIGHT } from "@/components/dashboard/detail-widget-card";
import { DateRangeSelect } from "@/components/dashboard/date-range-select";
import { RangeDependent, RangeProvider } from "@/components/dashboard/range-pending";
import { dashboardLayoutFor, dashboardRange, manilaToday, rangeSearch, showsRange } from "@/lib/dashboard";
import { dashboardSummaryFor } from "@/lib/dashboard-data";
import { getShell, requireModule } from "@/lib/portal/staff";

const firstValue = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);

export default async function Page({ searchParams }: PageProps<"/dashboard">) {
  const staff = await requireModule("Dashboard");
  const { permittedPages } = await getShell();
  // The hiring Modules supply summary data so far; each other card and Detail Widget fills in as its Module does.
  const now = new Date();
  const params = await searchParams;
  const range = dashboardRange(firstValue(params.range), now, { from: firstValue(params.from), to: firstValue(params.to) });
  const summary = await dashboardSummaryFor(permittedPages, range, now);
  const layout = dashboardLayoutFor(permittedPages, summary, range, now);
  const empty = layout.hiringCards.length === 0 && layout.hiringRows.length === 0 && !layout.people && layout.rows.length === 0;
  // The Range selector shows whenever any range-dependent card or Widget is drawn; Export writes the hiring cards.
  const rangeShown = showsRange(layout);

  return (
    <RangeProvider>
      <div className="flex flex-col gap-lg p-md sm:p-lg">
        <div className="flex flex-col gap-md sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-headline-md">Dashboard</h1>
            <p className="text-body-sm text-muted-foreground">Welcome, {staff.name}.</p>
          </div>
          {(rangeShown || layout.hiringCards.length > 0) && (
            <div className="flex flex-col gap-2 sm:flex-row">
              {rangeShown && (
                <DateRangeSelect
                  selected={range.id}
                  label={range.label}
                  today={manilaToday(now)}
                  custom={{ from: range.start, to: range.end }}
                />
              )}
              {layout.hiringCards.length > 0 && (
                <a
                  href={`/api/dashboard/export?${rangeSearch(range)}`}
                  className="flex h-[34px] items-center justify-center gap-2 rounded-lg border border-input bg-background px-3 text-sm font-medium hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <Download className="size-4 shrink-0" aria-hidden />
                  Export
                </a>
              )}
            </div>
          )}
        </div>

        {empty ? (
          <p className="text-body-sm text-muted-foreground">
            You hold no Modules with a summary yet.
          </p>
        ) : (
          <DashboardGrid
            layout={layout}
            card={(card) =>
              card.rangeDependent ? (
                <RangeDependent key={card.label}>
                  <KeySummaryCard {...card} />
                </RangeDependent>
              ) : (
                <KeySummaryCard key={card.label} {...card} />
              )
            }
            widget={(widget, stretch) =>
              widget.rangeDependent ? (
                <RangeDependent key={widget.id} height={DETAIL_WIDGET_HEIGHT}>
                  <DetailWidget {...widget} stretch={stretch} />
                </RangeDependent>
              ) : (
                <DetailWidget key={widget.id} {...widget} stretch={stretch} />
              )
            }
          />
        )}
      </div>
    </RangeProvider>
  );
}
