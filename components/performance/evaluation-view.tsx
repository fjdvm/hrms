"use client";

import { useState } from "react";
import { ClipboardCheck, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader, ProfileColumns } from "@/components/hiring/parts";
import type { EvaluationDetail } from "@/lib/performance-evaluations";
import { dayMonth } from "@/lib/performance-evaluation-view";
import { Banner, Checklist, KpiResults, PeriodCard, StatusBadge } from "./evaluation-parts";
import { AttendanceIssuesCard } from "./attendance-issues-card";
import { RatingDialog } from "./rating-dialog";
import { ResolveIssueDialog, type ResolveTarget } from "./resolve-issue-dialog";

const NO_RATING = "No rating or comments yet. Enter a rating from 0 to 100 and comments, then submit.";

/** The Evaluation section: the rating and comments, or the invitation to enter them. Development needs belong to the later spec. */
function EvaluationCard({ detail }: { detail: EvaluationDetail }) {
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
    </Card>
  );
}

/**
 * One Employee's evaluation for a period: the status and who they are, the banner, the period card, the KPI results, the rating
 * and the Submit checklist. The rating form is opened from the banner and from the KPI results, and saving refreshes the page.
 * Submit evaluation is faded while locked; submitting and reopening are separate tickets, and Print report, Flag development need,
 * History and the Development needs list belong to the later spec.
 */
export function EvaluationView({ detail, onSubmit }: { detail: EvaluationDetail; /** Wired by the Submit evaluation dialog; without it the button is shown but cannot act. */ onSubmit?: () => void }) {
  const [ratingOpen, setRatingOpen] = useState(false);
  const [resolving, setResolving] = useState<ResolveTarget | null>(null);
  const subtitle = [detail.employeeNumber, detail.position, detail.branch, detail.period.name].join(" · ");
  const canEditRating = !detail.submitted;
  const canSubmit = detail.submit.unlocked && onSubmit !== undefined;
  const hasRating = detail.rating !== null;

  return (
    <>
      <PageHeader title={detail.name} subtitle={subtitle} badge={<StatusBadge status={detail.status} />}>
        <Button type="button" disabled={!canSubmit} onClick={onSubmit} className="h-auto gap-[6px] rounded-lg bg-[#5b2a86] px-[14px] py-[9px] font-medium shadow-none disabled:opacity-40">
          <Check aria-hidden className="size-4" />Submit evaluation
        </Button>
      </PageHeader>
      <Banner detail={detail} onEnterRating={() => setRatingOpen(true)} />
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
            <EvaluationCard detail={detail} />
          </>
        }
        aside={<Checklist detail={detail} />}
      />
      <ResolveIssueDialog employeeId={detail.employeeId} periodId={detail.period.id} employeeName={detail.name} periodName={detail.period.name}
        countedDays={detail.scheduledDays.length - detail.excusedDays.length} target={resolving} onClose={() => setResolving(null)} />
      {canEditRating && (
        <RatingDialog key={detail.rating?.savedAt ?? "new"} employeeId={detail.employeeId} periodId={detail.period.id} current={detail.rating ? { value: detail.rating.value, comments: detail.rating.comments } : undefined} open={ratingOpen} onOpenChange={setRatingOpen} />
      )}
    </>
  );
}
