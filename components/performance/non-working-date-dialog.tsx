"use client";

import { useState, useTransition } from "react";
import { Info, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { addNonWorkingDate, editNonWorkingDate } from "@/app/(hrms)/performance/actions";
import { cleanText, hasControlCharacters, nameProblem } from "@/lib/validators/text";
import { dateLabel, periodsHolding } from "@/lib/performance-period-form";
import { periodMessage } from "@/lib/performance-period-messages";
import { CALENDAR_TYPES, NAME_MAX_LENGTH, NOTES_MAX_LENGTH, type CalendarEntry, type CalendarType, type Period } from "@/lib/performance-periods";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-pickers";
import { BOX, Callout, DialogActions, DialogBody, DialogFrame, FieldLabel, Help, InfoBox, PILL, PILL_ON } from "./dialog-frame";

const TYPE_HELP: Record<CalendarType, string> = {
  Holiday: "A public or company holiday.",
  Closure: "A closure is a day the company is shut that is not a public holiday.",
  Other: "Any other day nobody is scheduled to work.",
};

/** Why a name is refused, or null when it is fine. Blank is refused here as the server does. */
export function nameError(raw: string): string | null {
  if (hasControlCharacters(raw)) return periodMessage("name-characters");
  const problem = nameProblem(cleanText(raw), NAME_MAX_LENGTH);
  return problem === "empty" ? periodMessage("name-empty") : problem === "too-long" ? periodMessage("name-too-long") : problem === "characters" ? periodMessage("name-characters") : null;
}

/** Why the notes are refused, or null. Notes are optional. */
export const notesError = (raw: string) => (hasControlCharacters(raw) || cleanText(raw).length > NOTES_MAX_LENGTH ? periodMessage("notes-invalid") : null);

type Props = {
  /** The date being edited, or undefined to add one. */
  entry?: CalendarEntry;
  entries: CalendarEntry[];
  periods: Period[];
  onDone: () => void;
};

function Form({ entry, entries, periods, onDone }: Props) {
  const [type, setType] = useState<CalendarType>(entry?.type ?? "Holiday");
  const [date, setDate] = useState(entry?.date ?? "");
  const [name, setName] = useState(entry?.name ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [touched, setTouched] = useState(false);
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();

  const taken = date ? entries.find((other) => other.date === date && other.id !== entry?.id) : undefined;
  const nameProblemText = touched || name !== "" ? nameError(name) : null;
  const notesProblemText = notesError(notes);
  const canSave = date !== "" && !taken && nameError(name) === null && notesProblemText === null;
  const holding = date ? periodsHolding(date, periods) : [];

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (!canSave || pending) return;
    const input = { date, name, type, notes: notes === "" ? null : notes };
    start(async () => {
      const result = entry ? await editNonWorkingDate(entry.id, input) : await addNonWorkingDate(input);
      if (!result.ok) { setFailure(result.error); return; }
      toast.success(entry ? `${cleanText(name)} updated` : `${cleanText(name)} added to the company calendar`);
      onDone();
    });
  };
  const changed = <T,>(set: (value: T) => void) => (value: T) => { set(value); setFailure(undefined); };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel required>Type</FieldLabel>
          <div role="group" aria-label="Type" className="flex flex-wrap gap-xs">
            {CALENDAR_TYPES.map((choice) => (
              <button key={choice} type="button" aria-pressed={type === choice} disabled={pending} onClick={() => changed(setType)(choice)} className={cn(PILL, type === choice && PILL_ON)}>{choice}</button>
            ))}
          </div>
          <Help id="date-type-help">{TYPE_HELP[type]}</Help>
        </div>

        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="date-day" required>Date</FieldLabel>
          <DatePicker id="date-day" value={date} label={date ? dateLabel(date) : ""} placeholder="Select date" disabled={pending} onChange={changed(setDate)} aria-invalid={taken ? true : undefined} aria-describedby="date-day-help" />
          <Help id="date-day-help" error={taken ? periodMessage("date-taken", { existing: taken.name }) : null}>Applies to every Evaluation period this date falls in.</Help>
        </div>

        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="date-name" required>Name</FieldLabel>
          <Input id="date-name" value={name} disabled={pending} autoComplete="off" placeholder="e.g. Bonifacio Day" aria-invalid={nameProblemText ? true : undefined} aria-describedby="date-name-help"
            onChange={(event) => changed(setName)(event.target.value)} onBlur={() => setTouched(true)} className={cn(BOX, nameProblemText && "border-[#9a3412]")} />
          <Help id="date-name-help" error={nameProblemText}>Shown in the company calendar and in the period dialog.</Help>
        </div>

        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="date-notes">Notes (optional)</FieldLabel>
          <Input id="date-notes" value={notes} disabled={pending} autoComplete="off" placeholder="e.g. Public holiday" aria-invalid={notesProblemText ? true : undefined} aria-describedby="date-notes-help"
            onChange={(event) => changed(setNotes)(event.target.value)} className={cn(BOX, notesProblemText && "border-[#9a3412]")} />
          <Help id="date-notes-help" error={notesProblemText}>For example, why the company is closed.</Help>
        </div>

        {date && (
          <InfoBox icon={<Info aria-hidden className="size-[13px]" />} label="Effect" title={holding.length ? "Scheduled days drop by one" : "No period holds this date yet"}>
            {holding.length
              ? `Employees whose Working days include ${dateLabel(date, false)} have 1 fewer scheduled day in ${holding.map((period) => period.name).join(", ")}. Nobody is marked absent for it.`
              : "It will apply to any Evaluation period opened over this date. Nobody is marked absent for it."}
          </InfoBox>
        )}
        <Callout>A date in a submitted evaluation does not change that evaluation.</Callout>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit={entry ? "Save changes" : "Add date"} canSubmit={canSave} pending={pending} />
    </form>
  );
}

/** The Add non-working date dialog, or with an `entry` the same dialog to edit one. A date, a name, a type and optional notes. */
export function NonWorkingDateDialog({ entry, entries, periods, open, onOpenChange, defaultOpen = false }: Omit<Props, "onDone"> & { open?: boolean; onOpenChange?: (open: boolean) => void; defaultOpen?: boolean }) {
  const [inner, setInner] = useState(defaultOpen);
  const controlled = open !== undefined;
  const shown = controlled ? open : inner;
  const set = (next: boolean) => { if (!controlled) setInner(next); onOpenChange?.(next); };
  return (
    <Dialog open={shown} onOpenChange={set}>
      {!entry && (
        <DialogTrigger asChild>
          <Button className="h-auto gap-[6px] rounded-lg bg-[#5b2a86] px-[14px] py-[9px] font-medium shadow-none"><Plus className="size-4" aria-hidden />Add date</Button>
        </DialogTrigger>
      )}
      <DialogFrame title={entry ? "Edit non-working date" : "Add non-working date"} description="Holidays and closures">
        <Form entry={entry} entries={entries} periods={periods} onDone={() => set(false)} />
      </DialogFrame>
    </Dialog>
  );
}
