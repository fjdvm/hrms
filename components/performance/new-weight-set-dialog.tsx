"use client";

import { useState, useTransition } from "react";
import { Layers, Loader2, Plus, TriangleAlert, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { createWeightSet } from "@/app/(hrms)/performance/actions";
import type { Kpi, WeightSet } from "@/lib/performance-kpis";
import { KPI_IDS, type KpiId } from "@/lib/performance-scoring";
import { BASE_CHOICES, checkWeightForm, startingWeights, weightOf, weightsFrom, type BaseChoice, type WeightTexts } from "@/lib/performance-weight-form";
import { WEIGHT_SET_TOTAL } from "@/lib/performance-kpis";
import { cn } from "@/lib/utils";

const BOX = "h-[40px] w-full rounded-lg border-[#e4e4e7] px-[12px] py-[9px] text-sm shadow-none";
const ERROR_COLOUR = "text-[#9a3412]";
const PILL = "rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50";
const PILL_ON = "bg-accent text-primary hover:text-primary";

function Form({ sets, kpis, onDone }: { sets: WeightSet[]; kpis: Kpi[]; onDone: () => void }) {
  const positionSets = sets.filter((set) => !set.isDefault);
  const [base, setBase] = useState<BaseChoice>("default");
  const [anotherId, setAnotherId] = useState<number | undefined>(positionSets[0]?.id);
  const [position, setPosition] = useState("");
  const [texts, setTexts] = useState<WeightTexts>(() => startingWeights("default", sets));
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const state = checkWeightForm(position, texts, sets);
  const baseSet = base === "another" ? sets.find((set) => set.id === anotherId) : base === "default" ? sets.find((set) => set.isDefault) : undefined;
  const baseName = base === "blank" ? "Blank" : baseSet?.name ?? "Default set";
  const taken = state.positionError !== null && state.position !== null;
  const nameOf = (id: KpiId) => kpis.find((kpi) => kpi.id === id)?.name ?? id;

  const choose = (next: BaseChoice, id = anotherId) => {
    setBase(next);
    setAnotherId(id);
    setTexts(startingWeights(next, sets, id));
    setFailure(undefined);
  };
  const type = (id: KpiId, value: string) => {
    setTexts((current) => ({ ...current, [id]: value.replace(/\D/g, "").slice(0, 3) }));
    setFailure(undefined);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!state.canCreate || state.position === null || pending) return;
    start(async () => {
      const result = await createWeightSet(state.position!, weightsFrom(texts));
      if (!result.ok) { setFailure(result.error); return; }
      toast.success(`Weight set created for ${state.position}`);
      onDone();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <div className="flex max-h-[calc(100vh-220px)] flex-col gap-[16px] overflow-y-auto px-[24px] py-[20px]">
        <div className="flex flex-col gap-[6px]">
          <span id="weight-base-label" className="text-[13px] font-medium text-zinc-800">Based on <span className="text-red-600">*</span></span>
          <div role="group" aria-labelledby="weight-base-label" className="flex flex-wrap gap-xs">
            {BASE_CHOICES.map((choice) => (
              <button key={choice.id} type="button" aria-pressed={base === choice.id} disabled={pending || (choice.id === "another" && positionSets.length === 0)}
                onClick={() => choose(choice.id, choice.id === "another" ? anotherId ?? positionSets[0]?.id : anotherId)} className={cn(PILL, base === choice.id && PILL_ON)}>
                {choice.label}
              </button>
            ))}
          </div>
          <p className="text-xs text-zinc-500">{BASE_CHOICES.find((choice) => choice.id === base)!.help}</p>
        </div>

        {base === "another" && (
          <div className="flex flex-col gap-[6px]">
            <span id="weight-copy-label" className="text-[13px] font-medium text-zinc-800">Copy from</span>
            <div role="group" aria-labelledby="weight-copy-label" className="flex flex-wrap gap-xs">
              {positionSets.map((set) => (
                <button key={set.id} type="button" aria-pressed={anotherId === set.id} disabled={pending} onClick={() => choose("another", set.id)} className={cn(PILL, anotherId === set.id && PILL_ON)}>{set.name}</button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col gap-[6px]">
          <label htmlFor="weight-position" className="text-[13px] font-medium text-zinc-800">Position <span className="text-red-600">*</span></label>
          <Input id="weight-position" value={position} disabled={pending} placeholder="e.g. Branch Cashier" autoComplete="off" onChange={(event) => { setPosition(event.target.value); setFailure(undefined); }}
            aria-invalid={state.positionError !== null || undefined} aria-describedby="weight-position-help" className={cn(BOX, state.positionError !== null && "border-[#9a3412]")} />
          {state.positionError !== null && !taken ? <p role="alert" id="weight-position-help" className={cn("text-xs", ERROR_COLOUR)}>{state.positionError}</p>
            : <p id="weight-position-help" className="text-xs text-zinc-500">Matches the Employee’s position exactly, ignoring case and extra spaces.</p>}
        </div>

        <div className="flex flex-col gap-[6px]">
          <span id="weight-weights-label" className="text-[13px] font-medium text-zinc-800">Weights</span>
          <p aria-labelledby="weight-weights-label" className="flex h-[40px] items-center rounded-lg border border-[#e4e4e7] bg-zinc-50 px-[12px] text-sm text-foreground">
            {baseName} · {KPI_IDS.map((id) => weightOf(texts[id]) ?? 0).join(" / ")}
          </p>
          <div className="grid gap-[10px] sm:grid-cols-2">
            {KPI_IDS.map((id) => (
              <label key={id} className="flex items-center justify-between gap-[10px] text-sm">
                <span className="text-zinc-700">{nameOf(id)}</span>
                <Input inputMode="numeric" value={texts[id]} disabled={pending} aria-label={`${nameOf(id)} weight`} onChange={(event) => type(id, event.target.value)} className="h-[36px] w-[72px] rounded-lg border-[#e4e4e7] px-[10px] text-right shadow-none" />
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-[6px]">
          <span id="weight-total-label" className="text-[13px] font-medium text-zinc-800">Total <span className="text-red-600">*</span></span>
          <p aria-labelledby="weight-total-label" data-testid="weight-total" className={cn("flex h-[40px] items-center rounded-lg border bg-white px-[12px] text-sm", state.total === WEIGHT_SET_TOTAL ? "border-[#e4e4e7] text-foreground" : cn("border-[#9a3412]", ERROR_COLOUR))}>{state.total}</p>
          <p className={cn("text-xs", state.weightsError ? ERROR_COLOUR : "text-zinc-500")}>{state.weightsError ?? "Each weight set must total 100 before it can be saved."}</p>
        </div>

        {state.position !== null && !taken && (
          <div className="flex flex-col gap-[4px] rounded-lg bg-[#f4f1f7] px-[14px] py-[12px]">
            <p className="flex items-center gap-[6px] text-[11px] font-semibold uppercase tracking-wide text-[#5a5368]"><Layers aria-hidden className="size-[13px]" />Weight set</p>
            <p className="text-sm font-semibold text-foreground">{state.position} uses this set</p>
            <p className="text-[13px] text-zinc-500">Employees whose position is {state.position} use it in place of the default set. Evaluations already submitted keep the weights they were submitted with.</p>
          </div>
        )}

        {(taken || failure) && (
          <div role="alert" className="flex items-start gap-[8px] rounded-lg bg-[#fdf1d8] px-[12px] py-[10px]">
            <TriangleAlert aria-hidden className="mt-[2px] size-[16px] shrink-0 text-[#8a5a00]" />
            <p className="text-[13px] leading-[19px] text-[#8a5a00]">{failure ?? state.positionError}</p>
          </div>
        )}
      </div>
      <div className="flex items-center gap-sm border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
        <p className="mr-auto text-xs text-zinc-500">Not saved yet</p>
        <DialogClose asChild><Button type="button" variant="outline" disabled={pending} className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] shadow-none">Cancel</Button></DialogClose>
        <Button type="submit" disabled={!state.canCreate || pending} className="h-auto rounded-lg bg-[#5b2a86] px-[16px] py-[9px]">{pending && <Loader2 className="animate-spin" />}Create set</Button>
      </div>
    </form>
  );
}

/** The New weight set dialog: a set for one position, based on the default set, a blank set or another set. Create set needs a free position and weights that total 100. */
export function NewWeightSetDialog({ sets, kpis }: { sets: WeightSet[]; kpis: Kpi[] }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-auto gap-[6px] rounded-lg bg-[#5b2a86] px-[14px] py-[9px] font-medium shadow-none"><Plus className="size-4" aria-hidden />New weight set</Button>
      </DialogTrigger>
      <DialogContent showClose={false} overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="w-[calc(100vw-32px)] max-w-[580px] gap-0 rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:p-0 md:max-w-[580px] lg:max-w-[580px]">
        <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
          <div className="flex flex-1 flex-col gap-[3px]">
            <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">New weight set</DialogTitle>
            <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">For one position</DialogDescription>
          </div>
          <DialogClose aria-label="Close" className="text-zinc-500 hover:text-zinc-900"><X className="size-[18px]" aria-hidden /></DialogClose>
        </div>
        <Form sets={sets} kpis={kpis} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
