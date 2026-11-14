"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cancelTraining } from "@/app/(hrms)/training/actions";
import { CANCEL_REASON_MAX, cancelledEmail } from "@/lib/training-terms";

type Person = { name: string; email: string | null };

/** Cancel training: a required reason, the Notify toggle (on by default) with a preview, and a destructive primary button. */
export function CancelTrainingDialog({ trainingId, title, date, subtitle, people }: { trainingId: number; title: string; date: string; subtitle: string; people: Person[] }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [notify, setNotify] = useState(true);
  const [reasonError, setReasonError] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const emailed = people.filter((person) => person.email);
  const direct = people.length - emailed.length;
  const sample = emailed[0]?.name ?? people[0]?.name ?? "there";
  const preview = cancelledEmail(sample, { title, date }, reason.trim() || "the reason you give here");

  function reset(next: boolean) {
    setOpen(next);
    if (next) { setReason(""); setNotify(true); setReasonError(undefined); setError(undefined); }
  }
  function submit() {
    setError(undefined);
    if (!reason.trim()) { setReasonError("Enter a reason for cancelling."); return; }
    setReasonError(undefined);
    start(async () => {
      const result = await cancelTraining(trainingId, reason, notify);
      if (result.reasonError) setReasonError(result.reasonError);
      else if (result.error) setError(result.error);
      else setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-auto rounded-lg border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium text-[#b91c1c] shadow-none hover:bg-white hover:text-[#b91c1c]">Cancel training</Button>
      </DialogTrigger>
      <DialogContent showClose={false} overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="w-[calc(100vw-32px)] max-w-[580px] gap-0 rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:p-0 md:max-w-[580px] lg:max-w-[580px]">
        <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Cancel training?</DialogTitle>
            <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">{title} · {subtitle}</DialogDescription>
          </div>
          <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
        </div>
        <div className="flex flex-col gap-[16px] px-[24px] py-[20px]">
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="cancel-reason" className="flex gap-[3px] text-[13px] font-medium text-zinc-800">Reason<span className="text-[#dc2626]" aria-hidden>*</span></label>
            <Textarea id="cancel-reason" value={reason} onChange={(event) => setReason(event.target.value)} maxLength={CANCEL_REASON_MAX} required aria-required="true"
              aria-invalid={Boolean(reasonError)} aria-describedby="cancel-reason-note" placeholder="Why is this training cancelled?"
              className="h-[72px] min-h-[72px] resize-none rounded-lg border-zinc-200 bg-white px-[12px] py-[9px] text-sm leading-5 shadow-none" />
            {reasonError
              ? <p id="cancel-reason-note" role="alert" className="text-xs text-destructive">{reasonError}</p>
              : <p id="cancel-reason-note" className="text-xs text-zinc-500">Shown in the training and in the email.</p>}
          </div>
          <div className="flex items-center gap-[12px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <p id="notify-label" className="text-sm font-medium text-zinc-900">Notify assigned employees</p>
              <p className="text-xs text-zinc-500">
                {people.length === 0 ? "No one is assigned, so no email will be sent."
                  : `${emailed.length} ${emailed.length === 1 ? "gets" : "get"} a Cancelled email.${direct > 0 ? ` ${direct} without an email must be told directly.` : ""}`}
              </p>
              {!notify && <p role="status" className="text-xs text-[#8a5a00]">If you turn this off, they may still show up.</p>}
            </div>
            <Switch aria-labelledby="notify-label" checked={notify} onCheckedChange={setNotify}
              className="h-5 w-9 data-[state=checked]:bg-[#7c3aed] [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-4" />
          </div>
          {notify && (
            <div className="flex flex-col gap-[6px] rounded-lg bg-[#f7f5fa] px-[14px] py-[12px]">
              <p className="flex items-center gap-[6px] text-[11px] font-semibold uppercase text-[#6e6680]"><Mail className="size-[14px]" aria-hidden />Email preview</p>
              <p className="text-[13px] font-semibold text-foreground">{preview.title}</p>
              <p className="whitespace-pre-line text-[13px] leading-[19px] text-[#6e6680]">{preview.body.replace(/\n\nBren Raphael's$/, "")}</p>
            </div>
          )}
          <p className="flex items-start gap-[8px] rounded-lg bg-[#fbe6e0] px-[12px] py-[10px] text-[13px] leading-[19px] text-[#9a3412]">
            <AlertTriangle className="mt-[2px] size-4 shrink-0" aria-hidden />
            {people.length === 0 ? "No one is assigned yet." : `All ${people.length} assigned ${people.length === 1 ? "employee" : "employees"} will be set to Cancelled.`} This can’t be undone; create a new training instead.
          </p>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex items-center justify-end gap-[8px] border-t border-[#ebebeb] bg-[#fafafa] px-[24px] py-[14px]">
          <DialogClose asChild><Button variant="outline" className="h-auto rounded-lg border-zinc-200 px-[14px] py-[9px] text-sm font-medium shadow-none">Keep training</Button></DialogClose>
          <Button disabled={pending} onClick={submit} className="h-auto rounded-lg bg-[#b91c1c] px-[14px] py-[9px] text-sm font-medium text-white shadow-none hover:bg-[#991b1b]">
            {pending ? "Cancelling…" : "Cancel training"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
