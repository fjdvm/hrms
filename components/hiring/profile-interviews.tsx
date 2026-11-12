"use client";

import { createContext, useContext, useOptimistic } from "react";
import { Badge } from "@/components/ui/badge";
import type { ApplicationInterview, ApplicationStage } from "@/lib/applications";
import { applyToProfileInterviews, type InterviewPatch } from "@/lib/interview-optimistic";

type ProfileState = { interviews: ApplicationInterview[]; stage: ApplicationStage };
type Value = { state: ProfileState; apply: (patch: InterviewPatch) => void };
const Context = createContext<Value | null>(null);

/** A result moves the Application at once on the server (Passed to Offer, Not passed to Rejected); the profile shows the same the moment HR saves. */
function applyToProfile(state: ProfileState, patch: InterviewPatch): ProfileState {
  const interviews = applyToProfileInterviews(state.interviews, patch);
  return { interviews, stage: patch.kind === "result" ? (patch.result === "Passed" ? "Offer" : "Rejected") : state.stage };
}

/** Shares one optimistic view of an Application's Interviews and Stage between the profile's header, badge and Interviews table. */
export function ProfileInterviewsProvider({ interviews, stage, children }: { interviews: ApplicationInterview[]; stage: ApplicationStage; children: React.ReactNode }) {
  const [state, apply] = useOptimistic<ProfileState, InterviewPatch>({ interviews, stage }, applyToProfile);
  return <Context.Provider value={{ state, apply }}>{children}</Context.Provider>;
}

/** Outside a provider (other pages, tests) this falls back to the server's values and does nothing optimistically. */
export function useProfileInterviews(fallback: { interviews: ApplicationInterview[]; stage: ApplicationStage }): Value {
  return useContext(Context) ?? { state: fallback, apply: () => {} };
}

export function StageBadge({ stage, variants }: { stage: ApplicationStage; variants: Record<string, React.ComponentProps<typeof Badge>["variant"]> }) {
  const { state } = useProfileInterviews({ interviews: [], stage });
  return <Badge variant={variants[state.stage]}>{state.stage}</Badge>;
}

/** Hides stage-specific actions while an optimistic result has already moved the Application on. */
export function WhileStage({ stage, children }: { stage: ApplicationStage; children: React.ReactNode }) {
  const { state } = useProfileInterviews({ interviews: [], stage });
  return state.stage === stage ? <>{children}</> : null;
}
