"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { loadPosLinks } from "@/app/(hrms)/performance/actions";
import type { LinkedEmployee, UnlinkedPosAccount } from "@/lib/performance-links";
import { needsLinkingLabel } from "@/lib/performance-pos-links-terms";
import { Callout, DialogBody, DialogFrame, PILL, PILL_ON } from "./dialog-frame";
import { LinkPosAccountDialog } from "./link-pos-account-dialog";
import { NeedsLinkingList } from "./needs-linking-list";
import { PosLinksList } from "./pos-links-list";
import { UnlinkPosAccountDialog, type UnlinkTarget } from "./unlink-pos-account-dialog";

type Load = { name: "loading" } | { name: "ready"; employees: LinkedEmployee[]; unlinked: UnlinkedPosAccount[] } | { name: "failed"; error: string };
type Tab = "needs" | "linked";

const Loading = () => (
  <div className="flex flex-col gap-[14px]" aria-busy="true" aria-label="Loading linked accounts">
    {[0, 1, 2].map((i) => <div key={i} className="flex flex-col gap-[8px] border-b border-[#efebf4] pb-[12px]"><Skeleton className="h-[14px] w-[260px]" /><Skeleton className="ml-[16px] h-[28px] w-[520px] max-w-full" /></div>)}
  </div>
);

/**
 * The POS cashier links dialog, opened from "Manage POS links" in the Top sales footer note: the Needs linking tab (POS accounts with sales and no employee, each with
 * a Link button) and the Linked tab. It reads when it opens (a user action), after a link or unlink and on Try again; nothing is polled. Link and Unlink open their own
 * prompts. After either, the list is read again and the page is refreshed, so the Top sales card reflects it.
 */
export function PosLinksDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ name: "loading" });
  const [target, setTarget] = useState<UnlinkTarget | null>(null);
  const [linking, setLinking] = useState<UnlinkedPosAccount | null>(null);
  // Null until the person picks a tab: then it opens on Needs linking when something needs linking, else on Linked.
  const [picked, setPicked] = useState<Tab | null>(null);
  // A read that was closed or replaced finishes on its own, and its answer is dropped.
  const attempt = useRef(0);

  const read = async (quiet = false) => {
    const token = ++attempt.current;
    if (!quiet) setLoad({ name: "loading" });
    const result = await loadPosLinks();
    if (token !== attempt.current) return;
    setLoad(result.ok ? { name: "ready", employees: result.employees, unlinked: result.unlinked } : { name: "failed", error: result.error });
  };
  const change = (next: boolean) => {
    setOpen(next);
    if (next) { setPicked(null); void read(); } else { attempt.current += 1; setTarget(null); setLinking(null); }
  };

  const ready = load.name === "ready" ? load : null;
  const tab: Tab = picked ?? (ready && ready.unlinked.length > 0 ? "needs" : "linked");
  const changed = () => { void read(true); router.refresh(); };
  return (
    <>
      <Dialog open={open} onOpenChange={change}>
        <DialogTrigger asChild>
          <button type="button" className="shrink-0 text-xs font-semibold text-[#5b2a86] hover:underline">Manage POS links</button>
        </DialogTrigger>
        <DialogFrame wide title="POS cashier links" description="Which POS accounts count for which employee">
          <DialogBody>
            <div role="group" aria-label="Links" className="flex gap-xs">
              <button type="button" aria-pressed={tab === "needs"} onClick={() => setPicked("needs")} className={`${PILL} ${tab === "needs" ? PILL_ON : ""}`}>{ready ? needsLinkingLabel(ready.unlinked.length) : "Needs linking"}</button>
              <button type="button" aria-pressed={tab === "linked"} onClick={() => setPicked("linked")} className={`${PILL} ${tab === "linked" ? PILL_ON : ""}`}>Linked{ready ? ` ${ready.employees.length}` : ""}</button>
            </div>
            {load.name === "loading" && <Loading />}
            {load.name === "failed" && (
              <Callout alert>
                {load.error}{" "}
                <button type="button" onClick={() => void read()} className="font-semibold underline">Try again</button>
              </Callout>
            )}
            {ready && tab === "needs" && <NeedsLinkingList accounts={ready.unlinked} onLink={setLinking} />}
            {ready && tab === "linked" && <PosLinksList employees={ready.employees} onUnlink={setTarget} />}
          </DialogBody>
        </DialogFrame>
      </Dialog>
      <UnlinkPosAccountDialog target={target} onClose={() => setTarget(null)} onUnlinked={changed} />
      <LinkPosAccountDialog account={linking} count={ready?.unlinked.length ?? 0} onClose={() => setLinking(null)} onLinked={changed} />
    </>
  );
}
