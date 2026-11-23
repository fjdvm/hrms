"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { loadPosLinks } from "@/app/(hrms)/performance/actions";
import type { LinkCandidate, LinkedEmployee, PosAccountNeedingLink } from "@/lib/performance";
import { AddPosAccountDialog } from "./add-pos-account-dialog";
import { Callout, DialogBody, DialogFrame, PILL, PILL_ON } from "./dialog-frame";
import { LinkCashierDialog } from "./link-cashier-dialog";
import { PosLinksList } from "./pos-links-list";
import { PosNeedsLinkingList } from "./pos-needs-linking-list";
import { UnlinkPosAccountDialog, type UnlinkTarget } from "./unlink-pos-account-dialog";

type Data = { employees: LinkedEmployee[]; accounts: PosAccountNeedingLink[]; candidates: LinkCandidate[] };
type Load = { name: "loading" } | ({ name: "ready" } & Data) | { name: "failed"; error: string };
type Tab = "needs" | "linked";

const Loading = () => (
  <div className="flex flex-col gap-[14px]" aria-busy="true" aria-label="Loading linked accounts">
    {[0, 1, 2].map((i) => <div key={i} className="flex flex-col gap-[8px] border-b border-[#efebf4] pb-[12px]"><Skeleton className="h-[14px] w-[260px]" /><Skeleton className="ml-[16px] h-[28px] w-[520px] max-w-full" /></div>)}
  </div>
);

/**
 * The POS cashier links dialog, opened from "Manage POS links" in the Top sales footer note. Needs linking lists the POS accounts that have sales but no
 * employee, each with a Link button that opens the Link POS cashier dialog; Linked lists every linked employee with all their accounts, an Unlink button per
 * account and an Add account link per employee that opens the Add account dialog.
 * It opens on Needs linking when there is anything to link. It reads when it opens (a user action) and again after a link, an unlink or Try again; nothing is
 * polled. After a link or an unlink the page is refreshed, so the Top sales card reflects it.
 */
export function PosLinksDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ name: "loading" });
  const [tab, setTab] = useState<Tab>("linked");
  const [target, setTarget] = useState<UnlinkTarget | null>(null);
  const [linking, setLinking] = useState<PosAccountNeedingLink | null>(null);
  const [adding, setAdding] = useState<LinkedEmployee | null>(null);
  // A read that was closed or replaced finishes on its own, and its answer is dropped.
  const attempt = useRef(0);

  const read = async (quiet = false) => {
    const token = ++attempt.current;
    if (!quiet) setLoad({ name: "loading" });
    const result = await loadPosLinks();
    if (token !== attempt.current) return;
    if (!result.ok) { setLoad({ name: "failed", error: result.error }); return; }
    setLoad({ name: "ready", employees: result.employees, accounts: result.accounts, candidates: result.candidates });
    // A fresh read opens on Needs linking when there is something to link; a read after a change keeps the tab the Staff member is on.
    if (!quiet) setTab(result.accounts.length > 0 ? "needs" : "linked");
  };
  const change = (next: boolean) => {
    setOpen(next);
    if (next) void read(); else { attempt.current += 1; setTarget(null); setLinking(null); setAdding(null); }
  };
  const changed = () => { void read(true); router.refresh(); };

  const ready = load.name === "ready" ? load : null;
  const tabs: { id: Tab; label: string; count: number | null }[] = [
    { id: "needs", label: "Needs linking", count: ready ? ready.accounts.length : null },
    { id: "linked", label: "Linked", count: ready ? ready.employees.length : null },
  ];
  return (
    <>
      <Dialog open={open} onOpenChange={change}>
        <DialogTrigger asChild>
          <button type="button" className="shrink-0 text-xs font-semibold text-[#5b2a86] hover:underline">Manage POS links</button>
        </DialogTrigger>
        <DialogFrame wide title="POS cashier links" description="Which POS accounts count for which employee">
          <DialogBody>
            <div role="tablist" aria-label="Links" className="flex gap-xs">
              {tabs.map((entry) => (
                <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)} className={`${PILL} ${tab === entry.id ? PILL_ON : ""}`}>
                  {entry.label}{entry.count === null ? "" : ` ${entry.count}`}
                </button>
              ))}
            </div>
            {load.name === "loading" && <Loading />}
            {load.name === "failed" && (
              <Callout alert>
                {load.error}{" "}
                <button type="button" onClick={() => void read()} className="font-semibold underline">Try again</button>
              </Callout>
            )}
            {ready && tab === "needs" && <PosNeedsLinkingList accounts={ready.accounts} onLink={setLinking} />}
            {ready && tab === "linked" && <PosLinksList employees={ready.employees} onUnlink={setTarget} onAddAccount={setAdding} />}
          </DialogBody>
        </DialogFrame>
      </Dialog>
      <UnlinkPosAccountDialog target={target} onClose={() => setTarget(null)} onUnlinked={changed} />
      <AddPosAccountDialog person={adding} accounts={ready?.accounts ?? []} onClose={() => setAdding(null)} onAdded={() => { setAdding(null); changed(); }} />
      <LinkCashierDialog account={linking} candidates={ready?.candidates ?? []} total={ready?.accounts.length ?? 0} onClose={() => setLinking(null)} onLinked={() => { setLinking(null); changed(); }} />
    </>
  );
}
