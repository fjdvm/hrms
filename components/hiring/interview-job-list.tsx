"use client";

import { useOptimistic, useState } from "react";
import Link from "next/link";
import { MapPin, Video } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BackLink, CELL, HEAD, InfoNote, Initials, PageHeader } from "@/components/hiring/parts";
import { RecordResultDialog, InterviewResult, type Result } from "@/components/hiring/interview-result";
import { ScheduleInterview } from "@/components/hiring/schedule-interview";
import { interviewJobRow, type InterviewJobRowView } from "@/lib/application-view";
import type { InterviewJobLabel, InterviewJobRow, InterviewJobTab } from "@/lib/applications";
import type { Interviewer } from "@/lib/interviewers";
import { PENDING_INTERVIEW_ID, applyToJobList, type InterviewPatch, type JobListState } from "@/lib/interview-optimistic";
import { useOptimisticNav } from "@/hooks/use-optimistic-nav";
import { cn } from "@/lib/utils";

const MUTED = "text-zinc-400";
const TABS: InterviewJobTab[] = ["All", "To schedule", "Scheduled"];

function TypeCell({ type }: { type: InterviewJobRowView["type"] }) {
  if (!type) return <span className={MUTED}>—</span>;
  const Icon = type === "Online" ? Video : MapPin;
  return <span className="flex items-center gap-[6px]"><Icon className="size-4 text-zinc-500" />{type}</span>;
}

type Job = { title: string; location: string; employmentType: string; label: InterviewJobLabel };
type Dialog = { kind: "schedule"; row: InterviewJobRow } | { kind: "result"; row: InterviewJobRow; result: Result };

/**
 * One job's Interview list. Booking and results show up the moment HR saves: the row switches to Scheduled or leaves the list and the
 * tab counts follow. The dialogs live here, above the rows, so a row that leaves the list cannot take its dialog (and a refused save) with it.
 */
export function InterviewJobList({ job, tab, rows, counts, interviewers, hrefBase }: { job: Job; tab: InterviewJobTab; rows: InterviewJobRow[]; counts: Record<InterviewJobTab, number>; interviewers: Interviewer[]; hrefBase: string }) {
  const [state, apply] = useOptimistic<JobListState, InterviewPatch>({ rows, counts, tab }, applyToJobList);
  const [dialog, setDialog] = useState<Dialog>();
  const nav = useOptimisticNav(tab);
  const href = (next: InterviewJobTab) => `${hrefBase}${next === "All" ? "" : `?tab=${encodeURIComponent(next)}`}`;
  const subtitleOf = (row: InterviewJobRow, view: InterviewJobRowView, interview: NonNullable<InterviewJobRow["interview"]>) =>
    `${row.applicantName} · ${job.title} · ${view.date}, ${interview.type.toLowerCase()} with ${interview.interviewerName}`;

  return (
    <>
      <div className="flex flex-col gap-xs">
      <BackLink href="/interviews">Interviews</BackLink>
      <PageHeader
        title={job.title}
        badge={<Badge variant={job.label ? "secondary" : "success"}>{job.label ?? "Published"}</Badge>}
        subtitle={`${job.location} · ${job.employmentType} · ${state.counts.All} ${state.counts.All === 1 ? "applicant" : "applicants"} in the interview stage`}
      >
        <Button variant="outline" className="h-auto rounded-lg px-[14px] py-[9px] shadow-none" asChild>
          <Link href="/job-postings">View job posting</Link>
        </Button>
      </PageHeader>
      </div>
      <nav aria-label="Interview list tabs" className="flex flex-wrap gap-xs">
        {TABS.map((label) => (
          <Link key={label} href={href(label)} onClick={nav.go(label, href(label))} aria-current={label === nav.shown ? "page" : undefined}
            className={cn("rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground", label === nav.shown && "bg-accent text-primary")}>
            {label} {state.counts[label]}
          </Link>
        ))}
      </nav>
      <Card aria-busy={nav.pending} className={cn("flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none transition-opacity", nav.pending && "opacity-60")}>
        <Table className="table-fixed min-w-[1000px]">
          <TableHeader>
            <TableRow className="border-border-subtle hover:bg-transparent">
              <TableHead className={`${HEAD} w-[230px]`}>Applicant</TableHead>
              <TableHead className={`${HEAD} w-[170px]`}>Interview</TableHead>
              <TableHead className={`${HEAD} w-[160px]`}>Type</TableHead>
              <TableHead className={`${HEAD} w-[140px]`}>Interviewer</TableHead>
              <TableHead className={`${HEAD} w-[110px]`}>Status</TableHead>
              <TableHead className={`${HEAD} text-right`}>Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className={`${CELL} text-center text-zinc-500`}>No applicants in this tab.</TableCell>
              </TableRow>
            )}
            {state.rows.map((row) => {
              const view = interviewJobRow(row.interview);
              return (
                <TableRow key={row.id} className="border-border-subtle">
                  <TableCell className={CELL}>
                    <div className="flex items-center gap-[10px]">
                      <Initials name={row.applicantName} />
                      <div className="flex min-w-0 flex-col gap-[2px]">
                        <Link href={`/applicants/${row.id}`} className="truncate font-medium text-primary hover:underline">{row.applicantName}</Link>
                        <span className="truncate text-xs text-muted-foreground">{row.applicantEmail}</span>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className={CELL}>
                    {view.date ? (
                      <div className="flex flex-col gap-[2px]">
                        <span className="font-medium text-foreground">{view.date}</span>
                        <span className="text-xs text-muted-foreground">{view.time}</span>
                      </div>
                    ) : <span className={MUTED}>Not scheduled</span>}
                  </TableCell>
                  <TableCell className={CELL}><TypeCell type={view.type} /></TableCell>
                  <TableCell className={`${CELL} ${view.interviewer ? "" : MUTED}`}>{view.interviewer ?? "—"}</TableCell>
                  <TableCell className={CELL}><Badge variant={view.status === "Waiting" ? "warning" : "info"}>{view.status}</Badge></TableCell>
                  <TableCell className={`${CELL} text-right`}>
                    <div className="flex justify-end">
                      {row.interview?.id === PENDING_INTERVIEW_ID ? (
                        <span className="text-xs text-zinc-500">Saving…</span>
                      ) : row.interview ? (
                        <InterviewResult
                          applicationId={row.id} interviewId={row.interview.id} startsAt={row.interview.startsAt} applicantName={row.applicantName}
                          subtitle={subtitleOf(row, view, row.interview)} onChoose={(result) => setDialog({ kind: "result", row, result })}
                        />
                      ) : (
                        <Button onClick={() => setDialog({ kind: "schedule", row })} className="h-auto gap-[6px] rounded-lg px-[12px] py-[6px] text-[13px] font-medium shadow-none">
                          Schedule interview
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <InfoNote>
          Passed applicants move to Offers. Everyone gets a result email, sent at the time you choose when you record the result.
        </InfoNote>
      </Card>
      {dialog?.kind === "schedule" && (
        <ScheduleInterview
          key={dialog.row.id} label="Schedule interview" stage="Interview" applicationId={dialog.row.id} applicantName={dialog.row.applicantName}
          applicantEmail={dialog.row.applicantEmail} jobTitle={job.title} location={job.location} interviewers={interviewers}
          onOptimistic={apply} controlled={{ open: true, onOpenChange: (open) => { if (!open) setDialog(undefined); } }}
        />
      )}
      {dialog?.kind === "result" && dialog.row.interview && (
        <RecordResultDialog
          key={`${dialog.row.id}-${dialog.result}`} applicationId={dialog.row.id} interviewId={dialog.row.interview.id} applicantName={dialog.row.applicantName}
          initialResult={dialog.result} subtitle={subtitleOf(dialog.row, interviewJobRow(dialog.row.interview), dialog.row.interview)}
          onOptimistic={apply} onClose={() => setDialog(undefined)}
        />
      )}
    </>
  );
}
