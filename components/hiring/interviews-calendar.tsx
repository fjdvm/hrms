"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { DayHeaderContentArg, EventContentArg } from "@fullcalendar/core";
import { AlertTriangle, ChevronLeft, ChevronRight, Clock, Link2, MapPin, User, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RecordResultDialog, useStarted } from "@/components/hiring/interview-result";
import { ScheduleInterview } from "@/components/hiring/schedule-interview";
import type { ApplicationInterview, CalendarConflict, CalendarInterview } from "@/lib/applications";
import {
  calendarEvents, calendarHref, calendarNow, conflictMessage, interviewRange, interviewTime, shiftCalendar,
  type CalendarEvent, type CalendarMode, type CalendarState,
} from "@/lib/calendar-view";
import type { Interviewer } from "@/lib/interviewers";
import { manilaToday } from "@/lib/interview-form";
import { cn } from "@/lib/utils";

const VIEWS: Record<CalendarMode, string> = { day: "timeGridDay", week: "timeGridWeek", month: "dayGridMonth" };
const EVERYONE = "everyone";
const ALL_JOBS = "all";
const DAY = new Intl.DateTimeFormat("en-PH", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Manila" });
const FINISHED = "#71717a";

export type CalendarJob = { id: string; title: string };

const rescheduleTarget = (i: CalendarInterview): ApplicationInterview => ({
  id: i.id, startsAt: i.startsAt, endsAt: i.endsAt, type: i.type, interviewerName: i.interviewerName, location: i.location,
  interviewerId: i.interviewerId, meetingLink: i.meetingLink, mapLink: i.mapLink, province: i.province, city: i.city, address: i.address,
  privateNotes: null, score: null, result: null, resultEmailAt: null,
});

function Eyebrow({ href, children, label }: { href: string; children: React.ReactNode; label: string }) {
  return <Link href={href} aria-label={label} className="flex size-[34px] items-center justify-center rounded-lg border bg-white text-zinc-700 hover:bg-zinc-50">{children}</Link>;
}

function EventBody({ arg }: { arg: EventContentArg }) {
  const { interview, conflicted } = arg.event.extendedProps as CalendarEvent["extendedProps"];
  const finished = interview.status !== "Scheduled";
  const colour = finished ? FINISHED : interview.colour;
  const Icon = interview.type === "Online" ? Video : MapPin;
  const month = arg.view.type === "dayGridMonth";
  return (
    <div
      className={cn("flex h-full min-w-0 flex-col gap-[1px] overflow-hidden rounded-md border-l-[3px] px-[8px] py-[4px] text-left text-xs", conflicted && "outline-dashed outline-[1.5px] outline-red-600")}
      style={{ borderColor: colour, background: `color-mix(in srgb, ${colour} ${finished ? 10 : 16}%, white)`, color: finished ? "#52525b" : `color-mix(in srgb, ${colour} 70%, black)` }}
    >
      <span className="flex min-w-0 items-center gap-[4px] font-semibold">
        {conflicted && <AlertTriangle aria-label="Double-booked" className="size-3 shrink-0 text-red-600" />}
        <span className="truncate">{interview.applicantName}</span>
      </span>
      <span className="flex min-w-0 items-center gap-[4px] opacity-90">
        <Icon aria-label={interview.type} className="size-3 shrink-0" />
        <span className="truncate">{interviewTime(interview.startsAt)}{finished && ` · ${interview.status}`}</span>
      </span>
      {!month && !finished && <span className="truncate opacity-80">{interview.jobPostingTitle}</span>}
    </div>
  );
}

function DayHeader({ arg }: { arg: DayHeaderContentArg }) {
  if (arg.view.type === "dayGridMonth") return <span>{arg.text}</span>;
  const weekday = arg.date.toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
  return (
    <span className="flex flex-col items-center gap-[4px] py-[8px]">
      <span className="text-[11px] font-medium text-zinc-500">{weekday}</span>
      <span className={cn("flex size-[28px] items-center justify-center rounded-full text-sm font-semibold", arg.isToday ? "bg-primary text-primary-foreground" : "text-zinc-900")}>{arg.date.getUTCDate()}</span>
    </span>
  );
}

function Popup({ interview, anchor, onClose, onReschedule, onRecord }: { interview: CalendarInterview; anchor: DOMRect; onClose: () => void; onReschedule: () => void; onRecord: () => void }) {
  const started = useStarted(interview.startsAt);
  const finished = interview.status !== "Scheduled";
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const away = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", escape); };
  }, [onClose]);
  const width = 300;
  const left = Math.max(8, Math.min(anchor.right + 8 > window.innerWidth - width - 8 ? anchor.left - width - 8 : anchor.right + 8, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 340));
  const line = "flex items-start gap-[10px] text-[13px] text-zinc-800 [&_svg]:mt-[2px] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-zinc-500";
  const TypeIcon = interview.type === "Online" ? Video : MapPin;
  return (
    <div ref={ref} role="dialog" aria-label={`${interview.applicantName}, interview`} style={{ left, top, width }} className="fixed z-50 flex flex-col gap-[12px] rounded-xl border bg-white p-[16px] shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
      <div className="flex items-start gap-[8px]">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold text-zinc-900">{interview.applicantName}</span>
          <span className="truncate text-xs text-zinc-500">{interview.jobPostingTitle} · interview</span>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="text-zinc-500 hover:text-foreground"><X className="size-4" /></button>
      </div>
      <div className="flex flex-col gap-[8px]">
        <p className={line}><Clock />{DAY.format(interview.startsAt)} · {interviewRange(interview.startsAt, interview.endsAt)}</p>
        <p className={line}><TypeIcon />{interview.type}{finished && ` · ${interview.status}`}</p>
        {interview.type === "Online" && interview.meetingLink && (
          <p className={line}><Link2 /><a href={interview.meetingLink} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all text-primary hover:underline">{interview.meetingLink.replace(/^https?:\/\//, "")}</a></p>
        )}
        {interview.type === "In person" && (
          <p className={line}><MapPin /><span className="min-w-0">{interview.place}
            {interview.mapLink && <> · <a href={interview.mapLink} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">View map</a></>}</span></p>
        )}
        <p className={line}><User />{interview.interviewerName} (interviewer)</p>
      </div>
      <div className="flex flex-col gap-[8px]">
        <div className="flex gap-[8px]">
          <Button variant="outline" asChild className="h-auto flex-1 rounded-lg px-[12px] py-[8px] shadow-none"><Link href={`/applicants/${interview.applicationId}`}>Open profile</Link></Button>
          {!finished && <Button type="button" variant="outline" onClick={onReschedule} className="h-auto flex-1 rounded-lg px-[12px] py-[8px] shadow-none">Reschedule</Button>}
        </div>
        {!finished && (
          <Button type="button" disabled={!started} onClick={onRecord} title={started ? undefined : "You can record the result once the interview starts."} className="h-auto rounded-lg px-[12px] py-[8px] shadow-none">Record result</Button>
        )}
      </div>
    </div>
  );
}

/** The Interviews Calendar: FullCalendar for the grid, our own header, filters, double-booking banners and Interview pop-up. */
export function InterviewsCalendar({ state, title, interviews, conflicts, interviewers, jobs }: { state: CalendarState; title: string; interviews: CalendarInterview[]; conflicts: CalendarConflict[]; interviewers: Interviewer[]; jobs: CalendarJob[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<{ interview: CalendarInterview; anchor: DOMRect }>();
  const [rescheduling, setRescheduling] = useState<CalendarInterview>();
  const [recording, setRecording] = useState<CalendarInterview>();
  const events = useMemo(() => calendarEvents(interviews, conflicts), [interviews, conflicts]);
  const [today] = useState(() => manilaToday());
  const go = (patch: Partial<CalendarState>) => router.push(calendarHref({ ...state, ...patch }));
  const modes: [CalendarMode, string][] = [["day", "Day"], ["week", "Week"], ["month", "Month"]];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <Eyebrow href={calendarHref({ ...state, date: shiftCalendar(state, -1) })} label="Back"><ChevronLeft className="size-4" /></Eyebrow>
        <Eyebrow href={calendarHref({ ...state, date: shiftCalendar(state, 1) })} label="Next"><ChevronRight className="size-4" /></Eyebrow>
        <Link href={calendarHref({ ...state, date: today })} className="rounded-lg border bg-white px-[12px] py-[7px] text-sm font-medium text-zinc-800 hover:bg-zinc-50">Today</Link>
        <h2 className="text-[17px] font-semibold text-zinc-900">{title}</h2>
        <div className="flex-1" />
        <div role="group" aria-label="Calendar view" className="flex gap-[2px] rounded-lg bg-zinc-100 p-[3px]">
          {modes.map(([mode, label]) => (
            <Link key={mode} href={calendarHref({ ...state, mode })} aria-current={state.mode === mode ? "true" : undefined}
              className={cn("rounded-md px-[12px] py-[5px] text-sm font-medium text-zinc-500", state.mode === mode && "bg-white text-foreground shadow-sm")}>{label}</Link>
          ))}
        </div>
        <Select value={state.interviewerId ?? EVERYONE} onValueChange={(value) => go({ interviewerId: value === EVERYONE ? undefined : value })}>
          <SelectTrigger aria-label="Interviewer" className="h-auto w-auto gap-[8px] rounded-lg bg-white px-[12px] py-[8px] shadow-none"><span className="text-zinc-500">Interviewer:</span><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={EVERYONE}>Everyone</SelectItem>{interviewers.map((person) => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={state.jobPostingId ?? ALL_JOBS} onValueChange={(value) => go({ jobPostingId: value === ALL_JOBS ? undefined : value })}>
          <SelectTrigger aria-label="Job Posting" className="h-auto w-auto gap-[8px] rounded-lg bg-white px-[12px] py-[8px] shadow-none"><span className="text-zinc-500">Job:</span><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value={ALL_JOBS}>All posted jobs</SelectItem>{jobs.map((job) => <SelectItem key={job.id} value={job.id}>{job.title}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-[16px] gap-y-[6px] text-xs text-zinc-500">
        {interviewers.map((person) => <li key={person.id} className="flex items-center gap-[6px]"><span className="size-[10px] rounded-full" style={{ background: person.colour }} />{person.name}</li>)}
        <li className="flex items-center gap-[6px]"><Video className="size-3" /> Online</li>
        <li className="flex items-center gap-[6px]"><MapPin className="size-3" /> In person</li>
      </ul>
      {conflicts.map((conflict) => {
        const target = interviews.find((i) => i.id === conflict.second.interviewId) ?? interviews.find((i) => i.id === conflict.first.interviewId);
        const name = target?.applicantName.split(" ")[0];
        return (
          <div key={`${conflict.first.interviewId}-${conflict.second.interviewId}`} role="alert" className="flex flex-wrap items-center gap-[12px] rounded-xl bg-red-50 px-[16px] py-[12px] text-sm text-red-700">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{conflictMessage(conflict)}</span>
            {target && <Button type="button" variant="outline" onClick={() => setRescheduling(target)} className="h-auto rounded-lg bg-white px-[12px] py-[6px] text-[13px] font-medium text-zinc-900 shadow-none">Reschedule {name}</Button>}
          </div>
        );
      })}
      <div className="hrms-calendar overflow-hidden rounded-xl border bg-white">
        <FullCalendar
          key={`${state.mode}-${state.date}`}
          plugins={[dayGridPlugin, timeGridPlugin]}
          initialView={VIEWS[state.mode]}
          initialDate={state.date}
          headerToolbar={false}
          timeZone="UTC"
          now={calendarNow}
          hiddenDays={[0, 6]}
          allDaySlot={false}
          slotMinTime="08:00:00"
          slotMaxTime="17:00:00"
          slotDuration="00:30:00"
          slotLabelInterval="01:00"
          slotLabelFormat={{ hour: "numeric", hour12: true, omitZeroMinute: true, meridiem: "short" }}
          expandRows
          height="auto"
          firstDay={1}
          fixedWeekCount={false}
          dayMaxEvents={3}
          displayEventTime={false}
          events={events}
          eventContent={(arg) => <EventBody arg={arg} />}
          dayHeaderContent={(arg) => <DayHeader arg={arg} />}
          eventClick={({ event, el, jsEvent }) => {
            jsEvent.preventDefault();
            setSelected({ interview: (event.extendedProps as CalendarEvent["extendedProps"]).interview, anchor: el.getBoundingClientRect() });
          }}
          navLinks={false}
          selectable={false}
          editable={false}
        />
      </div>
      <p className="rounded-lg bg-muted px-[12px] py-[10px] text-xs text-muted-foreground">Click an interview to see its details. Dashed red outlines mean the interviewer is double-booked.</p>
      {selected && !rescheduling && !recording && (
        <Popup interview={selected.interview} anchor={selected.anchor} onClose={() => setSelected(undefined)}
          onReschedule={() => setRescheduling(selected.interview)} onRecord={() => setRecording(selected.interview)} />
      )}
      {rescheduling && (
        <ScheduleInterview
          label="Reschedule" stage="Interview" applicationId={rescheduling.applicationId} applicantName={rescheduling.applicantName}
          applicantEmail={rescheduling.applicantEmail} jobTitle={rescheduling.jobPostingTitle} location={rescheduling.jobLocation}
          interviewers={interviewers} interview={rescheduleTarget(rescheduling)}
          controlled={{ open: true, onOpenChange: (open) => { if (!open) { setRescheduling(undefined); setSelected(undefined); } } }}
        />
      )}
      {recording && (
        <RecordResultDialog
          applicationId={recording.applicationId} interviewId={recording.id} applicantName={recording.applicantName}
          subtitle={`${recording.applicantName} · ${recording.jobPostingTitle} · ${DAY.format(recording.startsAt)}, ${recording.type.toLowerCase()} with ${recording.interviewerName}`}
          onClose={() => { setRecording(undefined); setSelected(undefined); }}
        />
      )}
    </div>
  );
}
