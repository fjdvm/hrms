"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { saveEvaluationRating } from "@/app/(hrms)/performance/actions";
import { COMMENTS_MAX_LENGTH, checkComments, checkRating } from "@/lib/performance-rating-terms";
import { cn } from "@/lib/utils";
import { BOX, Callout, DialogActions, DialogBody, DialogFrame, FieldLabel, Help } from "./dialog-frame";

type Props = {
  employeeId: number;
  periodId: number;
  /** The saved rating and comments when editing; undefined for the first entry. */
  current?: { value: number; comments: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function Form({ employeeId, periodId, current, onDone }: Omit<Props, "open" | "onOpenChange"> & { onDone: () => void }) {
  const [ratingText, setRatingText] = useState(current ? String(current.value) : "");
  const [comments, setComments] = useState(current?.comments ?? "");
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const rating = checkRating(ratingText);
  const commentsError = checkComments(comments);
  const ratingError = touched || ratingText !== "" ? rating.error : null;
  const canSave = rating.value !== null && commentsError === null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!canSave || rating.value === null || pending) return;
    start(async () => {
      const result = await saveEvaluationRating(employeeId, periodId, { rating: rating.value!, comments });
      if (!result.ok) { setFailure(result.error); return; }
      toast.success("Rating saved");
      onDone();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="rating-value" required>Rating (0 to 100)</FieldLabel>
          <Input id="rating-value" inputMode="numeric" autoComplete="off" value={ratingText} disabled={pending} aria-invalid={ratingError ? true : undefined} aria-describedby="rating-value-help"
            onChange={(event) => { setRatingText(event.target.value); setFailure(undefined); }} onBlur={() => setTouched(true)} className={cn(BOX, ratingError && "border-[#9a3412]")} />
          <Help id="rating-value-help" error={ratingError}>Your judgement of this Employee for the period. It counts as the Evaluator rating KPI.</Help>
        </div>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="rating-comments">Comments</FieldLabel>
          <Textarea id="rating-comments" rows={5} value={comments} disabled={pending} aria-invalid={commentsError ? true : undefined} aria-describedby="rating-comments-help"
            onChange={(event) => { setComments(event.target.value); setFailure(undefined); }} className={cn("rounded-lg border-[#e4e4e7] px-[12px] py-[9px] text-sm shadow-none", commentsError && "border-[#9a3412]")} />
          <Help id="rating-comments-help" error={commentsError}>Optional. Up to {COMMENTS_MAX_LENGTH} characters.</Help>
        </div>
        <Callout>Saving the rating moves this evaluation to In review. You can change it until the evaluation is submitted.</Callout>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit="Save rating" canSubmit={canSave} pending={pending} />
    </form>
  );
}

/** The Evaluation form: a rating from 0 to 100 and comments, built from the Performance dialog pattern since Figma does not draw it. */
export function RatingDialog({ open, onOpenChange, ...props }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogFrame title={props.current ? "Edit rating" : "Enter rating"} description="Rating and comments">
        <Form {...props} onDone={() => onOpenChange(false)} />
      </DialogFrame>
    </Dialog>
  );
}
