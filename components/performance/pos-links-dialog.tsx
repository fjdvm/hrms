"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { loadPosLinks } from "@/app/(hrms)/performance/actions";
import type { LinkCandidate, PosAccountNeedingLink } from "@/lib/performance";
import { pesos } from "@/lib/performance-pos-import-terms";
import { cn } from "@/lib/utils";
import { Callout, DialogBody, DialogFrame } from "./dialog-frame";
import { accountMeta, accountTitle, LinkCashierDialog } from "./link-cashier-dialog";
import { PosFooter } from "./import-pos-sales-views";

type Data = { accounts: PosAccountNeedingLink[]; candidates: LinkCandidate[] };
type Stage = { name: "loading" } | { name: "ready"; data: Data } | { name: "failed"; error: string };

/**
 * The POS cashier links dialog, opened from the Top sales footer note. Its Needs linking tab lists each POS account that has sales but no employee, by the
 * Portal's name (or staff number and branch alone), with its net sales and orders and a Link button that opens the Link POS cashier dialog. It reads when it
 * opens and again after a link is made (button presses only, never a timer), and a link refreshes the page so the Top sales card follows.
 */
export function PosLinksDialog({ children }: { children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>({ name: "loading" });
  const [linking, setLinking] = useState<PosAccountNeedingLink | null>(null);
  // An answer for a dialog that was closed meanwhile is dropped.
  const attempt = useRef(0);

  const load = async () => {
    const token = ++attempt.current;
    const result = await loadPosLinks();
    if (token !== attempt.current) return;
    setStage(result.ok ? { name: "ready", data: { accounts: result.accounts, candidates: result.candidates } } : { name: "failed", error: result.error });
  };
  const change = (next: boolean) => {
    setOpen(next);
    if (next) { setStage({ name: "loading" }); void load(); } else { attempt.current += 1; setLinking(null); }
  };
  const total = stage.name === "ready" ? stage.data.accounts.length : 0;

  return (
    <>
      <Dialog open={open} onOpenChange={change}>
        <DialogTrigger asChild>{children ?? <Button variant="outline" className="h-auto rounded-lg border-[#e6e1ee] px-[14px] py-[9px] shadow-none">POS cashier links</Button>}</DialogTrigger>
        <DialogFrame title="POS cashier links" description="Which POS accounts count for which employee">
          <DialogBody>
            <div role="tablist" aria-label="POS cashier links" className="flex gap-xs">
              <span role="tab" aria-selected className="rounded-lg bg-accent px-[14px] py-[8px] text-sm font-medium text-primary">Needs linking{stage.name === "ready" ? ` ${total}` : ""}</span>
            </div>
            {stage.name === "loading" && (
              <div role="status" aria-label="Loading POS accounts" className="flex flex-col gap-[14px]">
                {[0, 1, 2].map((row) => <div key={row} className="flex items-center gap-[12px]"><div className="flex flex-1 flex-col gap-[6px]"><Skeleton className="h-4 w-40" /><Skeleton className="h-3 w-56" /></div><Skeleton className="h-4 w-24" /><Skeleton className="h-9 w-16" /></div>)}
              </div>
            )}
            {stage.name === "failed" && (
              <div className="flex flex-col items-start gap-[10px]">
                <Callout alert>{stage.error}</Callout>
                <Button variant="outline" onClick={() => { setStage({ name: "loading" }); void load(); }} className="h-auto rounded-lg px-[14px] py-[9px] shadow-none">Try again</Button>
              </div>
            )}
            {stage.name === "ready" && (stage.data.accounts.length === 0 ? (
              <p className="py-[24px] text-center text-sm text-zinc-500">Every POS account with sales is linked to an employee.</p>
            ) : (
              <ul className="flex flex-col">
                {stage.data.accounts.map((account) => (
                  <li key={account.portalUserId} className="flex items-center gap-[12px] border-b border-[#efebf4] py-[11px] last:border-0">
                    <div className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className="truncate text-sm font-medium text-foreground">{accountTitle(account)}</span>
                      <span className="truncate text-xs text-zinc-500">{accountMeta(account) || "No branch yet"}</span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-px">
                      <span className="text-sm font-medium text-foreground">{pesos(account.netSales)}</span>
                      <span className="text-xs text-zinc-500">{account.orders.toLocaleString("en-PH")} {account.orders === 1 ? "order" : "orders"}</span>
                    </div>
                    <Button type="button" variant="outline" aria-label={`Link ${accountTitle(account)}`} onClick={() => setLinking(account)} className="h-auto rounded-lg border-zinc-200 px-[14px] py-[8px] shadow-none">Link</Button>
                  </li>
                ))}
              </ul>
            ))}
            <p className={cn("text-xs text-zinc-500")}>Linking is by hand. Until an account is linked to a cashier, its sales are saved but not ranked or scored.</p>
          </DialogBody>
          <PosFooter note={stage.name === "ready" ? `${total} ${total === 1 ? "account" : "accounts"}` : ""}><DialogClose asChild><Button type="button" variant="outline" className="h-auto rounded-lg border-zinc-200 px-[14px] py-[9px] shadow-none">Close</Button></DialogClose></PosFooter>
        </DialogFrame>
      </Dialog>
      <LinkCashierDialog account={linking} candidates={stage.name === "ready" ? stage.data.candidates : []} total={total} onClose={() => setLinking(null)}
        onLinked={() => { setLinking(null); void load(); }} />
    </>
  );
}
