import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Initials } from "@/components/hiring/parts";
import { RetryNoticeButton } from "@/components/training/retry-notice-button";
import { LOG_TABS, formatClock, formatNoticeTime, logHref, type LogRow, type LogTab, type NotificationLog } from "@/lib/training-terms";
import { MAX_RETRIES } from "@/lib/training-notices";
import { cn } from "@/lib/utils";

const TH = "py-[6px] text-left text-xs font-medium text-muted-foreground";
const PILL = "rounded-full bg-amber-100 px-[10px] py-[3px] text-xs font-medium text-amber-800";

function StateCell({ row }: { row: LogRow }) {
  switch (row.state) {
    case "Sent": return <Badge variant="success">Sent</Badge>;
    case "Sending": return <Badge variant="secondary">Sending</Badge>;
    case "Retrying":
      return (
        <div className="flex flex-col gap-[2px]">
          <Badge variant="warning" className="self-start">Retrying</Badge>
          <span className="text-xs text-muted-foreground">Try {Math.min(row.attempts, MAX_RETRIES)} of {MAX_RETRIES}{row.nextAttemptAt ? ` · next at ${formatClock(row.nextAttemptAt)}` : ""}</span>
        </div>
      );
    case "Failed":
      return (
        <div className="flex flex-col gap-[2px]">
          <Badge variant="destructive" className="self-start">Failed</Badge>
          <span className="text-xs text-muted-foreground">{row.attempts} tries · moved to Not reached</span>
        </div>
      );
    default: return <span className={PILL}>Needs printed schedule</span>;
  }
}

function Person({ row, sub }: { row: LogRow; sub: string }) {
  return (
    <div className="flex items-center gap-[10px]">
      <Initials name={row.employeeName} />
      <div className="flex min-w-0 flex-col"><span className="text-sm font-medium text-foreground">{row.employeeName}</span><span className="truncate text-xs text-muted-foreground">{sub}</span></div>
    </div>
  );
}

/** The Notification log: tabs, the Not reached and Needs printed schedule lists, then every notice. */
export function NotificationLogView({ trainingId, log, tab }: { trainingId: number; log: NotificationLog; tab: LogTab }) {
  const rows = tab === "Not reached" ? log.notReached : tab === "Needs printed schedule" ? log.needsPrinted : log.rows;
  return (
    <>
      <nav aria-label="Notices" className="flex flex-wrap gap-xs">
        {LOG_TABS.map((name) => (
          <Link key={name} href={logHref(trainingId, name)} aria-current={name === tab ? "page" : undefined}
            className={cn("rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground", name === tab && "bg-accent text-primary hover:text-primary")}>
            {name} {log.counts[name]}
          </Link>
        ))}
      </nav>
      {(log.notReached.length > 0 || log.needsPrinted.length > 0) && (
        <div className="grid items-start gap-[16px] lg:grid-cols-2">
          {log.notReached.length > 0 && (
            <Card className="flex flex-col gap-[12px] rounded-xl px-[20px] py-[18px] shadow-none">
              <div className="flex flex-col gap-[2px]">
                <h2 className="text-[15px] font-semibold text-zinc-900">Not reached · {log.notReached.length}</h2>
                <p className="text-xs text-muted-foreground">Failed {MAX_RETRIES} times, about 15 minutes apart. Check the address, then retry.</p>
              </div>
              <table className="w-full border-collapse text-sm">
                <thead><tr className="border-b border-[#efebf4]"><th className={TH}>Employee</th><th className={TH}>Notice</th><th className={TH}><span className="sr-only">Retry</span></th></tr></thead>
                <tbody>
                  {log.notReached.map((row) => (
                    <tr key={row.noticeId} className="border-b border-[#efebf4]">
                      <td className="py-[10px] pr-[12px]"><Person row={row} sub={row.email ?? ""} /></td>
                      <td className="py-[10px] pr-[12px]"><div className="flex flex-col"><span>{row.kind}</span><span className="text-xs text-muted-foreground">Last try {formatNoticeTime(row.at)}</span></div></td>
                      <td className="py-[10px] text-right"><RetryNoticeButton trainingId={trainingId} noticeId={row.noticeId!} name={row.employeeName} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
          {log.needsPrinted.length > 0 && (
            <Card className="flex flex-col gap-[12px] rounded-xl px-[20px] py-[18px] shadow-none">
              <div className="flex flex-col gap-[2px]">
                <h2 className="text-[15px] font-semibold text-zinc-900">Needs printed schedule · {log.needsPrinted.length}</h2>
                <p className="text-xs text-muted-foreground">No email address, so never emailed. Print the schedule for them from the training page.</p>
              </div>
              <ul className="flex flex-col">
                {log.needsPrinted.map((row) => (
                  <li key={row.employeeId} className="border-b border-[#efebf4] py-[10px]"><Person row={row} sub={`${row.position} · ${row.branch}`} /></li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}
      <Card className="flex flex-col gap-[14px] overflow-x-auto rounded-xl px-[20px] py-[18px] shadow-none">
        <h2 className="text-[15px] font-semibold text-zinc-900">{tab}</h2>
        {rows.length === 0 ? (
          <p className="rounded-lg bg-muted px-[14px] py-[18px] text-center text-[13px] font-medium text-zinc-500">{log.rows.length === 0 ? "No notices yet. Assign employees and their emails show up here." : "Nothing in this list."}</p>
        ) : (
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead><tr className="border-b border-[#efebf4]"><th className={TH}>Employee</th><th className={TH}>Notice</th><th className={TH}>Sent to</th><th className={TH}>Time</th><th className={TH}>Status</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.noticeId ?? "x"}-${row.employeeId}`} className="border-b border-[#efebf4] align-middle">
                  <td className="py-[12px] pr-[12px]"><Person row={row} sub="" /></td>
                  <td className="py-[12px] pr-[12px]">{row.kind}</td>
                  <td className="py-[12px] pr-[12px]">{row.email ?? <span className="text-zinc-400">No email</span>}</td>
                  <td className="py-[12px] pr-[12px] whitespace-nowrap">{row.noticeId === null ? formatNoticeTime(row.at).split(",")[0] : formatNoticeTime(row.at)}</td>
                  <td className="py-[12px]"><StateCell row={row} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="rounded-lg bg-muted px-[12px] py-[10px] text-xs text-muted-foreground">
          Reminders go out automatically 1 day before at 8:00 AM (Manila time). Failed emails are retried {MAX_RETRIES} times, about 15 minutes apart. Employees without an email are never emailed and never marked Failed.
        </p>
      </Card>
    </>
  );
}
