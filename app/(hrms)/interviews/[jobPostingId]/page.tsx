import { notFound } from "next/navigation";
import { PAGE } from "@/components/hiring/parts";
import { InterviewJobList } from "@/components/hiring/interview-job-list";
import { interviewTabFromParam } from "@/lib/application-view";
import { ApplicationError } from "@/lib/applications";
import type { Interviewer } from "@/lib/interviewers";
import { applicationsForRequest } from "@/lib/portal/applications";
import { requireModule } from "@/lib/portal/staff";

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

  return (
    <div className={`${PAGE} !pt-[20px]`}>
      <InterviewJobList
        job={{ title: job.title, location: job.location, employmentType: job.employmentType, label: job.label }}
        tab={tab} rows={rows} counts={counts} interviewers={interviewers} hrefBase={`/interviews/${jobPostingId}`}
      />
    </div>
  );
}
