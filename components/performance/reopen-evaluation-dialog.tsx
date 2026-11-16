"use client";

import { useState, useTransition } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { reopenEvaluation } from "@/app/(hrms)/performance/actions";
import type { EvaluationDetail } from "@/lib/performance-evaluations";
import { dayMonth, scoreHeadline } from "@/lib/performance-evaluation-view";
import { checkReopenReason, REASON_MAX_LENGTH } from "@/lib/performance-reopen-terms";
import { cn } from "@/lib/utils";
import { Callout, DialogActions, DialogBody, DialogFrame, FieldLabel, Help, InfoBox } from "./dialog-frame";

type Props = { detail: EvaluationDetail; open: boolean; onOpenChange: (open: boolean) => void };

function Form({ detail, onDone }: { detail: EvaluationDetail; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const problem = checkReopenReason(reason);
  const shown = touched || reason !== "" ? problem : null;
  const submitted = detail.submitted;
  const score = detail.score.outcome === "scored" ? detail.score.value.toFixed(1) : "Insufficient data";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (problem !== null || pending) return;
    start(async () => {
      const result = await reopenEvaluation(detail.employeeId, detail.period.id, reason);
      if (!result.ok) { setFailure(result.error); return; }
      toast.success("Evaluation reopened");
      onDone();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="reopen-reason" required>Reason</FieldLabel>
          <Textarea id="reopen-reason" rows={3} value={reason} disabled={pending} aria-required aria-invalid={shown ? true : undefined} aria-describedby="reopen-reason-help"
            onChange={(event) => { setReason(event.target.value); setFailure(undefined); }} onBlur={() => setTouched(true)}
            className={cn("rounded-lg border-[#e4e4e7] px-[12px] py-[9px] text-sm shadow-none", shown && "border-[#9a3412]")} />
          <Help id="reopen-reason-help" error={shown}>Recorded in the audit log. Up to {REASON_MAX_LENGTH} characters.</Help>
        </div>
        <InfoBox icon={<Info aria-hidden className="size-[13px]" />} label="What happens" title="The submitted version is kept">
          The evaluation returns to In review. The version submitted on {submitted ? dayMonth(submitted.submittedAt) : "—"} ({score}) is kept, and the score is recalculated from current data with the same weights.
        </InfoBox>
        <Callout>Any Staff member who holds Performance can reopen an evaluation. This is recorded with your name and the reason above.</Callout>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit="Reopen evaluation" cancel="Keep locked" canSubmit={problem === null} pending={pending} note="No email is sent." />
    </form>
  );
}

/**
 * The Reopen evaluation? dialog: the name, period, submitted date and score, a required reason, and what happens. Keep locked closes it
 * and changes nothing. If the server refuses, the reason is shown here and the dialog stays open.
 */
export function ReopenEvaluationDialog({ detail, open, onOpenChange }: Props) {
  const date = detail.submitted ? dayMonth(detail.submitted.submittedAt) : "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogFrame title="Reopen evaluation?" description={`${detail.name} · ${detail.period.name} · submitted ${date} · ${scoreHeadline(detail)}`}>
        <Form detail={detail} onDone={() => onOpenChange(false)} />
      </DialogFrame>
    </Dialog>
  );
}
