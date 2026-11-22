"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { confirmPosImport, previewPosSales, type PosImportResult } from "@/app/(hrms)/performance/actions";
import type { ImportPreview } from "@/lib/performance";
import { ImportError, importMonths, importRange, type ImportProblem } from "@/lib/performance-pos-import-terms";
import { DialogFrame } from "./dialog-frame";
import { CancelButton, FailureBody, NotLiveBody, PosFooter, PreviewBody, PrimaryButton, ReadingBody, ReadyBody } from "./import-pos-sales-views";

type Stage =
  | { name: "ready" }
  | { name: "reading" }
  | { name: "preview"; preview: ImportPreview }
  | { name: "failed"; kind: ImportProblem; problems: readonly string[]; at: string };

const OUTLINE = "h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] shadow-none";

/**
 * The Import POS sales button in the Performance header and its dialog. Ready names the two months it will read (there is no month picker);
 * Read from POS reads them and shows the preview, with Cancel while it reads; nothing is saved until Confirm import. POS unreachable and POS data
 * changed say nothing was saved and offer Try again or Close. With no go-live date it says so and points to KPI setup, and reads nothing.
 * Every step is a button press: nothing here repeats a request on a timer.
 */
export function ImportPosSalesDialog({ goLiveDate, today }: { goLiveDate: string | null; today: string }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>({ name: "ready" });
  const [saving, startSaving] = useTransition();
  // A read that was cancelled or closed finishes on its own, and its answer is dropped.
  const attempt = useRef(0);

  const plan = useMemo(() => {
    try {
      return { range: importRange(goLiveDate, today), problem: null };
    } catch (error) {
      if (error instanceof ImportError && (error.problem === "go-live-not-set" || error.problem === "go-live-not-reached")) return { range: null, problem: error.problem };
      throw error;
    }
  }, [goLiveDate, today]);
  const months = useMemo(() => (plan.range ? importMonths(plan.range) : []), [plan.range]);
  const names = months.map((month) => month.label).join(" and ");

  const change = (next: boolean) => {
    if (!next) { attempt.current += 1; setStage({ name: "ready" }); }
    setOpen(next);
  };
  const settle = (token: number, result: PosImportResult) => {
    if (token !== attempt.current) return;
    if (!result.ok) setStage({ name: "failed", kind: result.kind, problems: result.problems, at: result.at });
    else if ("preview" in result) setStage({ name: "preview", preview: result.preview });
  };
  const read = async () => {
    const token = ++attempt.current;
    setStage({ name: "reading" });
    settle(token, await previewPosSales());
  };
  const confirm = () => {
    const token = ++attempt.current;
    startSaving(async () => {
      const result = await confirmPosImport();
      // A saved import is reported even if the dialog was closed meanwhile; a failure is shown only while the dialog is still waiting for it.
      if (result.ok && "saved" in result) { toast.success("POS sales imported"); change(false); return; }
      settle(token, result);
    });
  };

  const failed = stage.name === "failed" ? stage : null;
  const notLive = plan.problem ?? (failed && (failed.kind === "go-live-not-set" || failed.kind === "go-live-not-reached") ? failed.kind : null);

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogTrigger asChild><Button variant="outline" className={OUTLINE}>Import POS sales</Button></DialogTrigger>
      <DialogFrame title="Import POS sales" description={`${names || "No months yet"} · ${stage.name === "preview" ? "read from the POS just now" : "read-only"}`}>
        {notLive ? (
          <>
            <NotLiveBody problem={notLive} goLiveDate={goLiveDate} />
            <PosFooter note="Nothing read"><CancelButton>Close</CancelButton></PosFooter>
          </>
        ) : stage.name === "ready" ? (
          <>
            <ReadyBody months={months} />
            <PosFooter note="Not read yet"><CancelButton /><PrimaryButton onClick={read}>Read from POS</PrimaryButton></PosFooter>
          </>
        ) : stage.name === "reading" ? (
          <>
            <ReadingBody months={months} />
            <PosFooter note="Reading…"><CancelButton /><PrimaryButton disabled busy>Reading…</PrimaryButton></PosFooter>
          </>
        ) : stage.name === "preview" ? (
          <>
            <PreviewBody preview={stage.preview} />
            <PosFooter note={saving ? "Saving…" : "Not saved yet"}><CancelButton disabled={saving} /><PrimaryButton onClick={confirm} busy={saving}>Confirm import</PrimaryButton></PosFooter>
          </>
        ) : failed && (failed.kind === "pos-unreachable" || failed.kind === "pos-data-changed" || failed.kind === "pos-not-configured") ? (
          <>
            <FailureBody kind={failed.kind} problems={failed.problems} at={failed.at} />
            <PosFooter note="Nothing saved"><CancelButton>Close</CancelButton><PrimaryButton onClick={read}>Try again</PrimaryButton></PosFooter>
          </>
        ) : null}
      </DialogFrame>
    </Dialog>
  );
}
