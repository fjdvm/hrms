"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ApplicationStage } from "@/lib/applications";
import { stageActions } from "@/lib/application-view";
import type { ApplicationInterview } from "@/lib/applications";
import type { Interviewer } from "@/lib/interviewers";
import { useProfileInterviews } from "./profile-interviews";
import { ScheduleInterview } from "./schedule-interview";
import { moveApplication } from "@/app/(hrms)/applicants/[id]/actions";

/** The forward buttons for the current Stage. */
export function StageActions({ applicationId, stage, applicantName, applicantEmail, jobTitle, location, interviewers, booked }: { applicationId: number; stage: ApplicationStage; applicantName: string; applicantEmail: string; jobTitle: string; location: string; interviewers: Interviewer[]; booked?: ApplicationInterview }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const { state, apply } = useProfileInterviews({ interviews: booked ? [booked] : [], stage });
  const live = state.interviews.find((interview) => interview.result === null);
  const actions = stageActions(stage);
  if (actions.length === 0) return null;
  return (
    <>
      {error && <p role="alert" className="w-full text-right text-xs text-destructive">{error}</p>}
      {actions.map((action) =>
        action.kind === "move" ? (
          <Button
            key={action.label}
            disabled={pending}
            onClick={() => start(async () => setError((await moveApplication(applicationId, stage, action.to)).error))}
            className="h-auto rounded-lg px-[14px] py-[9px] text-sm font-medium shadow-none"
          >
            {action.label}
          </Button>
        ) : (
          <ScheduleInterview key={action.label} applicationId={applicationId} stage={stage} applicantName={applicantName} applicantEmail={applicantEmail} jobTitle={jobTitle} location={location} interviewers={interviewers} interview={live} onOptimistic={apply} label={live ? "Reschedule interview" : action.label} />
        ),
      )}
    </>
  );
}
