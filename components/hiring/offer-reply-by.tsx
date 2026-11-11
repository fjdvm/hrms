"use client";

import { useState, useTransition } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { extendReplyBy, sendOffer } from "@/app/(hrms)/offers/actions";

type Props = {
  mode: "send" | "extend";
  offerId: number;
  applicantName: string;
  /** The earliest date that may be chosen, "YYYY-MM-DD". */
  min: string;
  current?: string;
};

/** Asks for the reply-by date: to send a Draft, or to give a Sent offer more time. */
export function OfferReplyBy({ mode, offerId, applicantName, min, current }: Props) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(current ?? "");
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const sending = mode === "send";
  const submit = () => {
    if (!date) return setError("Choose a reply-by date.");
    setError(undefined);
    start(async () => {
      const result = await (sending ? sendOffer(offerId, date) : extendReplyBy(offerId, date));
      if (result?.error) setError(result.error);
      else setOpen(false);
    });
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) setError(undefined); }}>
      <DialogTrigger asChild>
        {sending
          ? <Button type="button" className="h-auto gap-[6px] rounded-lg px-[14px] py-[9px] shadow-none"><Send className="size-4" />Send offer</Button>
          : <Button type="button" variant="outline" className="h-auto rounded-lg px-[14px] py-[9px] shadow-none">Extend reply-by</Button>}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{sending ? "Send this offer?" : "Extend the reply-by date"}</DialogTitle>
          <DialogDescription>
            {sending
              ? `${applicantName} is emailed the complete terms, and the terms lock. Choose the date they should reply by.`
              : `Give ${applicantName} more time. They can still reply after the date, so nothing expires.`}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-[6px]">
          <label htmlFor="offer-reply-by" className="text-[13px] font-medium text-zinc-800">Reply by</label>
          <input
            id="offer-reply-by" type="date" min={min} value={date} onChange={(event) => setDate(event.target.value)}
            className="rounded-lg border border-zinc-200 bg-white px-[12px] py-[9px] text-sm text-zinc-900 outline-none focus:border-[#8b5cf6]"
          />
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} className="shadow-none">Cancel</Button>
          <Button type="button" disabled={pending} onClick={submit} className="shadow-none">
            {pending ? (sending ? "Sending…" : "Saving…") : sending ? "Send offer" : "Extend"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
