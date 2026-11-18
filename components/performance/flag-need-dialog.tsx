"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { flagDevelopmentNeed } from "@/app/(hrms)/performance/actions";
import type { EvaluationDetail } from "@/lib/performance-evaluations";
import { ACTION_MAX_LENGTH, GAP_MAX_LENGTH, checkNeedText, needMessage } from "@/lib/performance-needs-terms";
import type { TrainingTitle } from "@/lib/performance-training";
import { cn } from "@/lib/utils";
import { Callout, DialogActions, DialogBody, DialogFrame, FieldLabel, Help, PILL, PILL_ON } from "./dialog-frame";

type Props = { detail: EvaluationDetail; trainings: readonly TrainingTitle[]; open: boolean; onOpenChange: (open: boolean) => void };

const FIELD = "min-h-[64px] rounded-lg border-[#e4e4e7] px-[12px] py-[9px] text-sm shadow-none";
/** How many scheduled Trainings are offered as quick picks; anything else is typed. */
const MAX_PICKS = 6;
const trainingAction = (title: string) => `Training: ${title}`;

function Form({ detail, trainings, onDone }: { detail: EvaluationDetail; trainings: readonly TrainingTitle[]; onDone: () => void }) {
  const [gap, setGap] = useState("");
  const [action, setAction] = useState("");
  // The Training picked from the list. Typing over the text makes it a described action again, so the two can never disagree.
  const [trainingId, setTrainingId] = useState<number | null>(null);
  const [touched, setTouched] = useState({ gap: false, action: false });
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();

  const gapProblem = checkNeedText("gap", gap);
  const actionProblem = checkNeedText("action", action);
  const shown = {
    gap: touched.gap || gap !== "" ? gapProblem : null,
    action: touched.action || action !== "" ? actionProblem : null,
  };

  const pick = (training: TrainingTitle) => {
    setAction(trainingAction(training.title));
    setTrainingId(training.id);
    setFailure(undefined);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched({ gap: true, action: true });
    if (gapProblem !== null || actionProblem !== null || pending) return;
    start(async () => {
      const result = await flagDevelopmentNeed(detail.employeeId, detail.period.id, { gap, action, trainingId });
      if (!result.ok) { setFailure(result.error); return; }
      toast.success("Development need flagged");
      onDone();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="need-gap" required>Gap</FieldLabel>
          <Textarea id="need-gap" rows={2} value={gap} disabled={pending} aria-required aria-invalid={shown.gap ? true : undefined} aria-describedby="need-gap-help"
            onChange={(event) => { setGap(event.target.value); setFailure(undefined); }} onBlur={() => setTouched((was) => ({ ...was, gap: true }))}
            className={cn(FIELD, shown.gap && "border-[#9a3412]")} />
          <Help id="need-gap-help" error={shown.gap ? needMessage(shown.gap) : null}>Job-related gaps only. Up to {GAP_MAX_LENGTH} characters.</Help>
        </div>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="need-action" required>Recommended action or Training</FieldLabel>
          <Textarea id="need-action" rows={2} value={action} disabled={pending} aria-required aria-invalid={shown.action ? true : undefined} aria-describedby="need-action-help"
            onChange={(event) => { setAction(event.target.value); setTrainingId(null); setFailure(undefined); }} onBlur={() => setTouched((was) => ({ ...was, action: true }))}
            className={cn(FIELD, shown.action && "border-[#9a3412]")} />
          <Help id="need-action-help" error={shown.action ? needMessage(shown.action) : null}>Pick a scheduled Training or describe the action. Up to {ACTION_MAX_LENGTH} characters.</Help>
          {trainings.length > 0 && (
            <div role="group" aria-label="Scheduled Trainings" className="flex flex-wrap gap-[6px]">
              {trainings.slice(0, MAX_PICKS).map((training) => (
                <button key={training.id} type="button" disabled={pending} aria-pressed={trainingId === training.id} onClick={() => pick(training)}
                  className={cn(PILL, "border border-[#e4e4e7] px-[10px] py-[5px] text-xs", trainingId === training.id && PILL_ON)}>
                  {training.title}
                </button>
              ))}
            </div>
          )}
        </div>
        <Callout>A flag is a recommendation for Staff to review. It never changes the score.</Callout>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit="Flag need" canSubmit={gapProblem === null && actionProblem === null} pending={pending} note="No email is sent." />
    </form>
  );
}

/**
 * The Flag development need dialog: the Gap and the Recommended action or Training, both required, with the Employee and period in the
 * subtitle. Nothing is saved until Flag need is confirmed; Cancel closes it and saves nothing. A refusal from the server is shown here
 * and the dialog stays open. It remounts on every open so each flag starts empty.
 */
export function FlagNeedDialog({ detail, trainings, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogFrame title="Flag development need" description={`${detail.name} · ${detail.period.name}`}>
        <Form detail={detail} trainings={trainings} onDone={() => onOpenChange(false)} />
      </DialogFrame>
    </Dialog>
  );
}
