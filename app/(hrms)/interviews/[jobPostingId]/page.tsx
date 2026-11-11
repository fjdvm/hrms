import { notFound } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MapPin, Video } from "lucide-react";
import { BackLink, CELL, HEAD, InfoNote, PAGE, PageHeader } from "@/components/hiring/parts";
import { Initials } from "@/components/hiring/parts";
import { InterviewResult } from "@/components/hiring/interview-result";
import { ScheduleInterview } from "@/components/hiring/schedule-interview";
import { interviewJobRow, interviewTabFromParam, type InterviewJobRowView } from "@/lib/application-view";
import { ApplicationError, type InterviewJobTab } from "@/lib/applications";
import type { Interviewer } from "@/lib/interviewers";
import { applicationsForRequest } from "@/lib/portal/applications";
import { requireModule } from "@/lib/portal/staff";
import { cn } from "@/lib/utils";

const MUTED = "text-zinc-400";
const TABS: InterviewJobTab[] = ["All", "To schedule", "Scheduled"];

function TypeCell({ type }: { type: InterviewJobRowView["type"] }) {
  if (!type) return <span className={MUTED}>—</span>;
  const Icon = type === "Online" ? Video : MapPin;
  return (
    <span className="flex items-center gap-[6px]">
      <Icon className="size-4 text-zinc-500" />
      {type}
    </span>
  );
}

export default async function Page({ params, searchParams }: PageProps<"/interviews/[jobPostingId]">) {
  await requireModule("Recruitment and Hiring");
  const { jobPostingId } = await params;
  const tab = interviewTabFromParam((await searchParams).tab as string | undefined);
  const applications = await applicationsForRequest();
  let data: Awaited<ReturnType<typeof applications.interviewJob>>;
  let interviewers: Interviewer[] = [];
  try {
    data = await applications.interviewJob(decodeURIComponent(jobPostingId), tab);
    if (data.counts["To schedule"] > 0) interviewers = await applications.interviewers();
  } catch (error) {
    if (error instanceof ApplicationError && (error.reason === "not-found" || error.reason === "validation")) notFound();
    throw error;
  }
  const { job, counts, rows } = data;
  const href = (next: InterviewJobTab) => `/interviews/${jobPostingId}${next === "All" ? "" : `?tab=${encodeURIComponent(next)}`}`;

  return (
    <div className={`${PAGE} !pt-[20px]`}>
      <div className="flex flex-col gap-xs">
        <BackLink href="/interviews">Interviews</BackLink>
        <PageHeader
          title={job.title}
          badge={<Badge variant={job.label ? "secondary" : "success"}>{job.label ?? "Published"}</Badge>}
          subtitle={`${job.location} · ${job.employmentType} · ${counts.All} ${counts.All === 1 ? "applicant" : "applicants"} in the interview stage`}
        >
          <Button variant="outline" className="h-auto rounded-lg px-[14px] py-[9px] shadow-none" asChild>
            <Link href="/job-postings">View job posting</Link>
          </Button>
        </PageHeader>
      </div>
      <nav aria-label="Interview list tabs" className="flex flex-wrap gap-xs">
        {TABS.map((label) => (
          <Link
            key={label}
            href={href(label)}
            aria-current={label === tab ? "page" : undefined}
            className={cn("rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground", label === tab && "bg-accent text-primary")}
          >
            {label} {counts[label]}
          </Link>
        ))}
      </nav>
      <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
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
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className={`${CELL} text-center text-zinc-500`}>No applicants in this tab.</TableCell>
              </TableRow>
            )}
            {rows.map((row) => {
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
                  <TableCell className={CELL}>
                    <Badge variant={view.status === "Waiting" ? "warning" : "info"}>{view.status}</Badge>
                  </TableCell>
                  <TableCell className={`${CELL} text-right`}>
                    <div className="flex justify-end">
                      {row.interview ? (
                        <InterviewResult
                          applicationId={row.id}
                          interviewId={row.interview.id}
                          startsAt={row.interview.startsAt}
                          applicantName={row.applicantName}
                          subtitle={`${row.applicantName} · ${job.title} · ${view.date}, ${view.type?.toLowerCase()} with ${view.interviewer}`}
                        />
                      ) : (
                        <ScheduleInterview
                          compact
                          label="Schedule interview"
                          applicationId={row.id}
                          stage="Interview"
                          applicantName={row.applicantName}
                          applicantEmail={row.applicantEmail}
                          jobTitle={job.title}
                          location={job.location}
                          interviewers={interviewers}
                        />
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
    </div>
  );
}
