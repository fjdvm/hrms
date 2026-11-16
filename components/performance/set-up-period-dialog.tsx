"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarPlus, Layers } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { openEvaluationPeriod } from "@/app/(hrms)/performance/actions";
import type { Kpi, WeightSet } from "@/lib/performance-kpis";
import { KPI_IDS } from "@/lib/performance-scoring";
import { DEFAULT_GRACE_MINUTES, countNonWorking, findOverlap, monthChoices, nonWorkingText, quarterChoices, rangeLabel, readGrace, type DateRange } from "@/lib/performance-period-form";
import { overlapMessage } from "@/lib/performance-period-messages";
import type { OpenPeriodInput, Period, PeriodType } from "@/lib/performance-periods";
import { cn } from "@/lib/utils";
import { RangePicker } from "./date-pickers";
import { BOX, Callout, DialogActions, DialogBody, DialogFrame, ERROR_COLOUR, FieldLabel, Help, InfoBox, PILL, PILL_ON } from "./dialog-frame";

const TYPES: readonly PeriodType[] = ["Month", "Quarter", "Custom"];
const TYPE_HELP = "Month and Quarter fill the dates for you. Custom lets you pick any start and end.";

/** The choice of Month or Quarter that holds today, so the dialog opens on the current period. */
const currentKey = (choices: { key: string; range: DateRange }[], today: string) => (choices.find((choice) => choice.range.start <= today && choice.range.end >= today) ?? choices[0]).key;

/** The Employee-facing weight set callout: the default set's weights, and the position sets that use their own. */
function WeightSetNote({ sets, kpis }: { sets: WeightSet[]; kpis: Kpi[] }) {
  const base = sets.find((set) => set.isDefault);
  const nameOf = (id: string) => kpis.find((kpi) => kpi.id === id)?.name ?? id;
  const positions = sets.filter((set) => !set.isDefault).map((set) => set.position ?? set.name);
  return (
    <InfoBox icon={<Layers aria-hidden className="size-[13px]" />} label="Weight set" title="The default weight set applies">
      {base ? `${KPI_IDS.map((id) => `${nameOf(id)} ${base.weights[id]}`).join(" · ")}. ` : ""}A position with its own weight set uses that instead.
      {positions.length > 0 && ` Own sets: ${positions.join(", ")}.`}
    </InfoBox>
  );
}

function Form({ today, periods, nonWorkingDates, sets, kpis, onDone }: Props & { onDone: () => void }) {
  const months = monthChoices(today);
  const quarters = quarterChoices(today);
  const [type, setType] = useState<PeriodType>("Month");
  const [monthKey, setMonthKey] = useState(() => currentKey(months, today));
  const [quarterKey, setQuarterKey] = useState(() => currentKey(quarters, today));
  const [custom, setCustom] = useState({ start: "", end: "" });
  const [graceText, setGraceText] = useState(String(DEFAULT_GRACE_MINUTES));
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();

  const choice = type === "Month" ? months.find((c) => c.key === monthKey) : type === "Quarter" ? quarters.find((c) => c.key === quarterKey) : undefined;
  const range: DateRange | null = choice ? choice.range : custom.start && custom.end ? custom : null;
  const overlap = findOverlap(range, periods);
  const grace = readGrace(graceText);
  const canOpen = range !== null && !overlap && grace.minutes !== null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!range || !canOpen || grace.minutes === null || pending) return;
    const month = Number(range.start.slice(5, 7));
    const input: OpenPeriodInput = type === "Month" ? { type, year: Number(range.start.slice(0, 4)), month, graceMinutes: grace.minutes }
      : type === "Quarter" ? { type, year: Number(range.start.slice(0, 4)), quarter: Math.floor((month - 1) / 3) + 1, graceMinutes: grace.minutes }
      : { type, start: range.start, end: range.end, graceMinutes: grace.minutes };
    start(async () => {
      const result = await openEvaluationPeriod(input);
      if (!result.ok) { setFailure(result.error); return; }
      toast.success(`${choice?.name ?? rangeLabel(range)} opened`);
      onDone();
    });
  };
  const edit = <T,>(set: (value: T) => void) => (value: T) => { set(value); setFailure(undefined); };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel required>Period type</FieldLabel>
          <div role="group" aria-label="Period type" className="flex flex-wrap gap-xs">
            {TYPES.map((name) => (
              <button key={name} type="button" aria-pressed={type === name} disabled={pending} onClick={() => edit(setType)(name)} className={cn(PILL, type === name && PILL_ON)}>{name}</button>
            ))}
          </div>
          <Help id="period-type-help">{TYPE_HELP}</Help>
        </div>

        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="period-range" required>Period</FieldLabel>
          {type === "Custom" ? (
            <RangePicker id="period-range" start={custom.start} end={custom.end} label={range ? rangeLabel(range) : ""} placeholder="Select start and end" disabled={pending}
              onChange={edit(setCustom)} aria-invalid={overlap ? true : undefined} aria-describedby="period-range-help" />
          ) : (
            <select id="period-range" value={type === "Month" ? monthKey : quarterKey} disabled={pending} aria-invalid={overlap ? true : undefined} aria-describedby="period-range-help"
              onChange={(event) => edit(type === "Month" ? setMonthKey : setQuarterKey)(event.target.value)}
              className={cn(BOX, "border bg-white", overlap && "border-[#9a3412]")}>
              {(type === "Month" ? months : quarters).map((option) => <option key={option.key} value={option.key}>{rangeLabel(option.range)}</option>)}
            </select>
          )}
          {overlap ? <p role="alert" id="period-range-help" className={cn("text-xs", ERROR_COLOUR)}>{overlapMessage(overlap)}</p>
            : <Help id="period-range-help">{choice ? `${choice.name}. One period per evaluation.` : "Pick any start and end. One period per evaluation."}</Help>}
        </div>

        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="period-non-working">Non-working dates</FieldLabel>
          <Input id="period-non-working" readOnly value={nonWorkingText(countNonWorking(range, nonWorkingDates))} aria-describedby="period-non-working-help" className={BOX} />
          <p id="period-non-working-help" className="text-xs text-zinc-500">
            From the company calendar: holidays and closures are not counted as absences. Excused days are entered per employee.{" "}
            <Link href="/performance/calendar" className="font-medium text-primary hover:underline">Open the company calendar</Link>
          </p>
        </div>

        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="period-grace" required>Grace period (minutes)</FieldLabel>
          <Input id="period-grace" inputMode="numeric" autoComplete="off" value={graceText} disabled={pending} aria-invalid={grace.error ? true : undefined} aria-describedby="period-grace-help"
            onChange={(event) => edit(setGraceText)(event.target.value)} className={cn(BOX, grace.error && "border-[#9a3412]")} />
          <Help id="period-grace-help" error={grace.error}>Late = time-in after the shift start plus the grace period.</Help>
        </div>

        <WeightSetNote sets={sets} kpis={kpis} />

        {overlap && range && <Callout>Periods can’t overlap by date. Choose dates {overlap.end <= range.end ? "after" : "before"} {overlap.name}.</Callout>}
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit="Open period" canSubmit={canOpen} pending={pending} />
    </form>
  );
}

type Props = {
  /** Today in Manila, "YYYY-MM-DD", chosen by the server so the first render matches. */
  today: string;
  periods: Period[];
  /** The company calendar's dates, used for the read-only count. */
  nonWorkingDates: string[];
  sets: WeightSet[];
  kpis: Kpi[];
  defaultOpen?: boolean;
};

/**
 * The Set up evaluation period dialog: Month, Quarter or Custom, the grace period, how many non-working dates the period holds
 * (read-only, from the company calendar) and the weight set that applies. A range that overlaps another period shows the error on
 * the Period field and keeps Open period disabled.
 */
export function SetUpPeriodDialog({ defaultOpen = false, ...props }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-auto gap-[6px] rounded-lg bg-[#5b2a86] px-[14px] py-[9px] font-medium shadow-none"><CalendarPlus className="size-4" aria-hidden />Set up period</Button>
      </DialogTrigger>
      <DialogFrame title="Set up evaluation period" description="Dates and grace period">
        <Form {...props} onDone={() => setOpen(false)} />
      </DialogFrame>
    </Dialog>
  );
}
