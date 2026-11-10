import type { ReactNode } from "react";
import { detailWidgetRowClass } from "@/components/dashboard/detail-widget-card";
import type { DashboardLayout, DetailWidget, KeySummaryCard } from "@/lib/dashboard";

/**
 * Draws a `DashboardLayout`. The page and its loading skeleton both use it, with different `card` and
 * `widget` renderers, so the skeleton cannot drift from the real layout. `stretch` is true for the
 * People block, whose widgets fill their grid cell.
 */
export function DashboardGrid({
  layout,
  card,
  widget,
}: {
  layout: DashboardLayout;
  card: (card: KeySummaryCard) => ReactNode;
  widget: (widget: DetailWidget, stretch: boolean) => ReactNode;
}) {
  const { hiringCards, people, rows } = layout;
  const left = people?.left ?? null;
  const trend = people?.trend ?? null;

  return (
    <>
      {hiringCards.length > 0 && (
        <div className="grid gap-md sm:grid-cols-2 xl:grid-cols-5">{hiringCards.map(card)}</div>
      )}
      {people && (
        <div className="grid gap-md xl:grid-cols-5">
          {left && (
            <div className={`grid content-start gap-md xl:grid-rows-[auto_1fr] ${trend ? "xl:col-span-2" : "xl:col-span-5"}`}>
              {left.cards.length > 0 && (
                <div className={left.cards.length > 1 ? "grid gap-md sm:grid-cols-2" : "grid gap-md"}>{left.cards.map(card)}</div>
              )}
              {left.activity && widget(left.activity, true)}
            </div>
          )}
          {trend && (
            <div className={`grid ${left ? "xl:col-span-3" : "xl:col-span-5"}`}>{widget(trend, true)}</div>
          )}
        </div>
      )}
      {rows.map((row) => (
        <div key={row[0].id} className={detailWidgetRowClass(row.length)}>
          {row.map((w) => widget(w, false))}
        </div>
      ))}
    </>
  );
}
