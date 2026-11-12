import Link from "next/link";
import { Briefcase, Calendar, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PAGE, PageHeader, InfoNote } from "@/components/hiring/parts";
import { InterviewsCalendar } from "@/components/hiring/interviews-calendar";
import { InterviewsViewSwitch } from "@/components/hiring/interviews-view-switch";
import { interviewsSubtitle, nextInterviewLabel } from "@/lib/application-view";
import { calendarFilters, calendarState, calendarSubtitle, calendarTitle, viewFromParam } from "@/lib/calendar-view";
import type { InterviewJobSummary } from "@/lib/applications";
import { applicationsForRequest } from "@/lib/portal/applications";
import { requireModule } from "@/lib/portal/staff";
import { cn } from "@/lib/utils";

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[2px] rounded-lg bg-zinc-50 px-[10px] py-[8px]">
      <span className={cn("text-lg font-semibold leading-[normal]", value === 0 ? "text-zinc-400" : "text-zinc-900")}>{value}</span>
      <span className="whitespace-nowrap text-[11px] font-medium text-zinc-500">{label}</span>
    </div>
  );
}

function JobCard({ job, now }: { job: InterviewJobSummary; now: Date }) {
  const { toSchedule, scheduled, nextInterview, label } = job;
  return (
    <Link
      href={`/interviews/${encodeURIComponent(job.jobPostingId)}`}
      className="flex flex-col gap-md rounded-xl border bg-card pb-md pl-[20px] pr-[20px] pt-[18px] hover:border-primary/40"
    >
      <div className="flex items-center gap-[12px]">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary">
          <Briefcase className="size-[18px]" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="truncate text-[15px] font-semibold text-zinc-900">{job.title}</span>
          <span className="truncate text-xs text-zinc-500">{job.location} · {job.employmentType}</span>
        </div>
        {label && <Badge variant="secondary">{label}</Badge>}
        <ChevronRight className="size-4 shrink-0 text-zinc-500" />
      </div>
      <div className="flex gap-sm">
        <Stat value={toSchedule} label="To schedule" />
        <Stat value={scheduled} label="Scheduled" />
      </div>
      <div className="flex items-center gap-sm border-t border-border-subtle pt-[12px]">
        <Calendar className={cn("size-[14px] shrink-0", nextInterview ? "text-primary" : "text-zinc-400")} />
        <span className={cn("flex-1 truncate text-[13px]", nextInterview ? "font-medium text-foreground" : "text-zinc-500")}>
          {nextInterview ? `Next: ${nextInterviewLabel(nextInterview, now)}` : "No upcoming interviews"}
        </span>
      </div>
    </Link>
  );
}

export default async function Page({ searchParams }: PageProps<"/interviews">) {
  await requireModule("Recruitment and Hiring");
  const params = await searchParams;
  const applications = await applicationsForRequest();
  const { jobs, totals } = await applications.interviewJobs();

  if (viewFromParam(params.view) === "calendar") {
    const state = calendarState(params);
    const [{ interviews, conflicts }, interviewers] = await Promise.all([applications.calendar(calendarFilters(state)), applications.interviewers()]);
    return (
      <div className={PAGE}>
        <PageHeader title="Interviews" subtitle={calendarSubtitle(state, interviews.length, conflicts.length)}>
          <InterviewsViewSwitch current="calendar" />
        </PageHeader>
        <InterviewsCalendar
          state={state} title={calendarTitle(state)} interviews={interviews} conflicts={conflicts} interviewers={interviewers}
          jobs={jobs.map((job) => ({ id: job.jobPostingId, title: job.title }))}
        />
      </div>
    );
  }

  const now = new Date();
  return (
    <div className={PAGE}>
      <PageHeader title="Interviews" subtitle={interviewsSubtitle(totals)}>
        <InterviewsViewSwitch current="by-job" />
      </PageHeader>
      {jobs.length === 0 ? (
        <p className="rounded-xl border bg-card px-[20px] py-[28px] text-sm text-zinc-500">
          No jobs are posted yet. Open job postings appear here, ready for applicants moved to Interview.
        </p>
      ) : (
        <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <JobCard key={job.jobPostingId} job={job} now={now} />
          ))}
        </div>
      )}
      <InfoNote>
        Every open job is shown, plus any closed or filled job that still has applicants in the interview stage. Open a job to schedule interviews and record results.
      </InfoNote>
    </div>
  );
}
