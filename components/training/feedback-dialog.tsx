"use client";

import { useState, useTransition } from "react";
import { FileText, MessageSquare, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { saveFeedback } from "@/app/(hrms)/training/actions";
import { FEEDBACK_COMMENTS_MAX, FEEDBACK_LABELS, FEEDBACK_RATINGS, feedbackLabel, type TrainingFeedback } from "@/lib/training-terms";
import { cn } from "@/lib/utils";

/**
 * Record feedback: the rating (1 to 5 stars) and comments Staff type from the paper feedback form. The trigger is the
 * Feedback cell itself: "Record feedback" before there is any, "4 / 5 recorded" after (open it again to change it).
 */
export function FeedbackDialog({ trainingId, employeeId, employeeName, trainingTitle, trainingDate, feedback, onSaved }: {
  trainingId: number; employeeId: number; employeeName: string; trainingTitle: string; trainingDate: string;
  feedback: TrainingFeedback | null; onSaved: (feedback: TrainingFeedback) => void;
}) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(0);
  const [comments, setComments] = useState("");
  const [ratingError, setRatingError] = useState<string>();
  const [commentsError, setCommentsError] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  function reset(next: boolean) {
    setOpen(next);
    if (!next) return;
    setRating(feedback?.rating ?? 0); setComments(feedback?.comments ?? "");
    setRatingError(undefined); setCommentsError(undefined); setError(undefined);
  }
  function submit() {
    setRatingError(undefined); setCommentsError(undefined); setError(undefined);
    if (rating < 1) { setRatingError("Choose a rating from 1 to 5 stars."); return; }
    start(async () => {
      const result = await saveFeedback(trainingId, employeeId, rating, comments);
      if (result.feedback) { onSaved(result.feedback); setOpen(false); return; }
      setRatingError(result.ratingError); setCommentsError(result.commentsError); setError(result.error);
    });
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        {feedback ? (
          <button type="button" aria-label={`Feedback for ${employeeName}: ${feedback.rating} of 5 recorded. Change`} className="flex items-center gap-[8px] rounded-md text-[13px] text-[#1f1a2e] hover:underline">
            <Star className="size-[14px] fill-[#f59e0b] text-[#f59e0b]" aria-hidden />{feedback.rating} / 5 recorded
          </button>
        ) : (
          <Button variant="outline" aria-label={`Record feedback for ${employeeName}`} className="h-auto gap-[6px] rounded-lg border-[#e6e1ee] bg-white px-[12px] py-[6px] text-[13px] font-medium text-[#1f1a2e] shadow-none">
            <MessageSquare className="size-[14px]" aria-hidden />Record feedback
          </Button>
        )}
      </DialogTrigger>
      <DialogContent showClose={false} overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="w-[calc(100vw-32px)] max-w-[580px] gap-0 rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:p-0 md:max-w-[580px] lg:max-w-[580px]">
        <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Record feedback</DialogTitle>
            <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">{employeeName} · {trainingTitle} · {trainingDate}</DialogDescription>
          </div>
          <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
        </div>
        <div className="flex flex-col gap-[16px] px-[24px] py-[20px]">
          <p className="flex items-center gap-[8px] rounded-lg bg-[#eef4fd] px-[12px] py-[10px] text-[13px] font-medium text-[#1d4f91]"><FileText className="size-4 shrink-0" aria-hidden />Typed from the paper feedback form</p>
          <div className="flex flex-col gap-[8px]">
            <span id="feedback-rating" className="flex gap-[3px] text-[13px] font-medium text-zinc-800">Rating<span className="text-[#dc2626]" aria-hidden>*</span></span>
            <div className="flex items-center gap-[6px]">
              <div role="radiogroup" aria-labelledby="feedback-rating" className="flex gap-[6px]">
                {FEEDBACK_RATINGS.map((value) => (
                  <button key={value} type="button" role="radio" aria-checked={rating === value} aria-label={`${value} of 5 · ${FEEDBACK_LABELS[value]}`} onClick={() => { setRating(value); setRatingError(undefined); }} className="rounded-md">
                    <Star className={cn("size-[28px]", value <= rating ? "fill-[#f59e0b] text-[#f59e0b]" : "text-zinc-300")} aria-hidden />
                  </button>
                ))}
              </div>
              {rating > 0 && <span className="ml-[2px] text-sm font-medium text-zinc-900">{feedbackLabel(rating)}</span>}
            </div>
            {ratingError && <p role="alert" className="text-xs text-destructive">{ratingError}</p>}
          </div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="feedback-comments" className="flex gap-[3px] text-[13px] font-medium text-zinc-800">Comments<span className="font-normal text-zinc-400">(optional)</span></label>
            <textarea id="feedback-comments" value={comments} onChange={(event) => setComments(event.target.value)} maxLength={FEEDBACK_COMMENTS_MAX} aria-invalid={Boolean(commentsError)}
              className={cn("h-[88px] resize-none rounded-lg border bg-white px-[12px] py-[9px] text-sm leading-5 text-zinc-900 outline-none focus:border-[#8b5cf6]", commentsError ? "border-destructive" : "border-zinc-200")} />
            {commentsError && <p role="alert" className="text-xs text-destructive">{commentsError}</p>}
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex items-center gap-[8px] border-t border-[#ebebeb] bg-[#fafafa] px-[24px] py-[14px]">
          <p className="flex-1 text-xs text-zinc-500">Saved to the employee’s training history.</p>
          <DialogClose asChild><Button variant="outline" className="h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] text-sm font-medium shadow-none">Cancel</Button></DialogClose>
          <Button disabled={pending} onClick={submit} className="h-auto rounded-lg px-[14px] py-[9px] text-sm font-medium shadow-none">{pending ? "Saving…" : "Save feedback"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
