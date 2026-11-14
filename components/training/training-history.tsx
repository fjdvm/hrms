import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Initials } from "@/components/hiring/parts";
import {
  HISTORY_TABS, formatShortDate, formatTrainingDate, formatTrainingTimes, historyHref, historyRowsFor,
  type AssignmentStatus, type HistoryRow, type HistoryTab, type TrainingHistory,
} from "@/lib/training-terms";
import { cn } from "@/lib/utils";

const TH = "py-[6px] text-left text-xs font-medium text-muted-foreground";
const BADGE: Record<AssignmentStatus, "secondary" | "success" | "destructive"> = {
  Assigned: "secondary", Completed: "success", "Did not attend": "destructive", Cancelled: "secondary",
};
const dash = <span className="text-zinc-300" aria-label="None">—</span>;

/** The history table: one row per Training the Employee was assigned to. Shared by the Training history page and the profile tab. */
export function HistoryTable({ rows, empty }: { rows: HistoryRow[]; empty: string }) {
  if (rows.length === 0) return <p className="rounded-lg bg-muted px-[14px] py-[18px] text-center text-[13px] font-medium text-zinc-500">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-[#efebf4]">
            <th className={TH}>Training</th><th className={TH}>Date and time</th><th className={TH}>Mode</th><th className={TH}>Result</th><th className={TH}>Completion date</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.trainingId} className="border-b border-[#efebf4] align-middle">
              <td className="py-[10px] pr-[12px]">
                <div className="flex flex-col gap-[2px]">
                  <Link href={`/training/${row.trainingId}`} className={cn("text-sm font-medium hover:underline", row.result === "Cancelled" ? "text-muted-foreground" : "text-primary")}>{row.title}</Link>
                  <span className="text-xs text-muted-foreground">{row.trainer}</span>
                </div>
              </td>
              <td className="py-[10px] pr-[12px]">
                <div className="flex flex-col gap-[2px]"><span>{formatTrainingDate(row.date)}</span><span className="text-xs text-muted-foreground">{formatTrainingTimes(row.startTime, row.endTime)}</span></div>
              </td>
              <td className="py-[10px] pr-[12px]">{row.mode}</td>
              <td className="py-[10px] pr-[12px]">
                <div className="flex flex-col items-start gap-[2px]">
                  <Badge variant={BADGE[row.result]}>{row.result}</Badge>
                  {row.resultsNotRecorded && <span className="text-xs font-medium text-amber-700">Results not recorded</span>}
                </div>
              </td>
              <td className="py-[10px]">{row.completedOn ? formatShortDate(row.completedOn) : dash}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATS = [
  { label: "Assigned", tab: "All", tone: "text-foreground" },
  { label: "Completed", tab: "Completed", tone: "text-green-700" },
  { label: "Did not attend", tab: "Did not attend", tone: "text-red-700" },
  { label: "Upcoming", tab: "Upcoming", tone: "text-primary" },
] as const satisfies readonly { label: string; tab: HistoryTab; tone: string }[];

/** The Employee and the four counts above the table. */
export function HistorySummary({ history }: { history: TrainingHistory }) {
  const { employee, counts } = history;
  return (
    <Card className="flex flex-wrap items-center gap-[20px] rounded-xl px-[20px] py-[18px] shadow-none">
      <Initials name={employee.name} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <div className="flex items-center gap-[10px]"><h2 className="text-[18px] font-semibold text-foreground">{employee.name}</h2><Badge variant={employee.status === "Active" ? "success" : "warning"}>{employee.status}</Badge></div>
        <p className="text-sm text-muted-foreground">{employee.employeeNumber} · {employee.position} · {employee.branch}</p>
      </div>
      <dl className="flex divide-x divide-[#efebf4]">
        {STATS.map((stat) => (
          <div key={stat.label} className="flex flex-col gap-[2px] px-[20px] first:pl-0 last:pr-0">
            <dt className="text-xs font-medium text-muted-foreground">{stat.label}</dt>
            <dd className={cn("text-[22px] font-semibold", stat.tone)}>{counts[stat.tab]}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

/** The Training history page's body for one Employee: summary, tabs and table. */
export function TrainingHistoryView({ history, tab }: { history: TrainingHistory; tab: HistoryTab }) {
  const rows = historyRowsFor(history.rows, tab);
  return (
    <>
      <HistorySummary history={history} />
      <nav aria-label="Result" className="flex flex-wrap gap-xs">
        {HISTORY_TABS.map((name) => (
          <Link key={name} href={historyHref(history.employee.id, name)} aria-current={name === tab ? "page" : undefined}
            className={cn("rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground", name === tab && "bg-accent text-primary hover:text-primary")}>
            {name} {history.counts[name]}
          </Link>
        ))}
      </nav>
      <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none">
        <HistoryTable rows={rows} empty={history.rows.length === 0 ? "No trainings yet. Assign this employee from a training page." : "Nothing in this list."} />
        <p className="rounded-lg bg-muted px-[12px] py-[10px] text-xs text-muted-foreground">
          Employees don’t sign in to HRMS. Results are recorded by Staff from the paper sign-in sheet.
        </p>
      </Card>
    </>
  );
}

/** The Employee profile's Training history tab: the counts and every Training, with a link to the full page. */
export function ProfileTrainingHistory({ history }: { history: TrainingHistory }) {
  return (
    <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none">
      <div className="flex flex-wrap items-center gap-sm">
        <h2 className="flex-1 text-[15px] font-semibold text-zinc-900">Training history</h2>
        <p className="text-xs text-muted-foreground">
          {history.counts.All} assigned · {history.counts.Completed} completed · {history.counts["Did not attend"]} did not attend · {history.counts.Upcoming} upcoming
        </p>
        <Link href={historyHref(history.employee.id, "All")} className="text-[13px] font-medium text-primary hover:underline">Open in Training history</Link>
      </div>
      <HistoryTable rows={history.rows} empty="Not assigned to any training yet." />
    </Card>
  );
}
