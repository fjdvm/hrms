"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { BOX } from "./dialog-frame";

const pad = (n: number) => String(n).padStart(2, "0");
/** Parsed at local noon so a date never shifts with the time zone. */
const toDate = (value: string) => (value ? new Date(`${value}T12:00:00`) : undefined);
const toText = (day: Date) => `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
const TRIGGER = cn(BOX, "justify-between font-normal");

type Aria = React.AriaAttributes & { id?: string; disabled?: boolean };

/** A single date from the calendar popover, as "YYYY-MM-DD". `label` is what the closed field shows for the date. */
export function DatePicker({ value, label, placeholder, onChange, ...aria }: { value: string; label: string; placeholder: string; onChange: (value: string) => void } & Aria) {
  const [open, setOpen] = useState(false);
  const selected = toDate(value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={TRIGGER} {...aria}>
          <span className={selected ? "text-[#18181b]" : "text-[#a1a1aa]"}>{selected ? label : placeholder}</span>
          <CalendarIcon aria-hidden className="size-4 text-[#71717a]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-sm" align="start">
        <Calendar mode="single" selected={selected} defaultMonth={selected} onSelect={(day) => { if (day) { onChange(toText(day)); setOpen(false); } }} />
      </PopoverContent>
    </Popover>
  );
}

/**
 * Any start and end from one calendar popover: the first click sets the start, the second the end (in either order, and the same
 * day twice is a one-day period). This is the Custom date picker, which Figma does not draw.
 */
export function RangePicker({ start, end, label, placeholder, onChange, ...aria }: { start: string; end: string; label: string; placeholder: string; onChange: (range: { start: string; end: string }) => void } & Aria) {
  const [open, setOpen] = useState(false);
  // The day clicked first while the second click is still to come.
  const [anchor, setAnchor] = useState<string | null>(null);
  const selected: DateRange | undefined = anchor ? { from: toDate(anchor) } : start ? { from: toDate(start), to: toDate(end) } : undefined;
  const pick = (clicked: Date) => {
    const day = toText(clicked);
    if (anchor === null) { setAnchor(day); onChange({ start: "", end: "" }); return; }
    onChange(day < anchor ? { start: day, end: anchor } : { start: anchor, end: day });
    setAnchor(null);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setAnchor(null); }}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className={TRIGGER} {...aria}>
          <span className={start && end ? "text-[#18181b]" : "text-[#a1a1aa]"}>{start && end ? label : placeholder}</span>
          <CalendarIcon aria-hidden className="size-4 text-[#71717a]" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-sm" align="start">
        <Calendar mode="range" selected={selected} defaultMonth={selected?.from} onSelect={(_range, clicked) => pick(clicked)} />
      </PopoverContent>
    </Popover>
  );
}
