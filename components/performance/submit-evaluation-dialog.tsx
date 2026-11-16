"use client";

import { useState, useTransition } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { submitEvaluation } from "@/app/(hrms)/performance/actions";
import type { EvaluationDetail } from "@/lib/performance-evaluations";
import { scoreHeadline, submitSummary } from "@/lib/performance-evaluation-view";
import { Callout, DialogActions, DialogBody, DialogFrame, InfoBox } from "./dialog-frame";

type Props = { detail: EvaluationDetail; open: boolean; onOpenChange: (open: boolean) => void };

function Form({ detail, onDone }: { detail: EvaluationDetail; onDone: () => void }) {
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const firstName = detail.name.split(" ")[0];
  // The server decides; this only keeps a press from going out while a check is plainly missing.
  const canSubmit = detail.submit.unlocked;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || pending) return;
    start(async () => {
      const result = await submitEvaluation(detail.employeeId, detail.period.id);
      if (!result.ok) { setFailure(result.error); return; }
      toast.success("Evaluation submitted");
      onDone();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <InfoBox icon={<Info aria-hidden className="size-[13px]" />} label="What happens" title="Submitting locks this evaluation">
          The score, KPI results, weights and formulas used are saved for {firstName}. Any Staff member who holds Performance can reopen it, with a recorded reason.
        </InfoBox>
        <Callout>{submitSummary(detail)}</Callout>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit="Submit evaluation" cancel="Back" canSubmit={canSubmit} pending={pending} note="No email is sent." />
    </form>
  );
}

/**
 * The Submit evaluation? dialog: the name, period and score, what submitting does, and the four checks as met. Back closes it without
 * submitting. If the server refuses because a check is missing, the reason is shown here and the dialog stays open.
 */
export function SubmitEvaluationDialog({ detail, open, onOpenChange }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogFrame title="Submit evaluation?" description={`${detail.name} · ${detail.period.name} · ${scoreHeadline(detail)}`}>
        <Form detail={detail} onDone={() => onOpenChange(false)} />
      </DialogFrame>
    </Dialog>
  );
}
