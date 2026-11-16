"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AttendanceIssue } from "@/lib/performance";
import { dateLabel } from "@/lib/performance-period-form";
import type { ResolveTarget } from "./resolve-issue-dialog";

const SMALL = "h-auto rounded-lg border-[#e6e1ee] px-[12px] py-[7px] text-[13px] shadow-none";

/**
 * The Attendance issues card: every open issue with its actions. A day with a time-in and no time-out is marked Excused or Absent;
 * an Employee with no attendance records at all has one issue for the whole period, resolved by confirming none with a reason.
 * Shown only while issues exist, and a corrected re-import also resolves them. Times are never edited by hand.
 */
export function AttendanceIssuesCard({ issues, onResolve }: { issues: AttendanceIssue[]; onResolve: (target: ResolveTarget) => void }) {
  return (
    <Card className="flex flex-col gap-[14px] rounded-xl p-[20px] shadow-none">
      <h2 className="text-[15px] font-semibold text-foreground">Attendance issues · {issues.length} open</h2>
      <ul className="flex flex-col gap-[12px]">
        {issues.map((issue) => (
          <li key={issue.kind === "no-attendance" ? "none" : issue.date} className="flex flex-wrap items-center gap-sm">
            <div className="flex min-w-[200px] flex-1 flex-col gap-[2px]">
              <span className="text-sm font-medium text-foreground">{issue.kind === "no-attendance" ? "No attendance for this period" : dateLabel(issue.date)}</span>
              <span className="text-xs text-muted-foreground">{issue.kind === "no-attendance" ? "No attendance records were imported for this employee" : "Time-in recorded, no time-out"}</span>
            </div>
            {issue.kind === "no-attendance" ? (
              <Button type="button" variant="outline" className={SMALL} onClick={() => onResolve({ kind: "none" })}>Confirm no attendance</Button>
            ) : (
              <>
                <Button type="button" variant="outline" aria-label={`Mark ${dateLabel(issue.date, false)} excused`} className={SMALL} onClick={() => onResolve({ kind: "excused", date: issue.date })}>Mark excused</Button>
                <Button type="button" variant="outline" aria-label={`Mark ${dateLabel(issue.date, false)} absent`} className={SMALL} onClick={() => onResolve({ kind: "absent", date: issue.date })}>Mark absent</Button>
              </>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Or re-import a corrected attendance file. Times are never edited by hand.</p>
    </Card>
  );
}
