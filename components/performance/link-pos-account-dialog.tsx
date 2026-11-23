"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { linkPosAccount, loadLinkCandidates } from "@/app/(hrms)/performance/actions";
import type { LinkCandidate, UnlinkedPosAccount } from "@/lib/performance-links";
import { accountName, accountSource, linkReady, LINK_NOTE, NEW_ACCOUNT_REASON, needsReason, ordersLine, reasonHelp, unlinkedSubtitle } from "@/lib/performance-pos-links-terms";
import { pesos } from "@/lib/performance-top-sales-view";
import { Callout, DialogActions, DialogBody, DialogFrame, FieldLabel, Help } from "./dialog-frame";
import { EmployeePicker } from "./employee-picker";

type Candidates = { name: "loading" } | { name: "ready"; list: LinkCandidate[] } | { name: "failed"; error: string };

function Form({ account, onClose, onLinked }: { account: UnlinkedPosAccount; onClose: () => void; onLinked: () => void }) {
  const [candidates, setCandidates] = useState<Candidates>({ name: "loading" });
  const [chosen, setChosen] = useState<LinkCandidate | null>(null);
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const show = (result: Awaited<ReturnType<typeof loadLinkCandidates>>) => setCandidates(result.ok ? { name: "ready", list: result.candidates } : { name: "failed", error: result.error });
  // Read once when the dialog opens (it is mounted fresh for each account); a dialog closed meanwhile drops the answer.
  useEffect(() => {
    let live = true;
    void loadLinkCandidates().then((result) => { if (live) show(result); });
    return () => { live = false; };
  }, []);
  const retry = async () => { setCandidates({ name: "loading" }); show(await loadLinkCandidates()); };

  const ready = linkReady(chosen, reason);
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!chosen || !ready || pending) return;
    start(async () => {
      const result = await linkPosAccount(chosen.employeeId, account.portalUserId, needsReason(chosen) ? reason : "");
      if (!result.ok) { setFailure(result.error); return; }
      toast.success("POS account linked");
      onLinked();
      onClose();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <div className="flex flex-col gap-[8px] rounded-lg bg-[#f7f5fa] px-[14px] py-[12px]">
          <p className="text-[11px] font-semibold uppercase tracking-[0.66px] text-[#6e6680]">POS account</p>
          <div className="flex items-center gap-[12px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]"><p className="text-[15px] font-semibold text-[#1f1a2e]">{accountName(account)}</p><p className="text-xs text-[#6e6680]">{accountSource(account)}</p></div>
            <div className="flex shrink-0 flex-col items-end gap-[2px]"><p className="text-[15px] font-semibold text-[#1f1a2e]">{pesos(account.netSales)}</p><p className="text-xs text-[#6e6680]">{ordersLine(account)}</p></div>
          </div>
        </div>
        {candidates.name === "loading" && <p aria-busy="true" className="text-sm text-[#6e6680]">Loading employees…</p>}
        {candidates.name === "failed" && <Callout alert>{candidates.error} <button type="button" onClick={() => void retry()} className="font-semibold underline">Try again</button></Callout>}
        {candidates.name === "ready" && <EmployeePicker candidates={candidates.list} selected={chosen} disabled={pending} onSelect={(candidate) => { setChosen(candidate); setReason(""); setFailure(undefined); }} />}
        {chosen && needsReason(chosen) && (
          <div className="flex flex-col gap-[6px]">
            <FieldLabel id="link-reason" required>Reason</FieldLabel>
            <select id="link-reason" value={reason} disabled={pending} aria-required aria-describedby="link-reason-help" onChange={(event) => { setReason(event.target.value); setFailure(undefined); }}
              className="h-[40px] w-full rounded-lg border border-[#e4e4e7] bg-white px-[12px] py-[9px] text-sm shadow-none">
              <option value="">Choose a reason</option>
              <option value={NEW_ACCOUNT_REASON}>{NEW_ACCOUNT_REASON}</option>
            </select>
            <Help id="link-reason-help">{reasonHelp(chosen)}</Help>
          </div>
        )}
        <p className="text-xs text-[#6e6680]">{LINK_NOTE}</p>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit="Link cashier" canSubmit={ready} pending={pending} note="Not linked yet" />
    </form>
  );
}

/** The Link cashier dialog, opened from a Needs linking row. The employee picker only lets a cashier be chosen, a reason is asked only when that Employee already holds an account, and Link cashier stays disabled until the form is valid. Nothing is saved before it is pressed. */
export function LinkPosAccountDialog({ account, count, onClose, onLinked }: { account: UnlinkedPosAccount | null; count: number; onClose: () => void; onLinked: () => void }) {
  return (
    <Dialog open={account !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {account && (
        <DialogFrame title="Link POS cashier" description={unlinkedSubtitle(count)}>
          <Form key={account.portalUserId} account={account} onClose={onClose} onLinked={onLinked} />
        </DialogFrame>
      )}
    </Dialog>
  );
}
