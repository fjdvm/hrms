"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { unlinkPosAccount } from "@/app/(hrms)/performance/actions";
import type { LinkedAccount, LinkedEmployee } from "@/lib/performance-links";
import { NOTE_MAX_LENGTH, UNLINK_AUDIT_NOTE, UNLINK_REASONS, UNLINK_WARNING, unlinkReady, unlinkSubtitle } from "@/lib/performance-pos-links-terms";
import { cn } from "@/lib/utils";
import { Callout, DialogActions, DialogBody, DialogFrame, FieldLabel, Help } from "./dialog-frame";

export type UnlinkTarget = { person: LinkedEmployee; account: LinkedAccount };

const FIELD = "w-full rounded-lg border border-[#e4e4e7] bg-white px-[12px] py-[9px] text-sm shadow-none";

function Form({ target, onClose, onUnlinked }: { target: UnlinkTarget; onClose: () => void; onUnlinked: () => void }) {
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const ready = unlinkReady(reason, note);
  const other = reason === "Other";

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!ready || pending) return;
    start(async () => {
      const result = await unlinkPosAccount(target.account.linkId, reason, note);
      if (!result.ok) { setFailure(result.error); return; }
      toast.success("POS account unlinked");
      onUnlinked();
      onClose();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <Callout>{UNLINK_WARNING}</Callout>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="unlink-reason" required>Reason</FieldLabel>
          <select id="unlink-reason" value={reason} disabled={pending} aria-required onChange={(event) => { setReason(event.target.value); setFailure(undefined); }} className={cn(FIELD, "h-[40px]")}>
            <option value="">Choose a reason</option>
            {UNLINK_REASONS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="unlink-note">Note <span className="font-normal text-[#6e6680]">(required for Other)</span></FieldLabel>
          <Textarea id="unlink-note" rows={3} value={note} disabled={pending} maxLength={NOTE_MAX_LENGTH} aria-required={other} aria-describedby="unlink-note-help"
            placeholder="Add a short note for the audit log" onChange={(event) => { setNote(event.target.value); setFailure(undefined); }} className={cn(FIELD, "h-[72px]")} />
          <Help id="unlink-note-help">Up to {NOTE_MAX_LENGTH} characters.</Help>
        </div>
        <p className="text-xs text-[#6e6680]">{UNLINK_AUDIT_NOTE}</p>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit="Unlink account" canSubmit={ready} pending={pending} note="Not unlinked yet" danger />
    </form>
  );
}

/** The Unlink dialog: a reason is required (and a note for Other), and Unlink account stays disabled until the form is valid. Nothing is changed before that button is pressed. */
export function UnlinkPosAccountDialog({ target, onClose, onUnlinked }: { target: UnlinkTarget | null; onClose: () => void; onUnlinked: () => void }) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {target && (
        <DialogFrame title="Unlink POS account" description={unlinkSubtitle(target.person, target.account)}>
          <Form key={target.account.linkId} target={target} onClose={onClose} onUnlinked={onUnlinked} />
        </DialogFrame>
      )}
    </Dialog>
  );
}
