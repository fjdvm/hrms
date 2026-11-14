"use client";

import { useRef, useState } from "react";
import { FileText, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { confirmMaterialUpload, deleteTrainingMaterial, requestMaterialUpload } from "@/app/(hrms)/training/actions";
import { MATERIAL_ACCEPT, formatSize, materialKind, materialProblem, type TrainingMaterial } from "@/lib/training-terms";
import { cn } from "@/lib/utils";

/**
 * Uploading and removing materials. Each file goes request → PUT straight to file-storage → confirm, and each removal
 * waits for a confirm dialog. With a `trainingId` the files attach to that Training at once; without one (the New
 * training form) they are reported through `onChange` and claimed when the Training is saved.
 */
export function useMaterials(initial: TrainingMaterial[], trainingId?: number) {
  const [materials, setMaterials] = useState(initial);
  const [uploading, setUploading] = useState(0);
  const [error, setError] = useState<string>();
  const [removing, setRemoving] = useState<TrainingMaterial>();
  const [removePending, setRemovePending] = useState(false);

  async function upload(files: File[]) {
    setError(undefined);
    for (const file of files) {
      const request = { filename: file.name, contentType: file.type, size: file.size };
      const invalid = materialProblem(request);
      if (invalid) { setError(`${file.name}: ${invalid}`); continue; }
      setUploading((n) => n + 1);
      try {
        const requested = await requestMaterialUpload(request, trainingId);
        if (requested.error || !requested.fileId || !requested.uploadUrl) throw new Error(requested.error ?? "The upload could not start.");
        const put = await fetch(requested.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!put.ok) throw new Error("The upload did not finish.");
        const confirmed = await confirmMaterialUpload(requested.fileId, trainingId);
        if (confirmed.error || !confirmed.material) throw new Error(confirmed.error ?? "The upload could not be confirmed.");
        const material = confirmed.material;
        setMaterials((current) => [...current, material]);
      } catch (cause) {
        setError(`${file.name}: ${cause instanceof Error ? cause.message : "The upload failed."}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemovePending(true);
    const result = await deleteTrainingMaterial(removing.fileId, trainingId);
    setRemovePending(false);
    if (result.error) { setError(result.error); setRemoving(undefined); return; }
    setMaterials((current) => current.filter((item) => item.fileId !== removing.fileId));
    setRemoving(undefined);
  }

  return { materials, uploading, error, removing, removePending, upload, askRemove: setRemoving, cancelRemove: () => setRemoving(undefined), confirmRemove };
}
type State = ReturnType<typeof useMaterials>;

function MaterialRow({ material, onRemove }: { material: TrainingMaterial; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-[12px] rounded-lg border border-[#e6e1ee] bg-white px-[12px] py-[10px]">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent"><FileText className="size-[18px] text-primary" aria-hidden /></span>
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <a href={`/api/training-materials/${encodeURIComponent(material.fileId)}`} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-zinc-900 hover:underline">{material.filename}</a>
        <span className="text-xs text-zinc-500">{materialKind(material.contentType)} · {formatSize(material.size)}</span>
      </div>
      <button type="button" onClick={onRemove} aria-label={`Delete ${material.filename}`} className="rounded-md p-[6px] text-zinc-500 hover:bg-zinc-100 hover:text-destructive"><Trash2 className="size-4" aria-hidden /></button>
    </li>
  );
}

function RemoveDialog({ state }: { state: State }) {
  return (
    <AlertDialog open={Boolean(state.removing)} onOpenChange={(open) => { if (!open) state.cancelRemove(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this material?</AlertDialogTitle>
          <AlertDialogDescription>{state.removing?.filename} will be deleted for good. This can’t be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep material</AlertDialogCancel>
          <AlertDialogAction disabled={state.removePending} onClick={(event) => { event.preventDefault(); void state.confirmRemove(); }}>
            {state.removePending ? "Deleting…" : "Delete material"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Rows({ state }: { state: State }) {
  return (
    <>
      {state.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
      {state.materials.length > 0 && (
        <ul className="flex flex-col gap-[10px]">{state.materials.map((m) => <MaterialRow key={m.fileId} material={m} onRemove={() => state.askRemove(m)} />)}</ul>
      )}
      <RemoveDialog state={state} />
    </>
  );
}

/** The New training form's Materials card: a dropzone, then one row per file. */
export function MaterialsDropzone({ state }: { state: State }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div className="flex flex-col gap-[14px]">
      <div
        onDragOver={(event) => { event.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => { event.preventDefault(); setOver(false); void state.upload(Array.from(event.dataTransfer.files)); }}
        className={cn("flex flex-col items-center gap-[8px] rounded-[10px] border border-dashed border-[#c4b5fd] px-[16px] py-[22px] text-center", over ? "bg-[#f5f0ff]" : "bg-[#faf8fc]")}
      >
        <Upload className="size-5 text-primary" aria-hidden />
        <button type="button" onClick={() => input.current?.click()} className="text-sm font-medium text-primary hover:underline">Drop files here or browse</button>
        <p className="text-xs text-zinc-500">Assigned employees don’t sign in, so materials are for Staff to print or share.</p>
        <input ref={input} type="file" multiple hidden accept={MATERIAL_ACCEPT} aria-label="Choose material files" onChange={(event) => { void state.upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      </div>
      {state.uploading > 0 && <p role="status" className="text-xs text-zinc-500">Uploading…</p>}
      {state.materials.length === 0 && state.uploading === 0
        ? <p className="rounded-lg bg-muted px-[14px] py-[12px] text-center text-[13px] font-medium text-zinc-500">No materials yet</p>
        : null}
      <Rows state={state} />
    </div>
  );
}

/** The Training page's Materials card: an Upload button, then one row per file. */
export function MaterialsCard({ trainingId, initial }: { trainingId: number; initial: TrainingMaterial[] }) {
  const state = useMaterials(initial, trainingId);
  const input = useRef<HTMLInputElement>(null);
  return (
    <section aria-labelledby="materials-title" className="flex flex-col gap-[14px] rounded-xl border border-[#e6e1ee] bg-white px-[20px] py-[18px]">
      <div className="flex items-center gap-sm">
        <h2 id="materials-title" className="flex-1 text-[15px] font-semibold text-zinc-900">Materials</h2>
        <Button type="button" variant="outline" disabled={state.uploading > 0} onClick={() => input.current?.click()} className="h-auto gap-[6px] rounded-lg px-[12px] py-[7px] text-[13px] shadow-none">
          <Upload className="size-4" aria-hidden />{state.uploading > 0 ? "Uploading…" : "Upload"}
        </Button>
        <input ref={input} type="file" multiple hidden accept={MATERIAL_ACCEPT} aria-label="Choose material files" onChange={(event) => { void state.upload(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      </div>
      {state.materials.length === 0 && !state.error && <p className="rounded-lg bg-muted px-[14px] py-[12px] text-center text-[13px] font-medium text-zinc-500">No materials yet</p>}
      <Rows state={state} />
    </section>
  );
}
