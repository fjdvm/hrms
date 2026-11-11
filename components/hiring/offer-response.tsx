"use client";

import { useState, useTransition } from "react";
import { Check, Clock, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { recordReply } from "@/app/(hrms)/offers/actions";
import { manilaNowLocal, replyEmail, type OfferAnswer } from "@/lib/offer-reply";
import { cn } from "@/lib/utils";

type Props = {
  offerId: number;
  applicantName: string;
  role: string;
  /** "₱15,500" */
  salary: string;
  /** "10 Nov" */
  startShort: string;
  /** "2026-11-10" */
  startDate: string;
};

const OPTIONS: { answer: OfferAnswer; hint: string; icon: typeof Check }[] = [
  { answer: "Accepted", hint: "Next, request their documents", icon: Check },
  { answer: "Declined", hint: "Moves to Rejected", icon: X },
];

const FIELD = "w-full rounded-lg border border-zinc-200 bg-white px-[12px] py-[9px] text-sm text-zinc-900 outline-none focus:border-[#8b5cf6]";

/** The Mark as declined / Mark as accepted buttons and the Offer response dialog they open. Replies are final and a queued email can't be edited. */
export function OfferResponse({ offerId, applicantName, role, salary, startShort, startDate }: Props) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<OfferAnswer>("Accepted");
  const [repliedAt, setRepliedAt] = useState("");
  const [now, setNow] = useState("");
  const [later, setLater] = useState(false);
  const [sendAt, setSendAt] = useState("");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const first = applicantName.trim().split(/\s+/)[0] || applicantName;

  const openWith = (choice: OfferAnswer) => {
    const current = manilaNowLocal();
    setAnswer(choice); setNow(current); setRepliedAt(current); setSendAt(current); setLater(false); setError(undefined); setOpen(true);
  };
  const email = replyEmail(answer, { applicantName, role, startDate });
  const submit = () => {
    if (!repliedAt) return setError("Choose when the reply came in.");
    if (later && !sendAt) return setError("Choose when the email goes out.");
    setError(undefined);
    start(async () => {
      const result = await recordReply(offerId, answer, repliedAt, later ? sendAt : null);
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  };
  return (
    <>
      <Button type="button" variant="outline" onClick={() => openWith("Declined")} className="h-auto gap-[6px] rounded-lg border-[#e6e1ee] px-[14px] py-[9px] text-sm font-medium text-[#b91c1c] shadow-none hover:text-[#b91c1c]">
        <X className="size-4" />Mark as declined
      </Button>
      <Button type="button" onClick={() => openWith("Accepted")} className="h-auto gap-[6px] rounded-lg px-[14px] py-[9px] text-sm font-medium shadow-none">
        <Check className="size-4" />Mark as accepted
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          showClose={false}
          overlayClassName="bg-[rgba(18,13,26,0.45)]"
          className="max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-[580px] gap-0 overflow-y-auto rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:p-0 md:max-w-[580px] lg:max-w-[580px]"
        >
          <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-[#1f1a2e]">Offer response</DialogTitle>
              <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">
                {applicantName} · {role} · {salary} / month · start {startShort}
              </DialogDescription>
            </div>
            <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
          </div>
          <div className="flex flex-col gap-[16px] px-[24px] py-[20px]">
            <div className="flex flex-col gap-[8px]">
              <span id="offer-answer-label" className="text-[13px] font-medium text-zinc-800">{first}’s answer <span className="text-[#dc2626]">*</span></span>
              <div className="flex flex-col gap-[10px] sm:flex-row" role="radiogroup" aria-labelledby="offer-answer-label">
                {OPTIONS.map(({ answer: value, hint, icon: Icon }) => {
                  const selected = answer === value;
                  return (
                    <button
                      key={value} type="button" role="radio" aria-checked={selected} onClick={() => setAnswer(value)}
                      className={cn("flex min-w-0 flex-1 cursor-pointer items-center gap-[12px] rounded-[10px] px-[14px] py-[12px] text-left",
                        selected ? "border-[1.5px] border-[#8b5cf6] bg-[#f5f0ff]" : "border border-zinc-200 bg-white")}
                    >
                      <span aria-hidden className={cn("flex size-[16px] shrink-0 items-center justify-center rounded-full border-[1.5px]", selected ? "border-[#8b5cf6]" : "border-zinc-300")}>
                        {selected && <span className="size-[8px] rounded-full bg-[#8b5cf6]" />}
                      </span>
                      <span aria-hidden className={cn("flex size-[32px] shrink-0 items-center justify-center rounded-lg", selected ? "bg-white" : "bg-zinc-100")}>
                        <Icon className={cn("size-4", value === "Declined" ? "text-[#dc2626]" : "text-[#1e6b3a]")} />
                      </span>
                      <span className="flex min-w-0 flex-col gap-[2px]">
                        <span className="text-sm font-medium text-zinc-900">{value}</span>
                        <span className="text-xs text-zinc-500">{hint}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex flex-col gap-[6px]">
              <label htmlFor="reply-received" className="text-[13px] font-medium text-zinc-800">Reply received</label>
              <input id="reply-received" type="datetime-local" max={now} value={repliedAt} onChange={(event) => setRepliedAt(event.target.value)} className={FIELD} />
              <p className="text-xs text-zinc-500">When the reply came in, for example by phone or email.</p>
            </div>
            <div className="flex flex-col gap-[6px]">
              <label htmlFor="send-email" className="text-[13px] font-medium text-zinc-800">Send email</label>
              <div className="relative">
                <Clock aria-hidden className="pointer-events-none absolute left-[12px] top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
                <select id="send-email" value={later ? "later" : "now"} onChange={(event) => setLater(event.target.value === "later")} className={cn(FIELD, "pl-[36px]")}>
                  <option value="now">Right away</option>
                  <option value="later">At a chosen time</option>
                </select>
              </div>
              {later && <input aria-label="Email send time" type="datetime-local" min={now} value={sendAt} onChange={(event) => setSendAt(event.target.value)} className={FIELD} />}
              <p className="text-xs text-zinc-500">{later ? "Sent at that time. Once queued, it can’t be edited or cancelled." : "Sent as soon as you save. It can’t be edited or cancelled."}</p>
            </div>
            <div aria-label="Email preview" className="flex flex-col gap-[6px] rounded-lg bg-[#f7f5fa] px-[14px] py-[12px]">
              <div className="flex items-center gap-[6px] text-[11px] font-semibold text-[#6e6680]"><Mail className="size-[14px]" />EMAIL PREVIEW</div>
              <p className="text-[13px] font-semibold text-[#1f1a2e]">{email.title}</p>
              <p className="whitespace-pre-line text-[13px] leading-[19px] text-[#6e6680]">{email.body}</p>
            </div>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          </div>
          <div className="flex items-center gap-[8px] border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
            <p className="flex-1 text-xs text-zinc-500">{answer === "Accepted" ? "The offer moves to Accepted. This is final." : "The offer moves to Declined and the Application to Rejected. This is final."}</p>
            <DialogClose asChild><Button type="button" variant="outline" className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] text-sm font-medium shadow-none">Cancel</Button></DialogClose>
            <Button type="button" disabled={pending} onClick={submit} className="h-auto rounded-lg px-[16px] py-[9px] text-sm font-medium shadow-none">{pending ? "Saving…" : "Save response"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
