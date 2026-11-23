"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { linkPosCashier } from "@/app/(hrms)/performance/actions";
import type { LinkedEmployee, PosAccountNeedingLink } from "@/lib/performance";
import { pesos } from "@/lib/performance-pos-import-terms";
import { checkAddForm, filterAccounts, monthsCovered, REASON_OPTIONS } from "@/lib/performance-pos-links-form";
import { accountName, linkedLine } from "@/lib/performance-pos-links-terms";
import { cn } from "@/lib/utils";
import { BOX, Callout, DialogActions, DialogBody, DialogFrame, FieldLabel, Help } from "./dialog-frame";
import { accountMeta, accountTitle } from "./link-cashier-dialog";

function Form({ person, accounts, onAdded }: { person: LinkedEmployee; accounts: PosAccountNeedingLink[]; onAdded: () => void }) {
  const [search, setSearch] = useState("");
  const [chosen, setChosen] = useState<PosAccountNeedingLink | null>(null);
  const [reason, setReason] = useState("");
  const [failure, setFailure] = useState<string>();
  const [pending, start] = useTransition();
  const matches = useMemo(() => filterAccounts(accounts, search), [accounts, search]);
  const state = checkAddForm(chosen, reason);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!state.canSubmit || chosen === null || pending) return;
    start(async () => {
      const result = await linkPosCashier(chosen.portalUserId, person.employeeId, state.reason);
      if (!result.ok) { setFailure(result.error); return; }
      toast.success(`POS account added for ${person.name}`);
      onAdded();
    });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col">
      <DialogBody>
        <div className="flex flex-col gap-[4px] rounded-lg bg-[#f4f1f7] px-[14px] py-[12px]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#5a5368]">Employee</p>
          <p className="text-base font-semibold text-foreground">{person.name}</p>
          <p className="text-[13px] text-zinc-500">{person.employeeNumber} · {person.position}</p>
          <ul aria-label="Current accounts" className="mt-[4px] flex flex-col gap-[2px]">
            {person.accounts.map((account) => (
              <li key={account.linkId} className="text-[13px] text-zinc-600">
                <span className="font-medium text-foreground">{accountName(account)}</span> · {account.branch ?? "No sales yet"} · {linkedLine(account)} · {account.current ? "Current" : "Earlier"}
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="add-account-search" required>POS account</FieldLabel>
          <Input id="add-account-search" value={search} disabled={pending} autoComplete="off" placeholder="Search by name, staff number or branch" onChange={(event) => setSearch(event.target.value)} className={BOX} />
          <ul role="listbox" aria-label="POS accounts not linked to anyone" className="overflow-hidden rounded-lg border border-[#e4e4e7] bg-white">
            {accounts.length === 0 && <li className="px-[14px] py-[12px] text-sm text-zinc-500">No POS account with sales is waiting to be linked.</li>}
            {accounts.length > 0 && matches.length === 0 && <li className="px-[14px] py-[12px] text-sm text-zinc-500">No POS account matches.</li>}
            {matches.map((account) => (
              <li key={account.portalUserId} role="presentation" className="border-b border-[#efebf4] last:border-0">
                <button type="button" role="option" aria-selected={chosen?.portalUserId === account.portalUserId} disabled={pending} onClick={() => { setChosen(account); setFailure(undefined); }}
                  className={cn("flex w-full items-center gap-[12px] px-[14px] py-[10px] text-left hover:bg-[#f4f1f7]", chosen?.portalUserId === account.portalUserId && "bg-[#efe6f8]")}>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium text-foreground">{accountTitle(account)}</span>
                    <span className="truncate text-xs text-zinc-500">{accountMeta(account) || "No branch yet"}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end">
                    <span className="text-sm font-medium text-foreground">{pesos(account.netSales)}</span>
                    <span className="text-xs text-zinc-500">{account.orders.toLocaleString("en-PH")} {account.orders === 1 ? "order" : "orders"} · {monthsCovered(account.from, account.to)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex flex-col gap-[6px]">
          <FieldLabel id="add-account-reason" required>Reason</FieldLabel>
          <select id="add-account-reason" value={reason} disabled={pending} onChange={(event) => { setReason(event.target.value); setFailure(undefined); }} aria-describedby="add-account-reason-help" aria-required
            className={cn(BOX, "appearance-none border bg-white", reason === "" && "text-[#a1a1aa]")}>
            <option value="">Choose a reason</option>
            {REASON_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
          </select>
          <Help id="add-account-reason-help" error={null}>Needed because {person.name} already has a POS account.</Help>
        </div>

        <p className="text-xs text-zinc-500">Sales from all of an employee’s accounts add up, so past months stay counted. A POS account can belong to only one employee. The link is recorded in the audit log with who made it, when and why.</p>
        {failure && <Callout alert>{failure}</Callout>}
      </DialogBody>
      <DialogActions submit="Add account" canSubmit={state.canSubmit} pending={pending} note="Not added yet" />
    </form>
  );
}

/**
 * The Add account dialog, opened from an employee's "+ Add account" in the Linked tab. The employee is shown read-only with their accounts; the picker lists only
 * POS accounts that are not linked to anyone; the reason "New Portal account for the same person" is required. The server links it with the same rules as Link cashier.
 */
export function AddPosAccountDialog({ person, accounts, onClose, onAdded }: { person: LinkedEmployee | null; accounts: PosAccountNeedingLink[]; onClose: () => void; onAdded: () => void }) {
  return (
    <Dialog open={person !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogFrame title="Add POS account" description={person ? `Another POS account for ${person.name}` : ""}>
        {person && <Form key={person.employeeId} person={person} accounts={accounts} onAdded={onAdded} />}
      </DialogFrame>
    </Dialog>
  );
}
