"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, Check, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cancelRequest, loadAccountRequestStatus, remindAdmin } from "@/app/(hrms)/employee-onboarding/actions";
import type { AccountRequestStatus, AccountRequestStep, OnboardingRow } from "@/lib/employees";
import { LIVE_EVENT } from "@/lib/live-events";
import { formatOfferDate } from "@/lib/offer-view";

const BADGE = { requested: "warning", seen: "warning", account_created: "success", login_sent: "success" } as const;
const BADGE_LABEL = { requested: "Requested", seen: "Requested", account_created: "Account created", login_sent: "Account created" } as const;
const manila = (iso: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Manila", ...options }).format(new Date(iso));
/** "12 Nov, 10:02 AM". */
export const formatStepTime = (iso: string) => `${manila(iso, { day: "numeric", month: "short" })}, ${manila(iso, { hour: "numeric", minute: "2-digit", hour12: true }).toUpperCase()}`;

const WAITING: Record<AccountRequestStep["key"], string> = {
  requested: "", seen: "Waiting for admin", account_created: "Waiting for admin", login_sent: "By email, automatically",
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
      <dt className="text-xs font-medium text-zinc-500">{label}</dt>
      <dd className="break-words text-sm text-[#1f1a2e]">{children}</dd>
    </div>
  );
}

function Steps({ steps }: { steps: AccountRequestStep[] }) {
  const current = steps.findIndex(step => !step.done);
  return (
    <ol aria-label="Progress" className="flex flex-col">
      {steps.map((step, index) => {
        const state = step.done ? "done" : index === current ? "current" : "waiting";
        return (
          <li key={step.key} data-state={state} className="flex gap-[12px]">
            <div className="flex flex-col items-center">
              <span aria-hidden className={`flex size-[24px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                state === "done" ? "border-[#16a34a] bg-[#16a34a] text-white" : state === "current" ? "border-[#5b2a86] bg-white" : "border-[#e4e4e7] bg-white"}`}>
                {state === "done" ? <Check className="size-[12px]" strokeWidth={3} /> : state === "current" ? <span className="size-[8px] rounded-full bg-[#5b2a86]" /> : null}
              </span>
              {index < steps.length - 1 && <span aria-hidden className={`h-[30px] w-[2px] ${step.done ? "bg-[#16a34a]" : "bg-[#e4e4e7]"}`} />}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-[2px] pb-[12px] pt-[2px]">
              <p className={`text-sm ${state === "waiting" ? "font-medium text-zinc-500" : "font-semibold text-[#18181b]"}`}>{step.label}</p>
              <p className="text-xs text-zinc-500">
                {step.done && step.at ? `${formatStepTime(step.at)}${step.actor ? ` · ${step.key === "requested" ? "by " : ""}${step.actor}` : ""}` : WAITING[step.key]}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Warning({ status }: { status: AccountRequestStatus }) {
  const first = status.employee.name.split(/\s+/u)[0];
  const days = status.daysSinceSeen;
  return (
    <div role="alert" className="flex items-start gap-[8px] rounded-lg bg-[#fdf6e7] px-[12px] py-[10px] text-[13px] text-[#8a5a00]">
      <Bell aria-hidden className="mt-[1px] size-[16px] shrink-0" />
      <p>
        {first} started on {formatOfferDate(status.startDate).replace(/ \d{4}$/, "")} and still has no login.
        {days !== null && ` It’s been ${days === 0 ? "less than a day" : days === 1 ? "1 day" : `${days} days`} since the request was seen.`}
      </p>
    </div>
  );
}

function Details({ status }: { status: AccountRequestStatus }) {
  return (
    <div className="flex flex-col gap-[18px]">
      <dl className="flex flex-col gap-[12px]">
        <div className="flex gap-[16px]"><Field label="Employee">{status.employee.name} · {status.employee.employeeNumber}</Field><Field label="Work email">{status.workEmail}</Field></div>
        <div className="flex gap-[16px]"><Field label="Role">{status.role}</Field><Field label="Needs access from">{formatOfferDate(status.neededFrom)}</Field></div>
        <div className="flex gap-[16px]"><Field label="Requested by">{status.requestedBy} · {formatStepTime(status.requestedAt)}</Field></div>
        <div className="flex gap-[16px]">
          <Field label="Modules requested">
            {status.modules.length === 0 ? "None" : (
              <ul className="flex flex-col gap-[4px]">
                {status.modules.map(group => <li key={group.system}><span className="font-medium">{group.system}</span>: {group.names.join(", ")}</li>)}
              </ul>
            )}
          </Field>
        </div>
      </dl>
      <p className="text-[13px] font-semibold text-[#18181b]">Progress</p>
      <Steps steps={status.steps} />
      {status.overdue && <Warning status={status} />}
    </div>
  );
}

const REMIND_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Remind and Cancel exist only while the admin has not yet created the account. */
const isOpen = (status: AccountRequestStatus) => status.status === "requested" || status.status === "seen";

/**
 * "Cancel request" (after a confirmation) and "Remind admin" at the foot of the panel. After a reminder it says when the next one is
 * allowed (24 hours later) and the button waits. Hidden once the account exists, so a live update that brings the account removes them.
 */
function Actions({ status, reload, onCancelled, onReminded, onNotice }: { status: AccountRequestStatus; reload: () => void; onCancelled: () => void; onReminded: (at: string) => void; onNotice: (message?: string) => void }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [now] = useState(() => Date.now()); // a snapshot from when the actions appear; no timer, so no polling
  const first = status.employee.name.split(/\s+/u)[0];
  const nextAt = status.lastReminderAt ? new Date(new Date(status.lastReminderAt).getTime() + REMIND_INTERVAL_MS) : null;
  const waiting = nextAt !== null && nextAt.getTime() > now;

  const remind = () => start(async () => {
    onNotice();
    const result = await remindAdmin(status.reference);
    if (result.ok) { toast.success("Reminder sent to the admin"); if (result.remindedAt) onReminded(result.remindedAt); return; }
    if (result.retryAt) onReminded(new Date(new Date(result.retryAt).getTime() - REMIND_INTERVAL_MS).toISOString());
    onNotice(result.error);
    if (result.status) reload();
  });
  const cancel = (event: React.MouseEvent) => {
    event.preventDefault(); // stay open until the server answers
    onNotice();
    start(async () => {
      const result = await cancelRequest(status.reference);
      if (result.ok) { setConfirming(false); toast.success(`Account request for ${status.employee.name} cancelled`); onCancelled(); return; }
      setConfirming(false);
      onNotice(result.error);
      reload();
    });
  };

  return (
    <div className="flex flex-col gap-[10px] border-t border-[#ebebeb] px-[24px] py-[16px]">
      {status.lastReminderAt && (
        <p className="text-xs text-zinc-500">
          Reminder sent {formatStepTime(status.lastReminderAt)}.{waiting && nextAt && ` You can remind the admin again after ${formatStepTime(nextAt.toISOString())}.`}
        </p>
      )}
      <div className="flex justify-end gap-[8px]">
        <AlertDialog open={confirming} onOpenChange={(next) => { if (!pending) setConfirming(next); }}>
          <AlertDialogTrigger asChild>
            <Button type="button" variant="outline" disabled={pending} className="rounded-lg text-destructive hover:text-destructive">Cancel request</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Cancel the account request for {status.employee.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                The admin portal will be told to withdraw {status.reference}, and {first} goes back to Not requested. You can send a new request afterwards.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Keep request</AlertDialogCancel>
              <AlertDialogAction disabled={pending} onClick={cancel}>{pending ? "Cancelling…" : "Cancel request"}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button type="button" disabled={pending || waiting} onClick={remind} className="rounded-lg">Remind admin</Button>
      </div>
    </div>
  );
}

/** "View request" on a row with an active request, opening the side panel. It reads on open and again when the live connection pushes a notification. */
export function RequestStatusPanel({ employee }: { employee: Pick<OnboardingRow, "id" | "name" | "requestReference"> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<AccountRequestStatus>();
  const [error, setError] = useState<string>();
  /** What a refused Remind or Cancel says; kept here so it survives the actions disappearing when the account turns up. */
  const [notice, setNotice] = useState<string>();
  const latest = useRef(0);

  const load = useCallback(async () => {
    const current = ++latest.current;
    const result = await loadAccountRequestStatus(employee.id);
    if (current !== latest.current) return;
    if (result.ok) { setStatus(result.status); setError(undefined); } else setError(result.error);
  }, [employee.id]);

  useEffect(() => {
    if (!open) return;
    window.addEventListener(LIVE_EVENT, load);
    return () => window.removeEventListener(LIVE_EVENT, load);
  }, [open, load]);

  const change = (next: boolean) => {
    setOpen(next);
    if (next) void load(); else { latest.current++; setStatus(undefined); setError(undefined); setNotice(undefined); }
  };

  return (
    <Sheet open={open} onOpenChange={change}>
      <SheetTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-auto rounded-lg px-[12px] py-[6px] text-[13px]">View request</Button>
      </SheetTrigger>
      <SheetContent side="right" showCloseButton={false} className="flex w-[500px] max-w-[calc(100vw-16px)] flex-col gap-0 p-0 sm:max-w-[500px]">
        <div className="flex items-center gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[20px] pt-[20px]">
          <div aria-hidden className="flex size-[40px] shrink-0 items-center justify-center rounded-[10px] bg-[#f5f2f9] text-[#5b2a86]"><UserPlus className="size-[20px]" /></div>
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <div className="flex flex-wrap items-center gap-[8px]">
              <SheetTitle className="text-[17px] font-semibold text-[#1f1a2e]">User account request</SheetTitle>
              {status && <Badge variant={BADGE[status.status as keyof typeof BADGE]}>{BADGE_LABEL[status.status as keyof typeof BADGE_LABEL]}</Badge>}
            </div>
            <SheetDescription className="text-xs text-zinc-500">{status?.reference ?? employee.requestReference} · {employee.name}</SheetDescription>
          </div>
          <SheetClose asChild><Button type="button" variant="ghost" size="icon" aria-label="Close" className="size-[28px] text-zinc-500"><X aria-hidden className="size-[18px]" /></Button></SheetClose>
        </div>
        <div className="flex-1 overflow-y-auto px-[24px] py-[20px]">
          {status ? <Details status={status} />
            : <p role={error ? "alert" : "status"} className={`text-sm ${error ? "text-destructive" : "text-zinc-500"}`}>{error ?? "Loading…"}</p>}
          {status && error && <p role="alert" className="mt-[12px] text-sm text-destructive">{error}</p>}
          {notice && <p role="alert" className="mt-[12px] text-sm text-destructive">{notice}</p>}
        </div>
        {status && isOpen(status) && (
          <Actions status={status} reload={() => void load()}
            onNotice={setNotice} onReminded={(at) => setStatus((current) => current && { ...current, lastReminderAt: at })}
            onCancelled={() => { change(false); router.refresh(); }} />
        )}
      </SheetContent>
    </Sheet>
  );
}
