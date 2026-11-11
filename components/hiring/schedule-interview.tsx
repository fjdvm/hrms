"use client";

import { useActionState, useState } from "react";
import { CalendarDays, Link2, MapPin, Map as MapIcon, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ApplicationInterview, InterviewInput } from "@/lib/applications";
import type { Interviewer } from "@/lib/interviewers";
import { PHILIPPINE_PLACES } from "@/lib/interview-booking";
import { INTERVIEW_DAY, invitePreview, manilaParts, manilaToday, slotLabel } from "@/lib/application-view";
import { saveInterview, type ScheduleState } from "@/app/(hrms)/applicants/[id]/actions";
import { cn } from "@/lib/utils";
import { OptionGroup } from "./dialog-parts";

const BOX = "flex items-center gap-sm rounded-lg border bg-white px-[12px] py-[9px] text-sm text-zinc-900 focus-within:border-[#8b5cf6]";
const INPUT = "min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400";
const SELECT = "h-auto rounded-lg border-zinc-200 bg-white px-[12px] py-[9px] text-sm shadow-none";
const PROVINCES = Object.keys(PHILIPPINE_PLACES);

function Labelled({ label, htmlFor, required, error, hint, children }: { label: string; htmlFor?: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <label htmlFor={htmlFor} className="flex gap-[3px] text-[13px] font-medium text-zinc-800">
        {label}{required && <span className="text-red-600">*</span>}
      </label>
      {children}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** Day-picker dates are local midnight; the form carries plain YYYY-MM-DD. */
const toDate = (ymd: string) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(y, m - 1, d); };
const toYmd = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dayLabel = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Props = {
  applicationId: number;
  applicantName: string;
  jobTitle: string;
  location: string;
  label: string;
  interviewers: Interviewer[];
  /** Set to reschedule this Interview instead of booking a new one. */
  interview?: ApplicationInterview;
};

/** The Schedule interview button and its dialog: books an Interview, or reschedules the one given. Shared by the profile and the Interviews tab. */
export function ScheduleInterview({ applicationId, applicantName, jobTitle, location, label, interviewers, interview }: Props) {
  const initial = interview ? { start: manilaParts(interview.startsAt), end: manilaParts(interview.endsAt) } : undefined;
  const [open, setOpen] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [type, setType] = useState<InterviewInput["type"]>(interview?.type ?? "Online");
  const [date, setDate] = useState(initial?.start.date ?? "");
  const [start, setStart] = useState(initial?.start.time ?? "");
  const [end, setEnd] = useState(initial?.end.time ?? "");
  const [interviewerId, setInterviewerId] = useState(interview?.interviewerId ?? "");
  const [meetingLink, setMeetingLink] = useState(interview?.meetingLink ?? "");
  const [province, setProvince] = useState(interview?.province ?? "");
  const [city, setCity] = useState(interview?.city ?? "");
  const [address, setAddress] = useState(interview?.address ?? "");
  const [mapLink, setMapLink] = useState(interview?.mapLink ?? "");
  const [conflictKey, setConflictKey] = useState<string>();
  const interviewer = interviewers.find((member) => member.id === interviewerId);
  const currentKey = [date, start, end, interviewerId].join("|");

  const [state, submit, pending] = useActionState(async (previous: ScheduleState, data: FormData) => {
    const next = await saveInterview(applicationId, interview?.id, previous, data);
    if (next.scheduled) setOpen(false);
    setConflictKey(next.conflict ? currentKey : undefined);
    return next;
  }, {} as ScheduleState);

  // The conflict stays until HR changes the day, the time or the Interviewer; choosing a free slot does exactly that.
  const conflict = conflictKey === currentKey ? state.conflict : undefined;
  const errors = state.fieldErrors ?? {};
  const timeInvalid = Boolean(conflict || errors.start || errors.end);
  const today = manilaToday();
  const todayDate = toDate(today);
  const preview = invitePreview({ applicantName, jobTitle, type, date, start, end, interviewerName: interviewer?.name ?? "", meetingLink, province, city, address, mapLink });
  const border = (name: keyof typeof errors) => (errors[name] ? "border-destructive" : "border-zinc-200");
  const week = interviewer ? `/interviews?view=calendar&interviewer=${encodeURIComponent(interviewer.id)}${date ? `&date=${date}` : ""}` : undefined;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] text-sm font-medium shadow-none">{label}</Button>
      </DialogTrigger>
      <DialogContent
        showClose={false}
        overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-[580px] gap-0 overflow-y-auto rounded-2xl border-0 !p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:!p-0 md:max-w-[580px] lg:max-w-[580px]"
      >
        <form action={submit} noValidate>
          <input type="hidden" name="type" value={type} />
          <input type="hidden" name="date" value={date} />
          <input type="hidden" name="interviewerId" value={interviewerId} />
          <input type="hidden" name="interviewerName" value={interviewer?.name ?? ""} />
          <input type="hidden" name="province" value={type === "In person" ? province : ""} />
          <input type="hidden" name="city" value={type === "In person" ? city : ""} />
          <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">{interview ? "Reschedule interview" : "Schedule interview"}</DialogTitle>
              <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">{applicantName} · {jobTitle} · {location}</DialogDescription>
            </div>
            <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
          </div>
          <div className="flex flex-col gap-md px-[24px] py-[20px]">
            <div className="flex flex-col gap-[8px]">
              <p className="flex gap-[3px] text-[13px] font-medium text-zinc-800">Interview type<span className="text-red-600">*</span></p>
              <OptionGroup
                value={type}
                onChange={setType}
                options={[
                  { value: "Online", title: "Online", description: "Send a video call link", icon: <Video className="text-primary" /> },
                  { value: "In person", title: "In person", description: "Share the place and a map link", icon: <MapPin className="text-primary" /> },
                ]}
              />
            </div>
            <div className="flex gap-[12px]">
              <div className="min-w-0 flex-1">
                <Labelled label="Date" htmlFor="interview-date" required error={errors.date}>
                  <Popover open={dateOpen} onOpenChange={setDateOpen}>
                    <PopoverTrigger asChild>
                      <button type="button" id="interview-date" className={cn(BOX, border("date"), "w-full cursor-pointer text-left")}>
                        <CalendarDays className="size-4 shrink-0 text-zinc-500" />
                        <span className={cn("flex-1", !date && "text-zinc-400")}>{date ? dayLabel(date) : "Select a date"}</span>
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="start" className="w-auto p-3">
                      <Calendar
                        mode="single"
                        selected={date ? toDate(date) : undefined}
                        onSelect={(picked) => { if (picked) { setDate(toYmd(picked)); setDateOpen(false); } }}
                        defaultMonth={date ? toDate(date) : todayDate}
                        startMonth={todayDate}
                        disabled={[{ before: todayDate }, { dayOfWeek: [0, 6] }]}
                      />
                    </PopoverContent>
                  </Popover>
                </Labelled>
              </div>
              <div className="min-w-0 flex-1">
                <Labelled label="Time" htmlFor="interview-start" required error={errors.start ?? errors.end} hint="Interviews run 8 AM to 5 PM, Monday to Friday.">
                  <div className={cn(BOX, timeInvalid ? "border-destructive" : "border-zinc-200")}>
                    <input id="interview-start" name="start" value={start} onChange={(event) => setStart(event.target.value)} type="time" min={INTERVIEW_DAY.opens} max={INTERVIEW_DAY.closes} aria-label="Start time" aria-invalid={timeInvalid} className={INPUT} />
                    <span className="text-zinc-400">–</span>
                    <input name="end" value={end} onChange={(event) => setEnd(event.target.value)} type="time" min={INTERVIEW_DAY.opens} max={INTERVIEW_DAY.closes} aria-label="End time" aria-invalid={timeInvalid} className={INPUT} />
                  </div>
                </Labelled>
              </div>
            </div>
            {conflict && (
              <div role="alert" className="flex flex-col gap-[8px] rounded-lg border border-destructive/40 bg-red-50 px-[12px] py-[10px]">
                <p className="text-xs font-medium text-destructive">{conflict.message}</p>
                {conflict.freeSlots.length > 0 && (
                  <>
                    <p className="text-xs text-zinc-600">Free times for {interviewer?.name ?? "this Interviewer"}:</p>
                    <div className="flex flex-wrap gap-[6px]">
                      {conflict.freeSlots.map((slot) => (
                        <button
                          key={slot.startsAt}
                          type="button"
                          onClick={() => { const [from, to] = [manilaParts(slot.startsAt), manilaParts(slot.endsAt)]; setDate(from.date); setStart(from.time); setEnd(to.time); }}
                          className="cursor-pointer rounded-md border border-[#e6e1ee] bg-white px-[10px] py-[5px] text-xs font-medium text-primary hover:bg-[#efe6f8]"
                        >
                          {slotLabel(slot.startsAt, slot.endsAt)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {week && <a href={week} target="_blank" rel="noreferrer" className="text-xs font-medium text-primary underline">See {interviewer?.name}&rsquo;s week</a>}
              </div>
            )}
            <Labelled label="Interviewer" htmlFor="interview-interviewer" required error={errors.interviewer ?? (interviewers.length === 0 ? "No Staff with Recruitment and Hiring could be loaded. Try again in a moment." : undefined)}>
              <Select value={interviewerId} onValueChange={setInterviewerId} disabled={interviewers.length === 0}>
                <SelectTrigger id="interview-interviewer" className={cn(SELECT, border("interviewer"))}><SelectValue placeholder="Choose an interviewer" /></SelectTrigger>
                <SelectContent className="z-[100000]">
                  {interviewers.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      <span className="inline-flex items-center gap-[8px]"><span aria-hidden className="size-[8px] rounded-full" style={{ backgroundColor: member.colour }} />{member.name}</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Labelled>
            {type === "Online" ? (
              <Labelled label="Meeting link" htmlFor="interview-link" required error={errors.meetingLink} hint="Paste a Google Meet or Zoom link.">
                <div className={cn(BOX, border("meetingLink"))}>
                  <Link2 className="size-4 text-zinc-500" />
                  <input id="interview-link" name="meetingLink" value={meetingLink} onChange={(event) => setMeetingLink(event.target.value)} placeholder="https://meet.google.com/…" className={cn(INPUT, "text-primary")} />
                </div>
              </Labelled>
            ) : (
              <>
                <div className="flex gap-[12px]">
                  <div className="min-w-0 flex-1">
                    <Labelled label="Province" htmlFor="interview-province" required error={errors.province}>
                      <Select value={province} onValueChange={(next) => { setProvince(next); setCity(""); }}>
                        <SelectTrigger id="interview-province" className={cn(SELECT, border("province"))}><SelectValue placeholder="Choose a province" /></SelectTrigger>
                        <SelectContent className="z-[100000] max-h-[280px]">
                          {PROVINCES.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Labelled>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Labelled label="City or municipality" htmlFor="interview-city" required error={errors.city}>
                      <Select value={city} onValueChange={setCity} disabled={!province}>
                        <SelectTrigger id="interview-city" className={cn(SELECT, border("city"))}><SelectValue placeholder={province ? "Choose a city or municipality" : "Choose a province first"} /></SelectTrigger>
                        <SelectContent className="z-[100000] max-h-[280px]">
                          {(PHILIPPINE_PLACES[province] ?? []).map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </Labelled>
                  </div>
                </div>
                <Labelled label="Address" htmlFor="interview-address" required error={errors.address} hint="Street, building and barangay.">
                  <div className={cn(BOX, border("address"))}>
                    <MapPin className="size-4 text-zinc-500" />
                    <input id="interview-address" name="address" value={address} onChange={(event) => setAddress(event.target.value)} placeholder="e.g. 12 Rizal Ave, Brgy. San Roque" className={INPUT} />
                  </div>
                </Labelled>
                <Labelled label="Map link" htmlFor="interview-map" error={errors.mapLink} hint="Optional. Paste a link if they should find the place on a map.">
                  <div className={cn(BOX, border("mapLink"))}>
                    <MapIcon className="size-4 text-zinc-500" />
                    <input id="interview-map" name="mapLink" value={mapLink} onChange={(event) => setMapLink(event.target.value)} placeholder="https://maps.app.goo.gl/…" className={cn(INPUT, "text-primary")} />
                  </div>
                </Labelled>
              </>
            )}
            <div className="flex flex-col gap-[6px]">
              <p className="text-[13px] font-medium text-zinc-800">Invite email</p>
              <div role="note" aria-label="Invite email preview" className="flex flex-col gap-[6px] rounded-lg border border-[#ebebeb] bg-zinc-50 px-[14px] py-[12px] text-xs text-zinc-700 select-text">
                <p className="font-semibold text-zinc-900">{preview.subject}</p>
                {preview.lines.map((line) => <p key={line} className="whitespace-pre-line">{line}</p>)}
              </div>
              <p className="text-xs text-zinc-500">This wording is fixed and sent as soon as you save.</p>
            </div>
            {state.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
          </div>
          <div className="flex items-center gap-sm border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
            <p className="flex-1 text-xs text-zinc-500">{conflict ? "Choose a free time to continue." : "The stage stays at Interview."}</p>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] text-sm font-medium shadow-none">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={pending || Boolean(conflict) || interviewers.length === 0} className="h-auto rounded-lg px-[16px] py-[9px] text-sm font-medium shadow-none">{pending ? "Saving…" : interview ? "Reschedule & send invite" : "Schedule & send invite"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
