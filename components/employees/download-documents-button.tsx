"use client";

import { useId, useState } from "react";
import { File, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Downloads the employee's Digital 201 ZIP; disabled, with a reason, until a document has been submitted. */
export function DownloadDocumentsButton({ employeeId, hasSubmitted }: { employeeId: number; hasSubmitted: boolean }) {
  const [busy, setBusy] = useState(false);
  const hintId = useId();

  async function download() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/employees/${employeeId}/documents`);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `employee-${employeeId}-digital-201.zip`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Could not download the documents. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-[6px]">
      <Button type="button" variant="outline" onClick={download} disabled={!hasSubmitted || busy}
        aria-describedby={hasSubmitted ? undefined : hintId} aria-busy={busy}
        className="h-auto w-full justify-start rounded-lg border-[#e6e1ee] px-[12px] py-[6px] text-[13px] text-[#1f1a2e] shadow-none">
        {busy ? <Loader2 aria-hidden className="size-[14px] animate-spin" /> : <File aria-hidden className="size-[14px]" />}
        {busy ? "Preparing download…" : "Download all documents"}
      </Button>
      {hasSubmitted ? null : <p id={hintId} className="text-[11px] text-zinc-500">No documents have been submitted yet.</p>}
    </div>
  );
}
