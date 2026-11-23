"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogTrigger } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { loadPosLinks } from "@/app/(hrms)/performance/actions";
import type { LinkedEmployee } from "@/lib/performance-links";
import { Callout, DialogBody, DialogFrame, PILL, PILL_ON } from "./dialog-frame";
import { PosLinksList } from "./pos-links-list";
import { UnlinkPosAccountDialog, type UnlinkTarget } from "./unlink-pos-account-dialog";

type Load = { name: "loading" } | { name: "ready"; employees: LinkedEmployee[] } | { name: "failed"; error: string };

const Loading = () => (
  <div className="flex flex-col gap-[14px]" aria-busy="true" aria-label="Loading linked accounts">
    {[0, 1, 2].map((i) => <div key={i} className="flex flex-col gap-[8px] border-b border-[#efebf4] pb-[12px]"><Skeleton className="h-[14px] w-[260px]" /><Skeleton className="ml-[16px] h-[28px] w-[520px] max-w-full" /></div>)}
  </div>
);

/**
 * The POS cashier links dialog, opened from "Manage POS links" in the Top sales footer note. It reads the linked employees when it opens (a user action) and
 * again after an unlink or Try again; nothing is polled. Unlink opens its own prompt. After an unlink the list is read again and the page is refreshed, so the
 * Top sales card reflects it.
 */
export function PosLinksDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [load, setLoad] = useState<Load>({ name: "loading" });
  const [target, setTarget] = useState<UnlinkTarget | null>(null);
  // A read that was closed or replaced finishes on its own, and its answer is dropped.
  const attempt = useRef(0);

  const read = async (quiet = false) => {
    const token = ++attempt.current;
    if (!quiet) setLoad({ name: "loading" });
    const result = await loadPosLinks();
    if (token !== attempt.current) return;
    setLoad(result.ok ? { name: "ready", employees: result.employees } : { name: "failed", error: result.error });
  };
  const change = (next: boolean) => {
    setOpen(next);
    if (next) void read(); else { attempt.current += 1; setTarget(null); }
  };

  const count = load.name === "ready" ? load.employees.length : null;
  return (
    <>
      <Dialog open={open} onOpenChange={change}>
        <DialogTrigger asChild>
          <button type="button" className="shrink-0 text-xs font-semibold text-[#5b2a86] hover:underline">Manage POS links</button>
        </DialogTrigger>
        <DialogFrame wide title="POS cashier links" description="Which POS accounts count for which employee">
          <DialogBody>
            <div role="group" aria-label="Links" className="flex gap-xs">
              <span aria-current="true" className={`${PILL} ${PILL_ON}`}>Linked{count === null ? "" : ` ${count}`}</span>
            </div>
            {load.name === "loading" && <Loading />}
            {load.name === "failed" && (
              <Callout alert>
                {load.error}{" "}
                <button type="button" onClick={() => void read()} className="font-semibold underline">Try again</button>
              </Callout>
            )}
            {load.name === "ready" && <PosLinksList employees={load.employees} onUnlink={setTarget} />}
          </DialogBody>
        </DialogFrame>
      </Dialog>
      <UnlinkPosAccountDialog target={target} onClose={() => setTarget(null)} onUnlinked={() => { void read(true); router.refresh(); }} />
    </>
  );
}
