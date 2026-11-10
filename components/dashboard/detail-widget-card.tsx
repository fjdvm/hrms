import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/** Fixed height, shared with the loading skeleton so the page does not jump. */
export const DETAIL_WIDGET_HEIGHT = "h-96";

/** Grid classes for one row of Detail Widgets: three across a row of three, two across otherwise on wide screens, a lone one full width. */
export const detailWidgetRowClass = (count: number) =>
  count > 2 ? "grid gap-md lg:grid-cols-3" : count > 1 ? "grid gap-md lg:grid-cols-2" : "grid gap-md";

/** Height of a widget in the People block: at least the standard height, stretching with its grid cell from `xl`. Shared with the skeleton. */
export const PEOPLE_WIDGET_HEIGHT = "min-h-96 xl:h-full";

export function DetailWidgetCard({
  title,
  empty,
  stretch = false,
  children,
}: {
  title: string;
  /** True when the owning Module has no data to show yet. */
  empty: boolean;
  /** Fill the grid cell instead of the fixed height (the People block). */
  stretch?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className={`${stretch ? PEOPLE_WIDGET_HEIGHT : DETAIL_WIDGET_HEIGHT} flex flex-col`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col">
        {empty ? (
          <p className="text-label-sm text-muted-foreground">Nothing to show yet</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}
