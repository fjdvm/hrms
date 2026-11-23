"use client";

import { Loader2, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** The pieces the Performance dialogs share: the header and footer from the Figma dialog frames, field labels, help text and callouts. */
export const BOX = "h-[40px] w-full rounded-lg border-[#e4e4e7] px-[12px] py-[9px] text-sm shadow-none";
export const ERROR_COLOUR = "text-[#9a3412]";
export const PILL = "rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50";
export const PILL_ON = "bg-accent text-primary hover:text-primary";

export function DialogFrame({ title, description, children, wide }: { title: string; description: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <DialogContent showClose={false} overlayClassName="bg-[rgba(18,13,26,0.45)]"
      className={cn("w-[calc(100vw-32px)] gap-0 rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:rounded-2xl sm:p-0",
        wide ? "max-w-[780px] sm:max-w-[780px] md:max-w-[780px] lg:max-w-[780px]" : "max-w-[580px] sm:max-w-[580px] md:max-w-[580px] lg:max-w-[580px]")}>
      <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
        <div className="flex flex-1 flex-col gap-[3px]">
          <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">{title}</DialogTitle>
          <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">{description}</DialogDescription>
        </div>
        <DialogClose aria-label="Close" className="text-zinc-500 hover:text-zinc-900"><X className="size-[18px]" aria-hidden /></DialogClose>
      </div>
      {children}
    </DialogContent>
  );
}

export const DialogBody = ({ children }: { children: React.ReactNode }) => (
  <div className="flex max-h-[calc(100vh-220px)] flex-col gap-[16px] overflow-y-auto px-[24px] py-[20px]">{children}</div>
);

export function DialogActions({ submit, canSubmit, pending, note = "Not saved yet", cancel = "Cancel", danger }: { submit: string; canSubmit: boolean; pending: boolean; note?: string; cancel?: string; danger?: boolean }) {
  return (
    <div className="flex items-center gap-sm border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
      <p className="mr-auto text-xs text-zinc-500">{note}</p>
      <DialogClose asChild><Button type="button" variant="outline" disabled={pending} className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] shadow-none">{cancel}</Button></DialogClose>
      <Button type="submit" disabled={!canSubmit || pending} className={cn("h-auto rounded-lg px-[16px] py-[9px]", danger ? "bg-[#b42318] hover:bg-[#b42318]/90" : "bg-[#5b2a86]")}>{pending && <Loader2 className="animate-spin" />}{submit}</Button>
    </div>
  );
}

export function FieldLabel({ id, required, children }: { id?: string; required?: boolean; children: React.ReactNode }) {
  const text = <>{children}{required && <> <span className="text-red-600" aria-hidden>*</span></>}</>;
  return id ? <label htmlFor={id} className="text-[13px] font-medium text-zinc-800">{text}</label> : <span className="text-[13px] font-medium text-zinc-800">{text}</span>;
}

/** Help text under a field, or its error: the error is announced and takes the place of the help. */
export function Help({ id, error, children }: { id: string; error?: string | null; children: React.ReactNode }) {
  return error ? <p role="alert" id={id} className={cn("text-xs", ERROR_COLOUR)}>{error}</p> : <p id={id} className="text-xs text-zinc-500">{children}</p>;
}

export const Callout = ({ children, alert }: { children: React.ReactNode; alert?: boolean }) => (
  <div role={alert ? "alert" : undefined} className="flex items-start gap-[8px] rounded-lg bg-[#fdf1d8] px-[12px] py-[10px]">
    <TriangleAlert aria-hidden className="mt-[2px] size-[16px] shrink-0 text-[#8a5a00]" />
    <p className="text-[13px] leading-[19px] text-[#8a5a00]">{children}</p>
  </div>
);

export function InfoBox({ icon, label, title, children }: { icon: React.ReactNode; label: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[4px] rounded-lg bg-[#f4f1f7] px-[14px] py-[12px]">
      <p className="flex items-center gap-[6px] text-[11px] font-semibold uppercase tracking-wide text-[#5a5368]">{icon}{label}</p>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="text-[13px] text-zinc-500">{children}</p>
    </div>
  );
}
