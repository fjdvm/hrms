"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, Calendar as CalendarIcon, Clock, Link2, Mail, Map as MapIcon, MapPin, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveInterview } from "@/app/(hrms)/applicants/[id]/actions";
import type { ApplicationInterview, ApplicationStage } from "@/lib/applications";
import type { Interviewer } from "@/lib/interviewers";
import { PHILIPPINE_PLACES, type FreeInterviewSlot, type InterviewConflict } from "@/lib/interview-booking";

import {
  dateToDay, dayToDate, formatDay, formatTimeRange, interviewFormErrors, interviewInputFrom, invitePreview, manilaParts, manilaToday,
  slotLabel, unbookableDays, type InterviewField, type InterviewFormValues,
} from "@/lib/interview-form";
import { cn } from "@/lib/utils";
import { OptionGroup } from "./dialog-parts";

const BOX = "flex w-full items-center gap-[8px] rounded-lg border bg-white px-[12px] py-[9px] text-left text-sm text-zinc-900 focus-within:border-[#8b5cf6]";
const INPUT = "min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400";
const PROVINCES = Object.keys(PHILIPPINE_PLACES);

function Labelled({ label, htmlFor, required, error, hint, children }: { label: string; htmlFor?: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <label htmlFor={htmlFor} className="flex gap-[3px] text-[13px] font-medium text-zinc-800">{label}{required && <span className="text-red-600">*</span>}</label>
      {children}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

type Conflict = { message: string; conflicts: InterviewConflict[]; freeSlots: FreeInterviewSlot[] };

function initialValues(interview: ApplicationInterview | undefined): InterviewFormValues {
  const start = interview && manilaParts(interview.startsAt), end = interview && manilaParts(interview.endsAt);
  return {
    type: interview?.type ?? "Online", date: start?.date ?? "", start: start?.time ?? "", end: end?.time ?? "", interviewerId: interview?.interviewerId ?? "",
    meetingLink: interview?.meetingLink ?? "", province: interview?.province ?? "", city: interview?.city ?? "", address: interview?.address ?? "", mapLink: interview?.mapLink ?? "",
  };
}

function ScheduleForm({ applicationId, stage, interview, applicantName, applicantEmail, jobTitle, location, interviewers, today, onSaved }: Omit<Props, "label"> & { today: string; onSaved: () => void }) {
  const [form, setForm] = useState(() => initialValues(interview));
  const [shown, setShown] = useState(false);
  const [conflict, setConflict] = useState<Conflict>();
  const [failure, setFailure] = useState<string>();
  const [pickingDate, setPickingDate] = useState(false);
  const [pending, start] = useTransition();
  const errors = shown ? interviewFormErrors(form) : {};
  const interviewer = interviewers.find((item) => item.id === form.interviewerId);
  const preview = invitePreview(form, applicantName, jobTitle, interviewer?.name ?? "");
  const hasConflict = conflict !== undefined;

  // Any change to when or with whom frees the Schedule button again; the server rechecks on save.
  const change = (patch: Partial<InterviewFormValues>) => {
    setForm((current) => ({ ...current, ...patch }));
    if ("date" in patch || "start" in patch || "end" in patch || "interviewerId" in patch) setConflict(undefined);
    setFailure(undefined);
  };
  const border = (field: InterviewField) => (errors[field] ? "border-destructive" : "border-zinc-200");
  const timeError = errors.start ?? errors.end;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setShown(true);
    if (Object.keys(interviewFormErrors(form)).length > 0 || !interviewer || hasConflict) return;
    start(async () => {
      const result = await saveInterview(applicationId, stage, interview?.id, interviewInputFrom(form, interviewer.name));
      if (result.saved) return onSaved();
      if (result.conflicts?.length) setConflict({ message: result.error, conflicts: result.conflicts, freeSlots: result.freeSlots ?? [] });
      else setFailure(result.error);
    });
  };
  const pickSlot = (slot: FreeInterviewSlot) => {
    const [from, to] = [manilaParts(slot.startsAt), manilaParts(slot.endsAt)];
    setForm((current) => ({ ...current, date: from.date, start: from.time, end: to.time }));
    setConflict(undefined);
    setFailure(undefined);
  };
  const week = `/interviews?view=calendar&interviewer=${encodeURIComponent(form.interviewerId)}&date=${form.date}`;
  const firstName = (interviewer?.name ?? "").split(" ")[0] || "The Interviewer";
  const cities = form.province ? PHILIPPINE_PLACES[form.province] ?? [] : [];

  return (
    <form onSubmit={submit} noValidate>
      <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
        <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
          <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">{interview ? "Reschedule interview" : "Schedule interview"}</DialogTitle>
          <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">{applicantName} · {jobTitle} · {location}</DialogDescription>
        </div>
        <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
      </div>
      <div className="flex flex-col gap-[16px] px-[24px] py-[20px]">
        <div className="flex flex-col gap-[8px]">
          <p className="flex gap-[3px] text-[13px] font-medium text-zinc-800">Interview type<span className="text-red-600">*</span></p>
          <OptionGroup
            value={form.type}
            onChange={(type) => change({ type })}
            options={[
              { value: "Online", title: "Online", description: "Send a video call link", icon: <Video className="text-primary" /> },
              { value: "In person", title: "In person", description: "Share the place and a map link", icon: <MapPin className="text-primary" /> },
            ]}
          />
        </div>
        <div className="flex gap-[12px]">
          <div className="min-w-0 flex-1">
            <Labelled label="Date" required error={errors.date}>
              <Popover open={pickingDate} onOpenChange={setPickingDate}>
                <PopoverTrigger className={cn(BOX, border("date"))} aria-label={`Date${form.date ? `, ${formatDay(form.date)}` : ""}`}>
                  <span className={cn("flex-1", !form.date && "text-zinc-400")}>{form.date ? formatDay(form.date) : "Choose a date"}</span>
                  <CalendarIcon className="size-4 text-zinc-500" />
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-3">
                  <Calendar
                    mode="single"
                    selected={form.date ? dayToDate(form.date) : undefined}
                    onSelect={(picked) => { if (picked) { change({ date: dateToDay(picked) }); setPickingDate(false); } }}
                    defaultMonth={dayToDate(form.date || today)}
                    disabled={unbookableDays(today)}
                    startMonth={dayToDate(today)}
                  />
                </PopoverContent>
              </Popover>
            </Labelled>
          </div>
          <div className="min-w-0 flex-1">
            <Labelled label="Time" htmlFor="interview-start" required error={timeError}>
              <div className={cn(BOX, hasConflict || timeError ? "border-[1.5px] border-[#dc2626]" : "border-zinc-200")}>
                <input id="interview-start" type="time" aria-label="Start time" value={form.start} onChange={(event) => change({ start: event.target.value })} className={INPUT} />
                <span className="text-zinc-400">–</span>
                <input type="time" aria-label="End time" value={form.end} onChange={(event) => change({ end: event.target.value })} className={INPUT} />
                <Clock className="size-4 shrink-0 text-zinc-500" />
              </div>
            </Labelled>
            {form.start && form.end && !timeError && <span className="sr-only">{formatTimeRange(form.start, form.end)}</span>}
          </div>
        </div>
        <Labelled label="Interviewer" required error={errors.interviewerId}>
          <Select value={form.interviewerId} onValueChange={(interviewerId) => change({ interviewerId })}>
            <SelectTrigger aria-label="Interviewer" className={cn("h-auto rounded-lg bg-white px-[12px] py-[9px] shadow-none", border("interviewerId"))}><SelectValue placeholder="Choose from Staff" /></SelectTrigger>
            <SelectContent>{interviewers.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent>
          </Select>
        </Labelled>
        {conflict && (
          <div role="alert" className="flex flex-col gap-[10px] rounded-[10px] bg-[#fdecea] px-[14px] pb-[14px] pt-[12px]">
            <p className="flex items-start gap-[8px] text-[13px] font-medium text-[#b91c1c]">
              <AlertCircle className="mt-px size-4 shrink-0" />
              <span>{conflict.message}{conflict.freeSlots.length > 0 && " Pick a free time:"}</span>
            </p>
            {conflict.freeSlots.length > 0 && (
              <div className="flex flex-wrap gap-[8px]">
                {conflict.freeSlots.map((slot) => (
                  <button key={slot.startsAt} type="button" onClick={() => pickSlot(slot)} className="flex cursor-pointer items-center gap-[6px] rounded-full border border-zinc-200 bg-white py-[6px] pl-[10px] pr-[12px] text-[13px] font-medium text-[#5b2a86]">
                    <Clock className="size-[13px]" />{slotLabel(slot, today)}
                  </button>
                ))}
              </div>
            )}
            <Link href={week} className="text-[13px] font-medium text-[#5b2a86]">See {firstName}’s week in Calendar →</Link>
          </div>
        )}
        {form.type === "Online" ? (
          <Labelled label="Meeting link" htmlFor="interview-link" required error={errors.meetingLink} hint="Paste a Google Meet or Zoom link. It goes in the invite email.">
            <div className={cn(BOX, border("meetingLink"))}>
              <Link2 className="size-4 text-zinc-500" />
              <input id="interview-link" value={form.meetingLink} onChange={(event) => change({ meetingLink: event.target.value })} placeholder="https://meet.google.com/…" className={cn(INPUT, "text-primary")} />
            </div>
          </Labelled>
        ) : (
          <>
            <div className="flex gap-[12px]">
              <div className="min-w-0 flex-1">
                <Labelled label="Province" required error={errors.province}>
                  <Select value={form.province} onValueChange={(province) => change({ province, city: "" })}>
                    <SelectTrigger aria-label="Province" className={cn("h-auto rounded-lg bg-white px-[12px] py-[9px] shadow-none", border("province"))}><SelectValue placeholder="Choose a province" /></SelectTrigger>
                    <SelectContent>{PROVINCES.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                  </Select>
                </Labelled>
              </div>
              <div className="min-w-0 flex-1">
                <Labelled label="City or municipality" required error={errors.city}>
                  <Select value={form.city} onValueChange={(city) => change({ city })} disabled={!form.province}>
                    <SelectTrigger aria-label="City or municipality" className={cn("h-auto rounded-lg bg-white px-[12px] py-[9px] shadow-none", border("city"))}><SelectValue placeholder={form.province ? "Choose a city" : "Choose a province first"} /></SelectTrigger>
                    <SelectContent>{cities.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}</SelectContent>
                  </Select>
                </Labelled>
              </div>
            </div>
            <Labelled label="Address" htmlFor="interview-address" required error={errors.address}>
              <div className={cn(BOX, border("address"))}>
                <MapPin className="size-4 text-zinc-500" />
                <input id="interview-address" value={form.address} onChange={(event) => change({ address: event.target.value })} placeholder="Street, building, barangay" className={INPUT} />
              </div>
            </Labelled>
            <Labelled label="Map link" htmlFor="interview-map" error={errors.mapLink} hint="Optional. Paste a link if they should find the place on a map.">
              <div className={cn(BOX, border("mapLink"))}>
                <MapIcon className="size-4 text-zinc-500" />
                <input id="interview-map" value={form.mapLink} onChange={(event) => change({ mapLink: event.target.value })} placeholder="https://maps.app.goo.gl/…" className={cn(INPUT, "text-primary")} />
              </div>
            </Labelled>
          </>
        )}
        <div className="flex flex-col gap-[2px]">
          <p className="text-sm font-medium text-zinc-900">Email the invite to {applicantName.split(" ")[0]}</p>
          <p className="text-xs text-zinc-500">{hasConflict ? "Sent once you pick a free time." : `Sent right away to ${applicantEmail}.`}</p>
        </div>
        <div aria-label="Invite email preview" className="flex flex-col gap-[6px] rounded-lg bg-[#f7f5fa] px-[14px] py-[12px]">
          <p className="flex items-center gap-[6px] text-[11px] font-semibold uppercase text-[#6e6680]"><Mail className="size-[14px]" />Email preview</p>
          <p className="text-[13px] font-semibold text-[#1f1a2e]">{preview.subject}</p>
          <p className="text-[13px] leading-[19px] text-[#6e6680]">{preview.body}</p>
        </div>
        {failure && <p role="alert" className="text-xs text-destructive">{failure}</p>}
      </div>
      <div className="flex items-center gap-sm border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
        <p className={cn("flex-1 text-xs", hasConflict ? "text-[#b91c1c]" : "text-zinc-500")}>{hasConflict ? "Pick a free time to continue." : interview ? "The Applicant is sent the new time." : "The invite is sent when you schedule."}</p>
        <DialogClose asChild><Button type="button" variant="outline" className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] text-sm font-medium shadow-none">Cancel</Button></DialogClose>
        <Button type="submit" disabled={pending || hasConflict} className="h-auto rounded-lg px-[16px] py-[9px] text-sm font-medium shadow-none">{pending ? "Scheduling…" : "Schedule & send invite"}</Button>
      </div>
    </form>
  );
}

type Props = {
  applicationId: number; stage: ApplicationStage; applicantName: string; applicantEmail: string; jobTitle: string; location: string;
  interviewers: Interviewer[]; label: string;
  /** Set to reschedule that Interview instead of booking a new one. */
  interview?: ApplicationInterview;
  /** "YYYY-MM-DD" in Manila; defaults to today. Tests pin it. */
  today?: string;
  /** The filled button with a calendar icon the Interviews list uses, instead of the outlined profile one. */
  compact?: boolean;
};

/** The one Schedule interview dialog: books an Interview, or reschedules `interview`. Used on the Application profile and the Interviews tab. */
export function ScheduleInterview({ label, today, compact, ...props }: Props) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {compact
          ? <Button className="h-auto gap-[6px] rounded-lg px-[12px] py-[6px] text-[13px] font-medium shadow-none [&_svg]:size-[14px]"><CalendarIcon /> {label}</Button>
          : <Button variant="outline" className="h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] text-sm font-medium shadow-none">{label}</Button>}
      </DialogTrigger>
      <DialogContent
        showClose={false}
        overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-[580px] gap-0 overflow-y-auto rounded-2xl border-0 !p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:!p-0 md:max-w-[580px] lg:max-w-[580px]"
      >
        <ScheduleForm {...props} today={today ?? manilaToday()} onSaved={() => { setOpen(false); router.refresh(); }} />
      </DialogContent>
    </Dialog>
  );
}
