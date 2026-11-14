import Link from "next/link";
import { Card } from "@/components/ui/card";
import { formatNoticeTime, logHref, type LogEvent } from "@/lib/training-terms";

/** "3 sent · 1 retrying · 1 failed · 2 need printed schedule" */
export function eventSummary(event: LogEvent) {
  return [
    event.notified === false && "Employees not notified",
    event.sent > 0 && `${event.sent} sent`,
    event.retrying > 0 && `${event.retrying} retrying`,
    event.failed > 0 && `${event.failed} failed`,
    event.needPrinted > 0 && `${event.needPrinted} need printed schedule`,
  ].filter(Boolean).join(" · ");
}

/** The detail page's Notification log card: the latest events, and a link to the whole log. */
export function NotificationLogPreview({ trainingId, events }: { trainingId: number; events: LogEvent[] }) {
  return (
    <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none">
      <div className="flex items-center gap-sm">
        <h2 className="flex-1 text-[15px] font-semibold text-zinc-900">Notification log</h2>
        <Link href={logHref(trainingId, "All notices")} className="text-[13px] font-medium text-primary hover:underline">View all</Link>
      </div>
      {events.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">No notices yet. Assigned employees are emailed as soon as they are assigned.</p>
      ) : (
        <ul className="flex flex-col gap-[14px]">
          {events.map((event) => (
            <li key={`${event.kind}-${event.at}`} className="flex flex-col gap-[2px]">
              <div className="flex items-baseline gap-sm"><span className="flex-1 text-sm font-medium text-foreground">{event.kind}</span><span className="text-xs text-muted-foreground">{formatNoticeTime(event.at)}</span></div>
              <span className="text-xs text-amber-700">{eventSummary(event)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
