"use client";

import { useState, useTransition } from "react";
import { Info } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { saveSalesSettings } from "@/app/(hrms)/performance/actions";
import { dayLabel, pesos } from "@/lib/performance-pos-import-terms";
import { checkSalesSettings, type SalesSettingsCurrent } from "@/lib/performance-sales-setup-terms";
import { cn } from "@/lib/utils";
import { DatePicker } from "./date-pickers";
import { BOX, Callout, DialogActions, DialogBody, DialogFrame, FieldLabel, Help, InfoBox } from "./dialog-frame";

/** What a pesos target is typed as: the saved amount, without a currency sign or thousands marks. */
const typed = (amount: number | null) => (amount === null ? "" : String(amount));

function Form({ current, onDone }: { current: SalesSettingsCurrent; onDone: () => void }) {
  const [target, setTarget] = useState(typed(current.target));
  const [goLive, setGoLive] = useState(current.goLive ?? "");
  const [touched, setTouched] = useState({ target: false, goLive: false });
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const state = checkSalesSettings({ target, goLive }, current);
  const targetError = touched.target || target !== typed(current.target) ? state.targetError : null;
  const goLiveError = touched.goLive || goLive !== (current.goLive ?? "") ? state.goLiveError : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setTouched({ target: true, goLive: true });
    if (!state.canSave || pending) return;
    start(async () => {
      const result = await saveSalesSettings(state.changes);
      if (!result.ok) { setFailure(result.error); return; }
      toast.success("Sales settings saved");
      onDone();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="sales-target">Sales target</FieldLabel>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute left-[12px] top-1/2 -translate-y-1/2 text-sm text-zinc-500">₱</span>
            <Input id="sales-target" inputMode="decimal" autoComplete="off" value={target} disabled={pending} placeholder="e.g. 1500" aria-invalid={targetError ? true : undefined} aria-describedby="sales-target-help"
              onChange={(event) => { setTarget(event.target.value.replace(/[^\d.]/g, "").slice(0, 12)); setFailure(undefined); }} onBlur={() => setTouched((t) => ({ ...t, target: true }))}
              className={cn(BOX, "pl-[28px]", targetError && "border-[#9a3412]")} />
          </div>
          <Help id="sales-target-help" error={targetError}>Net sales per present day that scores 100. One target for the whole company.</Help>
        </div>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="sales-go-live">POS go-live date</FieldLabel>
          <DatePicker id="sales-go-live" value={goLive} label={goLive ? dayLabel(goLive) : ""} placeholder="Choose a date" disabled={pending} aria-describedby="sales-go-live-help" aria-invalid={goLiveError ? true : undefined}
            onChange={(value) => { setGoLive(value); setTouched((t) => ({ ...t, goLive: true })); setFailure(undefined); }} />
          <Help id="sales-go-live-help" error={goLiveError}>The first day POS sales may be read from. Imports are blocked until it is set, and never read an earlier day.</Help>
        </div>
        <InfoBox icon={<Info aria-hidden className="size-[13px]" />} label="What happens" title="Recorded in the audit log">
          Each change is saved with your name and the old and new value. Evaluations already submitted keep the target they were submitted with.
        </InfoBox>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit="Save" canSubmit={state.canSave} pending={pending} note={Object.keys(state.changes).length === 0 ? "No changes" : "Not saved yet"} />
    </form>
  );
}

/**
 * The Sales settings dialog in KPI Setup: the one company-wide sales target and the POS go-live date. Any Staff member who holds Performance can change
 * either. Save sends only what changed, and the server records each change. A field that already has a value can be changed, not cleared.
 */
export function SalesSettingsDialog({ current, children }: { current: SalesSettingsCurrent; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children ?? <Button variant="outline" className="h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] shadow-none">Edit sales settings</Button>}</DialogTrigger>
      <DialogFrame title="Sales settings" description={`${current.target === null ? "No target set" : `${pesos(current.target)} per present day`} · go-live ${current.goLive ? dayLabel(current.goLive) : "not set"}`}>
        {open && <Form current={current} onDone={() => setOpen(false)} />}
      </DialogFrame>
    </Dialog>
  );
}
