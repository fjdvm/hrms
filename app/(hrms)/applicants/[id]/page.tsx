import { Suspense } from "react";
import { notFound } from "next/navigation";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { BackLink, CardTitle, PAGE, PageHeader, ProfileColumns } from "@/components/hiring/parts";
import { ApplicationError, type ApplicationProfile } from "@/lib/applications";
import type { Interviewer } from "@/lib/interviewers";
import { STAGE_BADGE, canReject, detailOrDash, formatAppliedFor, formatAvailableFrom, formatSalary, formatSource, trackerSteps } from "@/lib/application-view";
import { applicationsForRequest } from "@/lib/portal/applications";
import { requireModule } from "@/lib/portal/staff";
import { ApplicationActivity } from "@/components/hiring/application-activity";
import { RejectApplication } from "@/components/hiring/reject-application";
import { StageActions } from "@/components/hiring/stage-actions";
import { ApplicationNotes } from "@/components/hiring/application-notes";
import { ApplicationInterviews } from "@/components/hiring/application-interviews";
import { ApplicationDocuments } from "@/components/hiring/application-documents";
import { ProfileSkeleton } from "./profile-skeleton";

function Tracker({ profile }: { profile: ApplicationProfile }) {
  const steps = trackerSteps(profile.stage, profile.stageDates);
  return (
    <ol aria-label="Stage tracker" className="flex items-center gap-[12px] overflow-x-auto rounded-xl border border-border bg-card px-[24px] py-[18px]">
      {steps.map((step, index) => (
        <li key={step.label} className={cn("flex items-center gap-[12px]", index > 0 && "flex-1")}>
          {index > 0 && <span aria-hidden className={cn("h-[2px] min-w-6 flex-1 rounded-[1px]", step.state === "upcoming" ? "bg-zinc-200" : "bg-primary")} />}
          <div className="flex items-center gap-[10px] whitespace-nowrap" aria-current={step.state === "current" ? "step" : undefined}>
            <span
              aria-hidden
              className={cn(
                "flex size-[24px] shrink-0 items-center justify-center rounded-full border-[1.5px]",
                step.state === "done" && "border-primary bg-primary text-primary-foreground",
                step.state === "current" && "border-primary bg-white",
                step.state === "upcoming" && "border-zinc-200 bg-white",
              )}
            >
              {step.state === "done" && <Check className="size-3" strokeWidth={3} />}
              {step.state === "current" && <span className="size-[8px] rounded-full bg-primary" />}
              {step.state === "upcoming" && <span className="size-[8px] rounded-full bg-zinc-200" />}
            </span>
            <div className="flex flex-col gap-px">
              <span className={cn("text-sm", step.state === "upcoming" ? "font-medium text-zinc-500" : "font-semibold text-zinc-900")}>{step.label}</span>
              <span className="text-xs text-zinc-500">{step.date}</span>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-[3px]">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

function ApplicationDetails({ profile }: { profile: ApplicationProfile }) {
  return (
    <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none">
      <CardTitle>Application details</CardTitle>
      <dl className="grid gap-x-[16px] gap-y-[14px] sm:grid-cols-3">
        <Detail label="Email" value={profile.applicantEmail} />
        <Detail label="Mobile" value={detailOrDash(profile.mobile)} />
        <Detail label="Address" value={detailOrDash(profile.address)} />
        <Detail label="Expected salary" value={formatSalary(profile.expectedSalary)} />
        <Detail label="Available from" value={formatAvailableFrom(profile.availableFrom)} />
        <Detail label="Source" value={formatSource(profile.source, profile.referredBy)} />
      </dl>
      <ApplicationDocuments documents={profile.documents} applicantName={profile.applicantName} />
    </Card>
  );
}

async function Profile({ id }: { id: number }) {
  let profile: ApplicationProfile;
  let interviewers: Interviewer[] = [];
  try {
    const applications = await applicationsForRequest();
    profile = await applications.readProfile(id);
    if (profile.stage === "Interview") interviewers = await applications.interviewers();
  } catch (error) {
    if (error instanceof ApplicationError && (error.reason === "not-found" || error.reason === "validation")) notFound();
    throw error;
  }
  return (
    <>
      <BackLink href="/applicants">Applicants</BackLink>
      <PageHeader
        title={profile.applicantName}
        subtitle={formatAppliedFor(profile.jobPostingTitle, profile.location, profile.appliedAt)}
        badge={<Badge variant={STAGE_BADGE[profile.stage]}>{profile.stage}</Badge>}
      >
        {canReject(profile.stage) && <RejectApplication applicationId={id} stage={profile.stage} applicantName={profile.applicantName} />}
        <StageActions applicationId={id} stage={profile.stage} applicantName={profile.applicantName} applicantEmail={profile.applicantEmail} jobTitle={profile.jobPostingTitle} location={profile.location} interviewers={interviewers} booked={profile.interviews.find((interview) => interview.result === null)} />
      </PageHeader>
      <Tracker profile={profile} />
      <ProfileColumns main={<><ApplicationDetails profile={profile} /><ApplicationInterviews applicationId={id} stage={profile.stage} applicantName={profile.applicantName} applicantEmail={profile.applicantEmail} jobTitle={profile.jobPostingTitle} location={profile.location} interviewers={interviewers} interviews={profile.interviews} /></>} aside={<><ApplicationActivity profile={profile} /><ApplicationNotes applicationId={id} notes={profile.notes} /></>} />
    </>
  );
}

export default async function Page({ params }: PageProps<"/applicants/[id]">) {
  await requireModule("Recruitment and Hiring");
  const { id } = await params;
  // Anything that is not a whole number is no Application; the boundary rejects ids out of range.
  const applicationId = /^-?\d+$/.test(id) ? Number(id) : NaN;
  if (Number.isNaN(applicationId)) notFound();
  return (
    <div className={PAGE}>
      <Suspense fallback={<ProfileSkeleton />}>
        <Profile id={applicationId} />
      </Suspense>
    </div>
  );
}
