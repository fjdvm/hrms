import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ApplicationInterview } from "@/lib/applications";
import { interviewRow } from "@/lib/application-view";
import { InterviewResult } from "@/components/hiring/interview-result";
import { CELL, CardTitle, HEAD } from "@/components/hiring/parts";

/** Every interview booked for the Application, newest first, with its score once HR has recorded a result. */
export function ApplicationInterviews({ applicationId, applicantName, jobTitle, interviews }: { applicationId: number; applicantName: string; jobTitle: string; interviews: ApplicationInterview[] }) {
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
                const row = interviewRow(interview);
                return (
                  <TableRow key={interview.id} className="border-border-subtle">
                    <TableCell className={CELL}>
                      <p className="font-medium">{row.date}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{row.time}</p>
                    </TableCell>
                    <TableCell className={`${CELL} whitespace-normal`}>{row.type}</TableCell>
                    <TableCell className={`${CELL} whitespace-normal`}>{row.interviewer}</TableCell>
                    <TableCell className={CELL}>{row.score}</TableCell>
                    <TableCell className={CELL}>
                      <Badge variant={row.status === "Completed" ? "success" : "info"}>{row.status}</Badge>
                    </TableCell>
                    <TableCell className={`${CELL} text-right`}>
                      {interview.result === null && (
                        <InterviewResult applicationId={applicationId} interviewId={interview.id} startsAt={interview.startsAt} applicantName={applicantName} subtitle={`${applicantName} · ${jobTitle} · ${row.date}, ${row.type.toLowerCase()} with ${row.interviewer}`} />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
    </Card>
  );
}
