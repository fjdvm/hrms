"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, ChevronLeft, ChevronRight, Download, Printer, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { loadPrintable, loadSchedule, recordSchedulePrinted } from "@/app/(hrms)/training/actions";
import { SchedulePage, ScheduleDocument } from "@/components/training/schedule-sheet";
import {
  SCHEDULE_FORMATS, formatTrainingDate, formatTrainingTimes, needPrintedWarning, scheduleFileName, schedulePageCount,
  type PrintableTraining, type ScheduleFormat, type ScheduleSheet,
} from "@/lib/training-terms";
import { cn } from "@/lib/utils";

// While the dialog is open only the schedule prints: the page and the dialog are hidden, then the sheet fills the A4 pages.
const PRINT_CSS = `
#schedule-print-root { display: none; }
@media print {
  body > *:not(#schedule-print-root) { display: none !important; }
  #schedule-print-root { display: block !important; }
  @page { size: A4; margin: 14mm; }
  .schedule-page { break-after: page; }
  .schedule-page:last-child { break-after: auto; }
}`;

type Props = {
  /** Trainings ticked when the dialog opens; without any, the ones in the next 7 days. */
  preselect?: number[];
  /** The opening button's text. */
  triggerLabel?: string;
};

/** Print or export the schedule for chosen Trainings, with an A4 preview. Printing with names marks no-email Employees as printed. */
export function PrintScheduleDialog({ preselect, triggerLabel = "Print schedule" }: Props) {
  const [open, setOpen] = useState(false);
  const [trainings, setTrainings] = useState<PrintableTraining[]>();
  const [picked, setPicked] = useState<number[]>([]);
  const [includeNames, setIncludeNames] = useState(true);
  const [format, setFormat] = useState<ScheduleFormat>("A4 print");
  const [sheet, setSheet] = useState<ScheduleSheet>();
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function refresh(ids: number[], names: boolean) {
    if (ids.length === 0) { setSheet(undefined); return; }
    const result = await loadSchedule(ids, names);
    if (result.sheet) { setSheet(result.sheet); setPage(0); setError(undefined); } else setError(result.error);
  }

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setTrainings(undefined); setSheet(undefined); setError(undefined); setNotice(undefined); setIncludeNames(true); setFormat("A4 print"); setPage(0);
    void loadPrintable().then((result) => {
      if (!result.trainings) { setError(result.error ?? "Trainings could not be loaded."); return; }
      setTrainings(result.trainings);
      const soon = new Date(Date.now() + 7 * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
      const ids = (preselect?.length ? preselect : result.trainings.filter((training) => training.date <= soon).map((training) => training.id))
        .filter((id) => result.trainings!.some((training) => training.id === id));
      setPicked(ids);
      void refresh(ids, true);
    });
  }

  function toggle(id: number) {
    const next = picked.includes(id) ? picked.filter((item) => item !== id) : [...picked, id];
    setPicked(next);
    void refresh(next, includeNames);
  }
  function setNames(value: boolean) { setIncludeNames(value); void refresh(picked, value); }

  async function print() {
    setBusy(true); setError(undefined); setNotice(undefined);
    const recorded = await recordSchedulePrinted(picked, includeNames);
    setBusy(false);
    if (recorded.error) { setError(recorded.error); return; }
    if (recorded.marked) setNotice(`${recorded.marked} ${recorded.marked === 1 ? "employee" : "employees"} marked as printed.`);
    // Fresh counts and names, then the browser's print dialog (choose "Save as PDF" there for a PDF).
    await refresh(picked, includeNames);
    const previous = document.title;
    if (sheet) document.title = scheduleFileName(sheet, "pdf").replace(/\.pdf$/, "");
    setTimeout(() => { window.print(); document.title = previous; }, 50);
  }

  async function exportFile() {
    if (format !== "Excel") { await print(); return; }
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      const response = await fetch("/api/training-schedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ trainingIds: picked, includeNames }) });
      if (!response.ok) throw new Error();
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = sheet ? scheduleFileName(sheet, "csv") : "training-schedule.csv";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (includeNames && sheet?.needPrinted.length) setNotice(`${sheet.needPrinted.length} ${sheet.needPrinted.length === 1 ? "employee" : "employees"} marked as printed.`);
    } catch { setError("The export could not be made. Please try again."); }
    setBusy(false);
  }

  const pages = sheet ? schedulePageCount(sheet) : 0;
  const warning = sheet ? needPrintedWarning(sheet.needPrinted) : null;
  const none = picked.length === 0;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-auto gap-[6px] rounded-lg px-[14px] py-[9px] font-medium shadow-none"><Printer className="size-4" aria-hidden />{triggerLabel}</Button>
      </DialogTrigger>
      <DialogContent showClose={false} overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="w-[calc(100vw-32px)] max-w-[1000px] gap-0 rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[1000px] sm:rounded-2xl sm:p-0 md:max-w-[1000px] lg:max-w-[1000px]">
        <style>{PRINT_CSS}</style>
        <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Print or export schedule</DialogTitle>
            <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">For employees without an email, or to post at the branch</DialogDescription>
          </div>
          <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
        </div>
        <div className="grid max-h-[70vh] gap-[20px] overflow-y-auto px-[24px] py-[20px] md:grid-cols-2">
          <div className="flex flex-col gap-[16px]">
            <p className="text-sm font-medium text-foreground">Trainings</p>
            {trainings === undefined && !error && <p role="status" className="text-sm text-muted-foreground">Loading trainings…</p>}
            {trainings?.length === 0 && <p className="rounded-lg bg-muted px-[14px] py-[14px] text-sm text-muted-foreground">No upcoming trainings to put on a schedule.</p>}
            {trainings && trainings.length > 0 && (
              <ul className="max-h-[260px] divide-y divide-[#ebebeb] overflow-y-auto rounded-lg border border-[#e6e1ee]">
                {trainings.map((training) => (
                  <li key={training.id}>
                    <label className="flex cursor-pointer items-center gap-[12px] px-[14px] py-[9px]">
                      <input type="checkbox" checked={picked.includes(training.id)} onChange={() => toggle(training.id)} className="size-4 accent-[#5b2a86]" aria-label={training.title} />
                      <span className="flex min-w-0 flex-col"><span className="text-sm font-medium">{training.title}</span><span className="text-xs text-zinc-500">{formatTrainingDate(training.date)} · {formatTrainingTimes(training.startTime, training.endTime)}</span></span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex items-start gap-[12px]">
              <div className="flex flex-1 flex-col gap-[2px]"><span id="names-label" className="text-sm font-medium">Include assigned names</span><span className="text-xs text-zinc-500">Lists each employee under their training</span></div>
              <Switch checked={includeNames} onCheckedChange={setNames} aria-labelledby="names-label" />
            </div>
            <fieldset className="flex flex-col gap-[8px]">
              <legend className="mb-[8px] text-sm font-medium">Format</legend>
              <div className="flex gap-[10px]">
                {SCHEDULE_FORMATS.map((option) => (
                  <label key={option} className={cn("flex flex-1 cursor-pointer items-center gap-[8px] rounded-[10px] border px-[12px] py-[10px] text-sm", format === option ? "border-[1.5px] border-[#8b5cf6] bg-[#f5f0ff]" : "border-zinc-200 bg-white")}>
                    <input type="radio" name="format" value={option} checked={format === option} onChange={() => setFormat(option)} className="size-4 accent-[#5b2a86]" />
                    {option === "Excel" ? "Excel (.csv)" : option}
                  </label>
                ))}
              </div>
              <p className="text-xs text-zinc-500">{format === "PDF" ? "Choose Save as PDF in the print window." : format === "Excel" ? "Downloads a spreadsheet that opens in Excel." : "Opens your browser’s print window, set to A4."}</p>
            </fieldset>
            {warning && <p className="flex items-start gap-[8px] rounded-lg bg-amber-50 px-[14px] py-[12px] text-[13px] text-amber-900"><AlertCircle className="mt-[2px] size-4 shrink-0" aria-hidden />{warning}</p>}
            {!includeNames && sheet && sheet.needPrinted.length > 0 && <p className="text-xs text-zinc-500">Without the names, no one is marked as printed.</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="text-sm text-green-700">{notice}</p>}
          </div>
          <div className="flex flex-col gap-[10px] rounded-xl bg-[#f4f4f5] p-[16px]">
            <div className="flex items-center justify-center gap-[8px] text-xs text-zinc-500">
              <button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded p-[2px] disabled:opacity-30"><ChevronLeft className="size-4" /></button>
              <span>A4 preview{sheet ? ` · ${page + 1} of ${pages}` : ""}</span>
              <button type="button" aria-label="Next page" disabled={!sheet || page >= pages - 1} onClick={() => setPage(page + 1)} className="rounded p-[2px] disabled:opacity-30"><ChevronRight className="size-4" /></button>
            </div>
            {sheet ? <div className="mx-auto w-full max-w-[300px] shadow-md"><SchedulePage sheet={sheet} page={page} /></div>
              : <p className="py-xl text-center text-sm text-muted-foreground">Choose at least one training to see the schedule.</p>}
          </div>
        </div>
        <div className="flex items-center gap-sm border-t border-[#ebebeb] px-[24px] py-[14px]">
          <p className="flex-1 text-xs text-zinc-500">{picked.length} {picked.length === 1 ? "training" : "trainings"} · {includeNames ? "with names" : "without names"}</p>
          <DialogClose asChild><Button variant="outline" className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] text-sm font-medium shadow-none">Cancel</Button></DialogClose>
          <Button variant="outline" disabled={none || busy || !sheet} onClick={exportFile} className="h-auto gap-[6px] rounded-lg px-[16px] py-[9px] text-sm font-medium shadow-none"><Download className="size-4" aria-hidden />Export</Button>
          <Button disabled={none || busy || !sheet} onClick={print} className="h-auto gap-[6px] rounded-lg px-[16px] py-[9px] text-sm font-medium shadow-none"><Printer className="size-4" aria-hidden />Print</Button>
        </div>
        {open && sheet && typeof document !== "undefined" && createPortal(<div id="schedule-print-root"><ScheduleDocument sheet={sheet} /></div>, document.body)}
      </DialogContent>
    </Dialog>
  );
}
