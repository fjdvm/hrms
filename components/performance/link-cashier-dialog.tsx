"use client";

import { useMemo, useState, useTransition } from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { linkPosCashier } from "@/app/(hrms)/performance/actions";
import type { LinkCandidate, PosAccountNeedingLink } from "@/lib/performance";
import { pesos } from "@/lib/performance-pos-import-terms";
import { accountsTag, canChoose, checkLinkForm, disabledReason, filterCandidates, monthsCovered, REASON_OPTIONS } from "@/lib/performance-pos-links-form";
import { cn } from "@/lib/utils";
import { BOX, Callout, DialogActions, DialogBody, DialogFrame, FieldLabel, Help } from "./dialog-frame";

/** The account's name as HR recognises it: the Portal's, or the staff number alone when the Portal has none. */
export const accountTitle = (account: PosAccountNeedingLink) => account.name ?? (account.staffNumber ? `Staff no. ${account.staffNumber}` : "POS account");
/** The line under it: where it sold and which staff number it is. */
export const accountMeta = (account: PosAccountNeedingLink) => [account.name ? "Portal account" : null, account.branch, account.name && account.staffNumber ? `staff no. ${account.staffNumber}` : null].filter(Boolean).join(" · ");

function Form({ account, candidates, onLinked }: { account: PosAccountNeedingLink; candidates: LinkCandidate[]; onLinked: () => void }) {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<LinkCandidate | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const matches = useMemo(() => filterCandidates(candidates, chosen ? "" : search), [candidates, chosen, search]);
  const state = checkLinkForm(chosen, reason);

  const choose = (candidate: LinkCandidate) => {
    if (!canChoose(candidate)) return;
    setChosen(candidate); setSearch(candidate.name); setListOpen(false); setReason(""); setFailure(undefined);
  };
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!state.canSubmit || chosen === null || pending) return;
    start(async () => {
      const result = await linkPosCashier(account.portalUserId, chosen.id, state.reason);
      if (!result.ok) { setFailure(result.error); return; }
      toast.success(`POS account linked to ${chosen.name}`);
      onLinked();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <div className="flex items-start gap-[12px] rounded-lg bg-[#f4f1f7] px-[14px] py-[12px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5a5368]">POS account</p>
            <p className="text-base font-semibold text-foreground">{accountTitle(account)}</p>
            <p className="text-[13px] text-zinc-500">{accountMeta(account)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-[2px]">
            <p className="text-base font-semibold text-foreground">{pesos(account.netSales)}</p>
            <p className="text-[13px] text-zinc-500">{account.orders.toLocaleString("en-PH")} {account.orders === 1 ? "order" : "orders"} · {monthsCovered(account.from, account.to)}</p>
          </div>
        </div>

        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="link-employee" required>Employee</FieldLabel>
          <div className="relative">
            <Input id="link-employee" role="combobox" aria-expanded={listOpen} aria-controls="link-employee-list" aria-autocomplete="list" autoComplete="off" value={search} disabled={pending} placeholder="Search by name, number or position"
              onFocus={() => setListOpen(true)} onChange={(event) => { setSearch(event.target.value); setChosen(null); setListOpen(true); setFailure(undefined); }}
              className={cn(BOX, "pr-[36px]", listOpen && "border-[#5b2a86]")} />
            <ChevronDown aria-hidden className="pointer-events-none absolute right-[12px] top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          </div>
          {listOpen && (
            <ul id="link-employee-list" role="listbox" aria-label="Employees" className="overflow-hidden rounded-lg border border-[#e4e4e7] bg-white">
              {matches.length === 0 && <li className="px-[14px] py-[12px] text-sm text-zinc-500">No employee matches.</li>}
              {matches.map((candidate) => {
                const why = disabledReason(candidate);
                const tag = accountsTag(candidate);
                return (
                  <li key={candidate.id} role="presentation" className="border-b border-[#efebf4] last:border-0">
                    <button type="button" role="option" aria-selected={chosen?.id === candidate.id} aria-disabled={why !== null || undefined} onClick={() => choose(candidate)}
                      className={cn("flex w-full items-center gap-[12px] px-[14px] py-[10px] text-left", why ? "cursor-not-allowed text-zinc-400" : "hover:bg-[#f4f1f7]", chosen?.id === candidate.id && "bg-[#efe6f8]")}>
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className={cn("text-sm font-medium", why ? "text-zinc-400" : "text-foreground")}>{candidate.name}</span>
                        <span className={cn("text-xs", why ? "text-zinc-400" : "text-zinc-500")}>{candidate.employeeNumber} · {candidate.position} · {candidate.branch}</span>
                      </span>
                      {why ? <span className="shrink-0 rounded-full bg-[#f4f4f5] px-[10px] py-[3px] text-xs text-zinc-400">{why}</span>
                        : tag && <span className="shrink-0 text-xs font-semibold text-[#5b2a86]">{tag}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {state.reasonNeeded && chosen && (
          <div className="flex flex-col gap-[6px]">
            <FieldLabel id="link-reason" required>Reason</FieldLabel>
            <select id="link-reason" value={reason} disabled={pending} onChange={(event) => { setReason(event.target.value); setFailure(undefined); }} aria-describedby="link-reason-help" aria-required
              className={cn(BOX, "appearance-none border bg-white", reason === "" && "text-[#a1a1aa]")}>
              <option value="">Choose a reason</option>
              {REASON_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <Help id="link-reason-help" error={state.reasonError && reason === "" ? null : state.reasonError}>Needed because {chosen.name} already has a POS account. It is shown only when the employee already has one.</Help>
          </div>
        )}

        <p className="text-xs text-zinc-500">Sales from all of an employee’s accounts add up, so past months stay counted. A POS account can belong to only one employee. The link is recorded in the audit log with who made it, when and why.</p>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit="Link cashier" canSubmit={state.canSubmit} pending={pending} note="Not linked yet" />
    </form>
  );
}

/** The Link POS cashier dialog: one POS account, the Employee it counts for (a cashier only), and the reason a second account needs. Link cashier stays disabled until it is valid. */
export function LinkCashierDialog({ account, candidates, total, onClose, onLinked }: { account: PosAccountNeedingLink | null; candidates: LinkCandidate[]; total: number; onClose: () => void; onLinked: () => void }) {
  return (
    <Dialog open={account !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogFrame title="Link POS cashier" description={`${total} POS ${total === 1 ? "account has" : "accounts have"} sales but ${total === 1 ? "is" : "are"} not linked to an employee`}>
        {account && <Form key={account.portalUserId} account={account} candidates={candidates} onLinked={onLinked} />}
      </DialogFrame>
    </Dialog>
  );
}
