"use client";

import { useState } from "react";
import { ClipboardCheck, Check, Flag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, ProfileColumns } from "@/components/hiring/parts";
import type { EvaluationDetail } from "@/lib/performance-evaluations";
import type { DevelopmentNeed } from "@/lib/performance-needs";
import type { TrainingTitle } from "@/lib/performance-training";
import { dayMonth } from "@/lib/performance-evaluation-view";
import { Banner, Checklist, KpiResults, PeriodCard, ReopeningCard, StatusBadge } from "./evaluation-parts";
import { AttendanceIssuesCard } from "./attendance-issues-card";
import { SubmitEvaluationDialog } from "./submit-evaluation-dialog";
import { ReopenEvaluationDialog } from "./reopen-evaluation-dialog";
import { FlagNeedDialog } from "./flag-need-dialog";
import { RatingDialog } from "./rating-dialog";
import { ResolveIssueDialog, type ResolveTarget } from "./resolve-issue-dialog";

const NO_RATING = "No rating or comments yet. Enter a rating from 0 to 100 and comments, then submit.";

/** The needs flagged for this Employee and period, newest first: the gap and its recommended action or Training, with who flagged it and when. */
function DevelopmentNeeds({ needs }: { needs: readonly DevelopmentNeed[] }) {
  if (needs.length === 0) return null;
  return (
    <div className="flex flex-col gap-[8px]" data-testid="development-needs">
      <h3 className="text-xs text-muted-foreground">Development needs</h3>
      <ul className="flex flex-col gap-[8px]">
        {needs.map((need) => (
          <li key={need.id} className="flex flex-col text-sm text-foreground">
            <span>{need.gap} · recommended {need.action}</span>
            <span className="text-xs text-muted-foreground">Flagged by {need.flaggedByName} on {dayMonth(need.flaggedAt)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The Evaluation section: the rating and comments, or the invitation to enter them, then the Development needs flagged for the period. */
function EvaluationCard({ detail, needs }: { detail: EvaluationDetail; needs: readonly DevelopmentNeed[] }) {
  const rating = detail.rating;
  return (
    <Card className="flex flex-col gap-[12px] rounded-xl p-[20px] shadow-none">
      <h2 className="text-[15px] font-semibold text-foreground">Evaluation</h2>
      {rating ? (
        <>
          <p className="text-sm text-foreground"><span className="font-semibold">Rating {rating.value} / 100</span><span className="text-muted-foreground"> · entered by {rating.savedByName} on {dayMonth(rating.savedAt)}</span></p>
          <p className="whitespace-pre-line text-sm text-foreground">{rating.comments || <span className="text-muted-foreground">No comments.</span>}</p>
        </>
      ) : <p className="text-sm text-foreground">{NO_RATING}</p>}
      <DevelopmentNeeds needs={needs} />
    </Card>
  );
}

/**
 * One Employee's evaluation for a period: the status and who they are, the banner, the period card, the KPI results, the rating
 * and the Submit checklist. The rating form is opened from the banner and from the KPI results, and saving refreshes the page.
 * Submit evaluation is faded until all four checks pass, then opens the confirmation dialog; once submitted the page shows the locked
 * Evaluated state with a Reopen button that opens the Reopen evaluation dialog. Flag development need is offered once a rating is saved
 * (In review or Evaluated) and adds to the Development needs list on the Evaluation card. Print report and History belong to the later spec.
 */
export function EvaluationView({ detail, needs = [], trainings = [] }: { detail: EvaluationDetail; needs?: readonly DevelopmentNeed[]; trainings?: readonly TrainingTitle[] }) {
  const [ratingOpen, setRatingOpen] = useState(false);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);
  const [flagOpen, setFlagOpen] = useState(false);
  const [resolving, setResolving] = useState<ResolveTarget | null>(null);
  const subtitle = [detail.employeeNumber, detail.position, detail.branch, detail.period.name].join(" · ");
  const canEditRating = !detail.submitted;
  const canSubmit = detail.submit.unlocked;
  const hasRating = detail.rating !== null;

  return (
    <>
      <PageHeader title={detail.name} subtitle={subtitle} badge={<StatusBadge status={detail.status} />}>
        {detail.status !== "Draft" && (
          <Button type="button" variant="outline" onClick={() => setFlagOpen(true)} className="h-auto gap-[6px] rounded-lg border-[#e6e1ee] px-[12px] py-[9px] font-medium shadow-none">
            <Flag aria-hidden className="size-4" />Flag development need
          </Button>
        )}
        {!detail.submitted && (
          <Button type="button" disabled={!canSubmit} onClick={() => setSubmitOpen(true)} className="h-auto gap-[6px] rounded-lg bg-[#5b2a86] px-[14px] py-[9px] font-medium shadow-none disabled:opacity-40">
            <Check aria-hidden className="size-4" />Submit evaluation
          </Button>
        )}
      </PageHeader>
      <Banner detail={detail} onEnterRating={() => setRatingOpen(true)} onReopen={() => setReopenOpen(true)} />
      <ProfileColumns
        main={
          <>
            <PeriodCard detail={detail} />
            {detail.issues.length > 0 && !detail.submitted && <AttendanceIssuesCard issues={detail.issues} onResolve={setResolving} />}
            <KpiResults detail={detail} action={canEditRating ? (
              <Button type="button" variant="outline" onClick={() => setRatingOpen(true)} className="h-auto gap-[6px] rounded-lg border-[#e6e1ee] px-[12px] py-[7px] shadow-none">
                <ClipboardCheck aria-hidden className="size-4" />{hasRating ? "Edit rating" : "Enter rating"}
              </Button>
            ) : null} />
            <EvaluationCard detail={detail} needs={needs} />
          </>
        }
        aside={<><Checklist detail={detail} /><ReopeningCard detail={detail} /></>}
      />
      {detail.status !== "Draft" && <FlagNeedDialog detail={detail} trainings={trainings} open={flagOpen} onOpenChange={setFlagOpen} />}
      {detail.submitted && <ReopenEvaluationDialog detail={detail} open={reopenOpen} onOpenChange={setReopenOpen} />}
      {!detail.submitted && <SubmitEvaluationDialog detail={detail} open={submitOpen} onOpenChange={setSubmitOpen} />}
      <ResolveIssueDialog employeeId={detail.employeeId} periodId={detail.period.id} employeeName={detail.name} periodName={detail.period.name}
        countedDays={detail.scheduledDays.length - detail.excusedDays.length} target={resolving} onClose={() => setResolving(null)} />
      {canEditRating && (
        <RatingDialog key={detail.rating?.savedAt ?? "new"} employeeId={detail.employeeId} periodId={detail.period.id} current={detail.rating ? { value: detail.rating.value, comments: detail.rating.comments } : undefined} open={ratingOpen} onOpenChange={setRatingOpen} />
      )}
    </>
  );
}
