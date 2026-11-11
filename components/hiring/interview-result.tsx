"use client";

import { useActionState, useEffect, useState } from "react";
import { Check, ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { recordInterviewResult, type ResultState } from "@/app/(hrms)/applicants/[id]/actions";
import { SCORE_LABELS } from "@/lib/application-view";
import { sendTimeOptions } from "@/lib/result-email-times";
import { OptionGroup } from "./dialog-parts";

type Result = "Passed" | "Not passed";
const MAX_TIMER_MS = 2 ** 31 - 1;

/** True once `startsAt` has passed. Flips at that moment with a single in-memory timer: no network, no polling. */
function useStarted(startsAt: Date): boolean {
  const [started, setStarted] = useState(() => startsAt.getTime() <= Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const remaining = startsAt.getTime() - Date.now();
      if (remaining <= 0) return setStarted(true);
      timer = setTimeout(arm, Math.min(remaining, MAX_TIMER_MS));
    };
    arm();
    return () => clearTimeout(timer);
  }, [startsAt]);
  return started;
}

/** The Not passed / Passed row buttons of an Interview, and the Interview result dialog they open with that result already chosen. */
export function InterviewResult({ applicationId, interviewId, startsAt, applicantName, subtitle }: { applicationId: number; interviewId: number; startsAt: Date; applicantName: string; subtitle: string }) {
  const started = useStarted(startsAt);
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<Result>("Passed");
  const choose = (next: Result) => { setResult(next); setOpen(true); };
  const rowButton = (label: Result, tone: string, icon: React.ReactNode) => {
    const button = (
      <Button type="button" variant="outline" size="sm" disabled={!started} onClick={() => choose(label)} className={`h-auto gap-[6px] rounded-lg border-[#e6e1ee] px-[12px] py-[6px] text-[13px] font-medium shadow-none [&_svg]:size-[14px] ${tone}`}>
        {icon} {label}
      </Button>
    );
    if (started) return button;
    // A disabled button swallows hover, so the tooltip hangs off a wrapper.
    return (
      <Tooltip>
        <TooltipTrigger asChild><span tabIndex={0}>{button}</span></TooltipTrigger>
        <TooltipContent>You can record the result once the interview starts.</TooltipContent>
      </Tooltip>
    );
  };
  const firstName = applicantName.split(" ")[0];
  return (
    <TooltipProvider>
    <div className="flex items-center justify-end gap-sm">
      {rowButton("Not passed", "text-red-700", <X />)}
      {rowButton("Passed", "text-[#1e6b3a]", <Check />)}
      {open && <ResultDialog key={result} {...{ applicationId, interviewId, subtitle, firstName, result, setResult, onClose: () => setOpen(false) }} />}
    </div>
    </TooltipProvider>
  );
}

function ResultDialog({ applicationId, interviewId, subtitle, firstName, result, setResult, onClose }: { applicationId: number; interviewId: number; subtitle: string; firstName: string; result: Result; setResult: (result: Result) => void; onClose: () => void }) {
  const [sendEmail, setSendEmail] = useState(true);
  const [times] = useState(() => sendTimeOptions(new Date()));
  const [state, submit, pending] = useActionState(async (previous: ResultState, data: FormData) => {
    const next = await recordInterviewResult(applicationId, interviewId, previous, data);
    if (next.recorded) onClose();
    return next;
  }, {} as ResultState);
  return (
    <Dialog open onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        showClose={false}
        overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-[580px] gap-0 overflow-y-auto rounded-2xl border-0 !p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:!p-0 md:max-w-[580px] lg:max-w-[580px]"
      >
        <form action={submit}>
          <input type="hidden" name="result" value={result} />
          <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Interview result</DialogTitle>
              <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">{subtitle}</DialogDescription>
            </div>
            <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
          </div>
          <div className="flex flex-col gap-md px-[24px] py-[20px]">
            <div className="flex flex-col gap-[8px]">
              <p className="flex gap-[3px] text-[13px] font-medium text-zinc-800">Result<span className="text-red-600">*</span></p>
              <OptionGroup
                value={result}
                onChange={setResult}
                options={[
                  { value: "Passed", title: "Passed", description: "Moves to Offers", icon: <Check className="text-[#1e6b3a]" /> },
                  { value: "Not passed", title: "Not passed", description: "Moves to Rejected", icon: <X className="text-red-700" /> },
                ]}
              />
            </div>
            <div className="flex flex-col gap-[6px]">
              <label htmlFor="interview-score" className="text-[13px] font-medium text-zinc-800">Score</label>
              <div className="relative flex items-center rounded-lg border border-zinc-200 bg-white focus-within:border-[#8b5cf6]">
                <select id="interview-score" name="score" defaultValue="4" className="w-full cursor-pointer appearance-none bg-transparent px-[12px] py-[9px] text-sm text-zinc-900 outline-none">
                  {SCORE_LABELS.map((label, index) => <option key={label} value={index + 1}>{index + 1} / 5 · {label}</option>)}
                </select>
                <ChevronDown aria-hidden className="pointer-events-none absolute right-[12px] size-4 text-zinc-500" />
              </div>
            </div>
            <div className="flex flex-col gap-[6px]">
              <label htmlFor="interview-notes" className="text-[13px] font-medium text-zinc-800">Interview notes <span className="font-normal text-zinc-500">(private)</span></label>
              <Textarea id="interview-notes" name="privateNotes" className="h-16 min-h-0 resize-none rounded-lg border-zinc-200 bg-white px-[12px] py-[9px] text-sm leading-5 shadow-none" />
              <p className="text-xs text-zinc-500">Scores and notes are private to HR and never shown to the Applicant.</p>
            </div>
            <div className="flex items-center gap-[12px]">
              <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
                <p id="result-email-title" className="text-sm font-medium text-zinc-900">Email the result to {firstName}</p>
                <p className="text-xs text-zinc-500">Applicants get a result email whether they pass or not.</p>
              </div>
              <Switch aria-labelledby="result-email-title" checked={sendEmail} onCheckedChange={setSendEmail} className="h-5 w-9 data-[state=checked]:bg-[#7c3aed] [&>span]:size-4 [&>span]:data-[state=checked]:translate-x-4" />
            </div>
            {sendEmail && (
              <div className="flex flex-col gap-[6px]">
                <label htmlFor="result-email-at" className="text-[13px] font-medium text-zinc-800">Send email</label>
                <div className="relative flex items-center rounded-lg border border-zinc-200 bg-white focus-within:border-[#8b5cf6]">
                  <select id="result-email-at" name="resultEmailAt" defaultValue={times.find((time) => time.label.startsWith("Tomorrow"))?.value} className="w-full cursor-pointer appearance-none bg-transparent px-[12px] py-[9px] text-sm text-zinc-900 outline-none">
                    {times.map((time) => <option key={time.value} value={time.value}>{time.label}</option>)}
                  </select>
                  <ChevronDown aria-hidden className="pointer-events-none absolute right-[12px] size-4 text-zinc-500" />
                </div>
                <p className="text-xs text-zinc-500">Sent later, not right away. The wording is fixed and it can’t be edited or cancelled.</p>
              </div>
            )}
            {state.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
          </div>
          <div className="flex items-center gap-sm border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
            <p className="flex-1 text-xs text-zinc-500">{result === "Passed" ? "The Application moves to Offers." : "The Application moves to Rejected."}</p>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] text-sm font-medium shadow-none">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={pending} className="h-auto rounded-lg px-[16px] py-[9px] text-sm font-medium shadow-none">{pending ? "Saving…" : "Save result"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
