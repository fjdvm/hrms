import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { UpcomingEvent } from "@/lib/dashboard";

const KIND = {
  holiday: { label: "Holiday", variant: "info" },
  leave: { label: "Leave", variant: "success" },
  training: { label: "Training", variant: "purple" },
} as const;

const dayParts = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`);
  return {
    weekday: day.toLocaleDateString("en", { weekday: "short", timeZone: "UTC" }).toUpperCase(),
    number: day.getUTCDate(),
    long: day.toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" }),
  };
};

/** Upcoming Events: a date chip, the title and a line of detail, and the tag of the Module it comes from. A Training links to its page. */
export function UpcomingEventsList({ items }: { items: UpcomingEvent[] }) {
  return (
    <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {items.map((item) => {
        const day = dayParts(item.date);
        const body = (
          <>
            <span aria-hidden className="flex size-[44px] shrink-0 flex-col items-center justify-center rounded-lg bg-accent leading-none">
              <span className="text-[10px] font-semibold text-primary">{day.weekday}</span>
              <span className="text-[17px] font-semibold text-primary">{day.number}</span>
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-label-md truncate">{item.title}</p>
              <p className="text-body-sm truncate text-muted-foreground">
                <span className="sr-only">{day.long}. </span>
                {item.description}
              </p>
            </div>
            <Badge variant={KIND[item.kind].variant}>{KIND[item.kind].label}</Badge>
          </>
        );
        return (
          <li key={item.id} className="border-b border-border-subtle py-[10px] first:pt-0 last:border-b-0">
            {item.kind === "training" ? (
              <Link href={item.link} className="flex items-center gap-md rounded-lg hover:bg-muted/50">{body}</Link>
            ) : (
              <div className="flex items-center gap-md">{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
