"use client";

import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ApplicationInterview, ApplicationStage } from "@/lib/applications";
import { interviewRow } from "@/lib/application-view";
import { InterviewResult, RecordResultDialog, type Result } from "@/components/hiring/interview-result";
import { useProfileInterviews } from "@/components/hiring/profile-interviews";
import { CELL, CardTitle, HEAD } from "@/components/hiring/parts";
import { ScheduleInterview } from "@/components/hiring/schedule-interview";
import type { Interviewer } from "@/lib/interviewers";
import { PENDING_INTERVIEW_ID } from "@/lib/interview-optimistic";

/** Every interview booked for the Application, newest first, with its score once HR has recorded a result. */
export function ApplicationInterviews({ applicationId, stage: serverStage, applicantName, applicantEmail, jobTitle, location, interviewers, interviews: serverInterviews }: { applicationId: number; stage: ApplicationStage; applicantName: string; applicantEmail: string; jobTitle: string; location: string; interviewers: Interviewer[]; interviews: ApplicationInterview[] }) {
  // Bookings, moves and results appear here the moment HR saves. The dialogs live here, not in the rows, so a row that completes keeps its dialog.
  const { state, apply } = useProfileInterviews({ interviews: serverInterviews, stage: serverStage });
  const { interviews, stage } = state;
  const [dialog, setDialog] = useState<{ kind: "reschedule"; interview: ApplicationInterview } | { kind: "result"; interview: ApplicationInterview; result: Result; subtitle: string }>();
  return (
    <Card className="flex flex-col gap-[10px] rounded-xl px-[20px] py-[18px] shadow-none">
      <CardTitle aside={<span className="text-xs font-medium text-primary">Scorecards are private to HR</span>}>Interviews</CardTitle>
      {interviews.length === 0
        ? <p className="text-sm text-zinc-500">No interviews yet. Schedule one to see it here.</p>
        : (
          <Table aria-label="Interviews" className="table-fixed min-w-[660px]">
            <TableHeader>
              <TableRow className="border-border-subtle hover:bg-transparent">
                <TableHead className={`${HEAD} w-[16%]`}>Date</TableHead>
                <TableHead className={`${HEAD} w-[18%]`}>Type</TableHead>
                <TableHead className={`${HEAD} w-[17%]`}>Interviewer</TableHead>
                <TableHead className={`${HEAD} w-[9%]`}>Score</TableHead>
                <TableHead className={`${HEAD} w-[15%]`}>Status</TableHead>
                <TableHead className={`${HEAD} w-[25%] text-right`}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {interviews.map((interview) => {
                const row = interviewRow(interview, stage);
                return (
                  <Fragment key={interview.id}>
                    <TableRow className="border-border-subtle">
                      <TableCell className={CELL}>
                        <p className="font-medium">{row.date}</p>
                        <p className="mt-0.5 text-xs text-zinc-500">{row.time}</p>
                      </TableCell>
                      <TableCell className={`${CELL} whitespace-normal`}>{row.type}</TableCell>
                      <TableCell className={`${CELL} whitespace-normal`}>{row.interviewer}</TableCell>
                      <TableCell className={CELL}>{row.score}</TableCell>
                      <TableCell className={CELL}>
                        <Badge variant={row.status === "Completed" ? "success" : row.status === "Dropped" ? "secondary" : "info"}>{row.status}</Badge>
                      </TableCell>
                      <TableCell className={`${CELL} text-right`}>
                        {row.live && interview.id !== PENDING_INTERVIEW_ID && (
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" onClick={() => setDialog({ kind: "reschedule", interview })} className="h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] text-sm font-medium shadow-none">Reschedule</Button>
                            <InterviewResult applicationId={applicationId} interviewId={interview.id} startsAt={interview.startsAt} applicantName={applicantName} subtitle={`${applicantName} · ${jobTitle} · ${row.date}, ${row.type.toLowerCase()} with ${row.interviewer}`}
                              onChoose={(result) => setDialog({ kind: "result", interview, result, subtitle: `${applicantName} · ${jobTitle} · ${row.date}, ${row.type.toLowerCase()} with ${row.interviewer}` })} />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                    {interview.privateNotes && (
                      <TableRow className="border-border-subtle hover:bg-transparent">
                        <TableCell colSpan={6} className="whitespace-normal pb-3 pt-0 text-xs text-zinc-600"><span className="font-medium text-zinc-800">Private notes (HR only): </span>{interview.privateNotes}</TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        )}
      {dialog?.kind === "reschedule" && (
        <ScheduleInterview
          key={dialog.interview.id} label="Reschedule" applicationId={applicationId} stage={stage} applicantName={applicantName} applicantEmail={applicantEmail}
          jobTitle={jobTitle} location={location} interviewers={interviewers} interview={dialog.interview} onOptimistic={apply}
          controlled={{ open: true, onOpenChange: (open) => { if (!open) setDialog(undefined); } }}
        />
      )}
      {dialog?.kind === "result" && (
        <RecordResultDialog
          key={`${dialog.interview.id}-${dialog.result}`} applicationId={applicationId} interviewId={dialog.interview.id} applicantName={applicantName}
          initialResult={dialog.result} subtitle={dialog.subtitle} onOptimistic={apply} onClose={() => setDialog(undefined)}
        />
      )}
    </Card>
  );
}
