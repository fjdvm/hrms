"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Bell, Mail, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { sendTrainingReminder } from "@/app/(hrms)/training/actions";
import { reminderEmail } from "@/lib/training-email";
import { reminderDueAt, reminderWhen, type TrainingMode } from "@/lib/training-terms";

type Person = { name: string; email: string | null };
type Terms = { title: string; trainer: string; date: string; startTime: string; endTime: string; mode: TrainingMode; location: string };

const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`);

/** Send reminder: who gets it (count and names), the email as it will read, and who is left out for having no email. */
export function SendReminderDialog({ trainingId, training, subtitle, people }: { trainingId: number; training: Terms; subtitle: string; people: Person[] }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();

  const emailed = people.filter((person) => person.email);
  const without = people.filter((person) => !person.email).map((person) => person.name);
  const preview = reminderEmail(emailed[0]?.name ?? "there", training);
  // The footer only mentions the automatic reminder while it is still to come.
  const upcoming = new Date() < reminderDueAt(training.date);

  function reset(next: boolean) { setOpen(next); if (next) setError(undefined); }
  function submit() {
    setError(undefined);
    start(async () => {
      const result = await sendTrainingReminder(trainingId);
      if (result.error) setError(result.error); else setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-auto gap-[6px] rounded-lg border-[#e6e1ee] bg-white px-[14px] py-[9px] text-sm font-medium text-[#1f1a2e] shadow-none"><Bell className="size-4" aria-hidden />Send reminder</Button>
      </DialogTrigger>
      <DialogContent showClose={false} overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="w-[calc(100vw-32px)] max-w-[580px] gap-0 rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:p-0 md:max-w-[580px] lg:max-w-[580px]">
        <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Send reminder</DialogTitle>
            <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">{training.title} · {subtitle}</DialogDescription>
          </div>
          <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
        </div>
        <div className="flex flex-col gap-[16px] px-[24px] py-[20px]">
          <div className="flex items-center gap-[12px] rounded-[10px] bg-[#f7f5fa] px-[16px] py-[14px]">
            <Mail className="size-[18px] shrink-0 text-primary" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <p className="text-sm font-semibold text-zinc-900">
                {people.length === 0 ? "No one is assigned yet" : `${emailed.length} of ${people.length} assigned ${people.length === 1 ? "employee" : "employees"} will get an email`}
              </p>
              {emailed.length > 0 && <p className="text-xs text-zinc-500">{emailed.map((person) => person.name).join(", ")}</p>}
            </div>
          </div>
          {emailed.length > 0 && (
            <div className="flex flex-col gap-[6px] rounded-lg bg-[#f7f5fa] px-[14px] py-[12px]">
              <p className="flex items-center gap-[6px] text-[11px] font-semibold uppercase text-[#6e6680]"><Mail className="size-[14px]" aria-hidden />Email preview</p>
              <p className="text-[13px] font-semibold text-foreground">{preview.title}</p>
              <p className="whitespace-pre-line text-[13px] leading-[19px] text-[#6e6680]">{preview.body.replace(/\n\nBren Raphael's HR$/, "")}</p>
            </div>
          )}
          {without.length > 0 && (
            <p className="flex items-start gap-[8px] rounded-lg bg-[#fdf1d8] px-[12px] py-[10px] text-[13px] leading-[19px] text-[#8a5a00]">
              <AlertTriangle className="mt-[2px] size-4 shrink-0" aria-hidden />
              Not emailed: {list(without)} {without.length === 1 ? "has" : "have"} no email address. Give them a printed schedule instead.
            </p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex items-center gap-[8px] border-t border-[#ebebeb] bg-[#fafafa] px-[24px] py-[14px]">
          <p className="flex-1 text-xs text-zinc-500">{upcoming ? `An automatic reminder also goes out ${reminderWhen(training.date)}.` : ""}</p>
          <DialogClose asChild><Button variant="outline" className="h-auto rounded-lg border-zinc-200 px-[14px] py-[9px] text-sm font-medium shadow-none">Cancel</Button></DialogClose>
          <Button disabled={pending || emailed.length === 0} onClick={submit} className="h-auto rounded-lg px-[14px] py-[9px] text-sm font-medium shadow-none">{pending ? "Sending…" : "Send reminder"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
