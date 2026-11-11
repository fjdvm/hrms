import Link from "next/link";
import { Briefcase, Calendar, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PAGE, PageHeader, InfoNote } from "@/components/hiring/parts";
import { interviewsSubtitle, nextInterviewLabel } from "@/lib/application-view";
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
          {nextInterview ? `Next: ${nextInterviewLabel(nextInterview, now)}` : nextInterviewLabel(null, now)}
        </span>
      </div>
    </Link>
  );
}

export default async function Page() {
  await requireModule("Recruitment and Hiring");
  const { jobs, totals } = await (await applicationsForRequest()).interviewJobs();
  const now = new Date();

  return (
    <div className={PAGE}>
      <PageHeader title="Interviews" subtitle={interviewsSubtitle(totals)} />
      {jobs.length === 0 ? (
        <p className="rounded-xl border bg-card px-[20px] py-[28px] text-sm text-zinc-500">
          No applicants are in the interview stage yet. Move an applicant to Interview from Applicants to see their job here.
        </p>
      ) : (
        <div className="grid gap-md md:grid-cols-2 xl:grid-cols-3">
          {jobs.map((job) => (
            <JobCard key={job.jobPostingId} job={job} now={now} />
          ))}
        </div>
      )}
      <InfoNote>
        Only jobs with applicants in the interview stage are shown. Open a job to schedule interviews and record results.
      </InfoNote>
    </div>
  );
}
