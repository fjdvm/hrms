"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import type { ApplicationInterview, ApplicationStage } from "@/lib/applications";
import type { Interviewer } from "@/lib/interviewers";
import { stageActions } from "@/lib/application-view";
import { ScheduleInterview } from "./schedule-interview";
import { moveApplication } from "@/app/(hrms)/applicants/[id]/actions";

/** The forward buttons for the current Stage; Schedule/Reschedule interview opens the shared dialog. */
export function StageActions({ applicationId, stage, applicantName, jobTitle, location, interviewers, interviews }: { applicationId: number; stage: ApplicationStage; applicantName: string; jobTitle: string; location: string; interviewers: Interviewer[]; interviews: ApplicationInterview[] }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const booked = interviews.find((interview) => interview.result === null);
  const actions = stageActions(stage, booked ? "booked" : interviews.length > 0 ? "done" : "none");
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
          <ScheduleInterview key={action.label} applicationId={applicationId} applicantName={applicantName} jobTitle={jobTitle} location={location} label={action.label} interviewers={interviewers} interview={booked} />
        ),
      )}
    </>
  );
}
