"use client";

import { useState, useTransition } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { requestOfferDocuments } from "@/app/(hrms)/offers/actions";
import { MESSAGE_LIMIT, defaultDueDate, defaultMessage, type DocumentStatus, type DocumentType } from "@/lib/offer-documents";
import { formatShortDate } from "@/lib/offer-view";
import { cn } from "@/lib/utils";

type Row = { type: DocumentType; label: string; hint: string; status: DocumentStatus };
type Props = {
  offerId: number;
  applicantName: string;
  role: string;
  /** "YYYY-MM-DD" */
  startDate: string;
  today: string;
  items: Row[];
};

/** Asks for the documents that are still missing, with a due date and a message; the email goes out right away. */
export function RequestDocuments({ offerId, applicantName, role, startDate, today, items }: Props) {
  const missing = items.filter((item) => item.status !== "Submitted");
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Set<DocumentType>>(() => new Set(missing.map((item) => item.type)));
  const [dueDate, setDueDate] = useState(() => defaultDueDate(startDate, today));
  const [message, setMessage] = useState(() => defaultMessage(applicantName, defaultDueDate(startDate, today)));
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const count = chosen.size;
  const toggle = (type: DocumentType, on: boolean) => setChosen((current) => { const next = new Set(current); if (on) next.add(type); else next.delete(type); return next; });
  const submit = () => {
    setError(undefined);
    start(async () => {
      const result = await requestOfferDocuments(offerId, items.map((item) => item.type).filter((type) => chosen.has(type)), dueDate, message);
      if (result.error) setError(result.error);
      else setOpen(false);
    });
  };
  const reset = () => {
    setChosen(new Set(missing.map((item) => item.type)));
    setDueDate(defaultDueDate(startDate, today));
    setMessage(defaultMessage(applicantName, defaultDueDate(startDate, today)));
    setError(undefined);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (next) reset(); }}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-auto gap-[6px] rounded-lg border-[#e6e1ee] px-[14px] py-[9px] text-sm font-medium shadow-none"><Send className="size-4" />Request documents</Button>
      </DialogTrigger>
      <DialogContent
        showClose={false}
        overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-[580px] gap-0 overflow-y-auto rounded-2xl border-0 !p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:!p-0 md:max-w-[580px] lg:max-w-[580px]"
      >
        <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Request documents</DialogTitle>
            <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">{applicantName} · {role} · start {formatShortDate(startDate)}</DialogDescription>
          </div>
          <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
        </div>
        <div className="flex flex-col gap-md px-[24px] py-[20px]">
          <fieldset className="flex flex-col gap-[8px]">
            <legend className="mb-[8px] flex gap-[3px] text-[13px] font-medium text-zinc-800">Documents to request<span className="text-red-600">*</span></legend>
            <ul className="overflow-hidden rounded-lg border border-zinc-200">
              {items.map((item) => {
                const submitted = item.status === "Submitted";
                const id = `request-${item.type}`;
                return (
                  <li key={item.type} className={cn("flex items-center gap-[12px] border-b border-zinc-100 px-[14px] py-[10px] last:border-b-0", submitted && "bg-zinc-50")}>
                    <Checkbox id={id} checked={submitted || chosen.has(item.type)} disabled={submitted} onCheckedChange={(on) => toggle(item.type, on === true)} />
                    <label htmlFor={id} className={cn("flex-1 text-sm", submitted ? "text-zinc-500" : "text-zinc-900")}>{item.label}</label>
                    <span className="text-xs text-zinc-500">{submitted ? "Already submitted" : item.hint}</span>
                  </li>
                );
              })}
            </ul>
          </fieldset>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="request-due" className="flex gap-[3px] text-[13px] font-medium text-zinc-800">Submit by<span className="text-red-600">*</span></label>
            <input
              id="request-due" type="date" min={today} value={dueDate} onChange={(event) => setDueDate(event.target.value)}
              className="rounded-lg border border-zinc-200 bg-white px-[12px] py-[9px] text-sm text-zinc-900 outline-none focus:border-[#8b5cf6]"
            />
            <p className="text-xs text-zinc-500">Only a reminder: nothing happens automatically when the date passes.</p>
          </div>
          <div className="flex flex-col gap-[6px]">
            <label htmlFor="request-message" className="text-[13px] font-medium text-zinc-800">Message <span className="font-normal text-zinc-400">(optional)</span></label>
            <Textarea id="request-message" value={message} maxLength={MESSAGE_LIMIT} onChange={(event) => setMessage(event.target.value)} className="min-h-[72px] rounded-lg border-zinc-200 bg-white text-sm shadow-none" />
          </div>
          <p className="text-xs text-zinc-500">{applicantName.split(" ")[0]} gets an email right away with the documents, the date and your message.</p>
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>
        <div className="flex items-center gap-sm border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
          <p className="flex-1 text-xs text-zinc-500">{count} {count === 1 ? "document" : "documents"}{dueDate && ` · due ${formatShortDate(dueDate)}`}</p>
          <DialogClose asChild>
            <Button type="button" variant="outline" className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] text-sm font-medium shadow-none">Cancel</Button>
          </DialogClose>
          <Button type="button" disabled={pending || count === 0} onClick={submit} className="h-auto rounded-lg px-[16px] py-[9px] text-sm font-medium shadow-none">{pending ? "Sending…" : "Send request"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
