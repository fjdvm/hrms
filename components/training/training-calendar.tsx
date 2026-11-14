"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import type { DayHeaderContentArg, EventContentArg } from "@fullcalendar/core";
import { ChevronLeft, ChevronRight, Clock, Link2, MapPin, User, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CalendarTraining } from "@/lib/trainings";
import {
  MODE_COLOUR, shiftTrainingCalendar, trainingCalendarEvents, trainingCalendarHref, trainingCalendarNow,
  type TrainingCalendarEvent, type TrainingCalendarMode, type TrainingCalendarState,
} from "@/lib/training-calendar";
import { formatTrainingDate, formatTrainingTimes, manilaToday } from "@/lib/training-terms";
import { useOptimisticNav } from "@/hooks/use-optimistic-nav";
import { cn } from "@/lib/utils";

const VIEWS: Record<TrainingCalendarMode, string> = { week: "timeGridWeek", month: "dayGridMonth" };
const CANCELLED = "#71717a";

function Nav({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return <Link href={href} aria-label={label} className="flex size-[34px] items-center justify-center rounded-lg border bg-white text-zinc-700 hover:bg-zinc-50">{children}</Link>;
}

function EventBody({ arg }: { arg: EventContentArg }) {
  const { training } = arg.event.extendedProps as TrainingCalendarEvent["extendedProps"];
  const cancelled = training.status === "Cancelled";
  const colour = cancelled ? CANCELLED : MODE_COLOUR[training.mode];
  const Icon = training.mode === "Online" ? Video : MapPin;
  return (
    <div
      className={cn("flex h-full min-w-0 flex-col gap-[1px] overflow-hidden rounded-md border-l-[3px] px-[8px] py-[4px] text-left text-xs", cancelled && "line-through")}
      style={{ borderColor: colour, background: `color-mix(in srgb, ${colour} ${cancelled ? 10 : 16}%, white)`, color: cancelled ? "#52525b" : `color-mix(in srgb, ${colour} 70%, black)` }}
    >
      <span className="truncate font-semibold">{training.title}</span>
      <span className="flex min-w-0 items-center gap-[4px] opacity-90">
        <Icon aria-label={training.mode} className="size-3 shrink-0" />
        <span className="truncate">{formatTrainingTimes(training.startTime, training.endTime)}{cancelled && " · Cancelled"}</span>
      </span>
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

function Popover({ training, anchor, onClose }: { training: CalendarTraining; anchor: DOMRect; onClose: () => void }) {
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
  const top = Math.max(8, Math.min(anchor.top, window.innerHeight - 300));
  const line = "flex items-start gap-[10px] text-[13px] text-zinc-800 [&_svg]:mt-[2px] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-zinc-500";
  const Icon = training.mode === "Online" ? Video : MapPin;
  return (
    <div ref={ref} role="dialog" aria-label={`${training.title}, training`} style={{ left, top, width }} className="fixed z-50 flex flex-col gap-[12px] rounded-xl border bg-white p-[16px] shadow-[0_8px_24px_rgba(0,0,0,0.14)]">
      <div className="flex items-start gap-[8px]">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-semibold text-zinc-900">{training.title}</span>
          <span className="truncate text-xs text-zinc-500">Training{training.status === "Cancelled" && " · Cancelled"}</span>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="text-zinc-500 hover:text-foreground"><X className="size-4" /></button>
      </div>
      <div className="flex flex-col gap-[8px]">
        <p className={line}><Clock />{formatTrainingDate(training.date)} · {formatTrainingTimes(training.startTime, training.endTime)}</p>
        <p className={line}><Icon />{training.mode}</p>
        {training.mode === "Online"
          ? <p className={line}><Link2 /><a href={training.location} target="_blank" rel="noopener noreferrer" className="min-w-0 break-all text-primary hover:underline">{training.location.replace(/^https?:\/\//, "")}</a></p>
          : <p className={line}><MapPin /><span className="min-w-0">{training.location}</span></p>}
        <p className={line}><User />{training.trainer} (trainer) · {training.assigned} assigned</p>
      </div>
      <Button variant="outline" asChild className="h-auto rounded-lg px-[12px] py-[8px] shadow-none"><Link href="/training">Open Trainings</Link></Button>
    </div>
  );
}

/** The Training Calendar, copying the Interviews Calendar: FullCalendar for the grid, our own header, a Mode legend and a click popover. */
export function TrainingCalendar({ state, title, trainings }: { state: TrainingCalendarState; title: string; trainings: CalendarTraining[] }) {
  const [selected, setSelected] = useState<{ training: CalendarTraining; anchor: DOMRect }>();
  const events = useMemo(() => trainingCalendarEvents(trainings), [trainings]);
  const [today] = useState(() => manilaToday());
  const nav = useOptimisticNav(state.mode);
  const modes: [TrainingCalendarMode, string][] = [["week", "Week"], ["month", "Month"]];

  return (
    <div className="flex flex-col gap-[16px]">
      <div className="flex flex-wrap items-center gap-[10px]">
        <Nav href={trainingCalendarHref({ ...state, date: shiftTrainingCalendar(state, -1) })} label="Back"><ChevronLeft className="size-4" /></Nav>
        <Nav href={trainingCalendarHref({ ...state, date: shiftTrainingCalendar(state, 1) })} label="Next"><ChevronRight className="size-4" /></Nav>
        <Link href={trainingCalendarHref({ ...state, date: today })} className="rounded-lg border bg-white px-[12px] py-[7px] text-sm font-medium text-zinc-800 hover:bg-zinc-50">Today</Link>
        <h2 className="text-[17px] font-semibold text-zinc-900">{title}</h2>
        <div className="flex-1" />
        <div role="group" aria-label="Calendar view" className="flex gap-[2px] rounded-lg bg-zinc-100 p-[3px]">
          {modes.map(([mode, label]) => (
            <Link key={mode} href={trainingCalendarHref({ ...state, mode })} onClick={nav.go(mode, trainingCalendarHref({ ...state, mode }))} aria-current={nav.shown === mode ? "true" : undefined}
              className={cn("rounded-md px-[12px] py-[5px] text-sm font-medium text-zinc-500", nav.shown === mode && "bg-white text-foreground shadow-sm")}>{label}</Link>
          ))}
        </div>
      </div>
      <ul aria-label="Legend" className="flex flex-wrap items-center gap-x-[16px] gap-y-[6px] text-xs text-zinc-500">
        <li className="flex items-center gap-[6px]"><span className="size-[10px] rounded-full" style={{ background: MODE_COLOUR.Online }} /><Video className="size-3" /> Online</li>
        <li className="flex items-center gap-[6px]"><span className="size-[10px] rounded-full" style={{ background: MODE_COLOUR["In person"] }} /><MapPin className="size-3" /> In person</li>
      </ul>
      <div aria-busy={nav.pending} className={cn("hrms-calendar overflow-hidden rounded-xl border bg-white transition-opacity", nav.pending && "opacity-60")}>
        <FullCalendar
          key={`${state.mode}-${state.date}`}
          plugins={[dayGridPlugin, timeGridPlugin]}
          initialView={VIEWS[state.mode]}
          initialDate={state.date}
          headerToolbar={false}
          timeZone="UTC"
          now={trainingCalendarNow}
          allDaySlot={false}
          slotMinTime="06:00:00"
          slotMaxTime="22:00:00"
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
            setSelected({ training: (event.extendedProps as TrainingCalendarEvent["extendedProps"]).training, anchor: el.getBoundingClientRect() });
          }}
          navLinks={false}
          selectable={false}
          editable={false}
        />
      </div>
      {trainings.length === 0 && <p className="rounded-xl border bg-card px-[20px] py-[16px] text-sm text-zinc-500">No trainings in this period.</p>}
      <p className="rounded-lg bg-muted px-[12px] py-[10px] text-xs text-muted-foreground">Click a training to see its details. Cancelled trainings are struck through.</p>
      {selected && <Popover training={selected.training} anchor={selected.anchor} onClose={() => setSelected(undefined)} />}
    </div>
  );
}
