"use client";

import Link from "next/link";
import { Check, Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DialogClose } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import type { ImportPreview } from "@/lib/performance";
import { attemptLabel, dayLabel, dayRangeLabel, monthLabel, pesos, type ImportMonth, type ImportProblem } from "@/lib/performance-pos-import-terms";
import { Callout, DialogBody, ERROR_COLOUR } from "./dialog-frame";

/** The pieces of the Import POS sales dialog, one per state in the Figma frames: Ready, Reading, Preview and the two errors. */

const PANEL = "flex flex-col gap-[8px] rounded-lg bg-[#f7f5fa] px-[14px] py-[12px]";
const BUTTON = "h-auto rounded-lg px-[14px] py-[9px] shadow-none";

/** The footer: a note on the left and the buttons on the right, as in the Figma frames. */
export function PosFooter({ note, children }: { note: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-sm border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
      <p className="mr-auto text-xs text-zinc-500">{note}</p>
      {children}
    </div>
  );
}
export const CancelButton = ({ children = "Cancel", onClick, disabled }: { children?: string; onClick?: () => void; disabled?: boolean }) => (
  <DialogClose asChild><Button type="button" variant="outline" disabled={disabled} onClick={onClick} className={`${BUTTON} border-zinc-200`}>{children}</Button></DialogClose>
);
export const PrimaryButton = ({ children, onClick, disabled, busy }: { children: string; onClick?: () => void; disabled?: boolean; busy?: boolean }) => (
  <Button type="button" disabled={disabled || busy} onClick={onClick} className={`${BUTTON} bg-[#5b2a86]`}>{busy && <Loader2 className="animate-spin" aria-hidden />}{children}</Button>
);

const MUTED = "text-[12px] text-[#6e6680]";

/** What will be read: the two months, with no month picker. */
export function ReadyBody({ months }: { months: ImportMonth[] }) {
  return (
    <DialogBody>
      <div className={PANEL}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.66px] text-[#6e6680]">What will be read</p>
        {months.map((month) => (
          <div key={month.key} className="flex flex-col gap-px">
            <p className="text-sm font-medium text-[#1f1a2e]">{month.label} · {month.current ? "current month" : "previous month"}</p>
            <p className={MUTED}>{month.current ? dayRangeLabel(month.from, month.to) : "Re-read every time: late voids and refunds can change a closed month"}</p>
          </div>
        ))}
      </div>
      <p className={MUTED}>Sales are read from the POS database with a read-only connection. Only totals per cashier, branch and day are kept: no customer data, order numbers or order lines.</p>
      <Callout>Nothing is saved until you confirm. A read takes a few seconds, and the POS database can take up to 30 seconds to wake up.</Callout>
    </DialogBody>
  );
}

/** The go-live date is not set (or not reached yet): nothing is read, and the way to fix it is named. */
export function NotLiveBody({ problem, goLiveDate }: { problem: Extract<ImportProblem, "go-live-not-set" | "go-live-not-reached">; goLiveDate: string | null }) {
  return (
    <DialogBody>
      <Callout alert>
        {problem === "go-live-not-set"
          ? "The POS go-live date is not set yet, so nothing is read. Importing stays blocked until it is set, so test data is never read."
          : `The POS go-live date is ${goLiveDate ? dayLabel(goLiveDate) : "later"}, after the months this import would read. There is nothing to read yet.`}
      </Callout>
      <p className={MUTED}>{problem === "go-live-not-set" ? "Set the go-live date in " : "Change the go-live date in "}<Link href="/performance/kpis" className="font-medium text-primary hover:underline">KPI setup</Link>.</p>
    </DialogBody>
  );
}

/** Reading: progress and a Cancel. The skeleton rows stand where the preview table will be. */
export function ReadingBody({ months }: { months: ImportMonth[] }) {
  return (
    <DialogBody>
      <div className={PANEL} role="status" aria-live="polite">
        <div className="flex items-center gap-[12px] px-[0px] py-[2px]">
          <Loader2 className="size-[20px] shrink-0 animate-spin text-[#5b2a86]" aria-hidden />
          <div className="flex flex-col gap-[2px]">
            <p className="text-sm font-semibold text-[#1f1a2e]">Reading the POS…</p>
            <p className={MUTED}>Checking the database, then reading {months.map((month) => month.label).join(" and ")}. Up to 30 seconds if it was asleep.</p>
          </div>
        </div>
        <div className="flex flex-col gap-[14px] px-[0px] pb-[4px] pt-[10px]" aria-hidden>
          {[0, 1].map((row) => (
            <div key={row} className="flex gap-[12px]"><Skeleton className="h-[12px] w-[140px]" /><Skeleton className="h-[12px] w-[100px]" /><Skeleton className="h-[12px] w-[90px]" /><Skeleton className="h-[12px] w-[120px]" /></div>
          ))}
        </div>
      </div>
      <p className={MUTED}>Nothing is saved until you confirm.</p>
    </DialogBody>
  );
}

const HEAD = "py-[6px] text-[12px] font-medium text-[#6e6680]";
const CELL = "py-[11px] text-sm text-[#1f1a2e]";

/** The preview: the database check, the months, the unlinked accounts by name, and how many orders were left out. */
export function PreviewBody({ preview }: { preview: ImportPreview }) {
  const { unlinked } = preview.accounts;
  const months = [...preview.months].sort((a, b) => b.month.localeCompare(a.month));
  const shown = unlinked.slice(0, 5);
  return (
    <DialogBody>
      <p className="flex items-center gap-[8px] text-[13px] font-medium text-[#1e6b3a]"><Check aria-hidden className="size-[16px] text-[#5b2a86]" />POS database check passed: every table and column HRMS reads was found.</p>
      <div className={PANEL}>
        <p className="text-[11px] font-semibold uppercase tracking-[0.66px] text-[#6e6680]">Preview</p>
        {months.length === 0 ? <p className="text-sm text-[#1f1a2e]">The POS has no sales for these months yet.</p> : (
          <table className="w-full border-collapse text-left">
            <thead><tr className="border-b border-[#efebf4]"><th className={HEAD}>Month</th><th className={HEAD}>Cashiers</th><th className={HEAD}>Orders</th><th className={HEAD}>Net sales</th></tr></thead>
            <tbody>
              {months.map((month) => (
                <tr key={month.month} className="border-b border-[#efebf4] last:border-0">
                  <td className={`${CELL} font-medium`}>{monthLabel(month.month)}</td>
                  <td className={CELL}>{month.cashiers} ({month.linkedCashiers} linked)</td>
                  <td className={CELL}>{month.orders.toLocaleString("en-PH")}</td>
                  <td className={CELL}>{pesos(month.netSales)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {preview.matched.length > 0 && <p className={MUTED}>Matched: {preview.matched.join(", ")}</p>}
      </div>
      {unlinked.length > 0 && (
        <Callout>
          {unlinked.length === 1 ? "1 POS cashier is not linked to an employee: " : `${unlinked.length} POS cashiers are not linked to an employee: `}
          {shown.map((account) => `${account.name ?? `Staff no. ${account.staffNumber ?? "unknown"}`} (${[account.name ? "Portal account" : null, account.branch, `${pesos(account.netSales)} net`].filter(Boolean).join(" · ")})`).join("; ")}
          {unlinked.length > shown.length ? `; and ${unlinked.length - shown.length} more` : ""}. Their sales are saved but not ranked or scored until the account is linked to an employee.
        </Callout>
      )}
      <p className={MUTED}>{preview.leftOut.orders > 0 ? `Left out of the totals: ${preview.leftOut.orders.toLocaleString("en-PH")} ${preview.leftOut.orders === 1 ? "order" : "orders"} with no cashier recorded (${pesos(preview.leftOut.grossSales)}).` : "Left out of the totals: no orders."}</p>
    </DialogBody>
  );
}

const RED = "flex items-start gap-[8px] rounded-lg bg-[#fbe6e0] px-[12px] py-[10px]";

/** POS unreachable, POS data changed or no connection set: their own messages, and nothing was saved. */
export function FailureBody({ kind, problems, at }: { kind: Exclude<ImportProblem, "go-live-not-set" | "go-live-not-reached">; problems: readonly string[]; at: string }) {
  const headline = kind === "pos-data-changed" ? "The POS data has changed. Nothing was saved." : kind === "pos-not-configured" ? "The POS connection is not set up. Nothing was saved." : "We couldn’t reach the POS. Nothing was saved.";
  return (
    <DialogBody>
      <div role="alert" className={RED}>
        <TriangleAlert aria-hidden className={`mt-[1px] size-[16px] shrink-0 ${ERROR_COLOUR}`} />
        <p className={`text-sm font-medium ${ERROR_COLOUR}`}>{headline}</p>
      </div>
      <div className={`${PANEL} gap-[10px] text-[13px] leading-[16px] text-[#6e6680]`}>
        {kind === "pos-unreachable" && <p>The POS database didn’t answer within 30 seconds, and the retry timed out too. It may still be waking up. Try again in a moment; if it keeps happening, tell the POS owner.</p>}
        {kind === "pos-not-configured" && <p>HRMS has no connection to the POS database yet. Ask whoever looks after the HRMS deployment to add the POS connection setting, then try again.</p>}
        {kind === "pos-data-changed" && (
          <>
            <p>HRMS checks the tables and columns it reads before every import. This time {problems.length > 1 ? "some were" : "one was"} missing or different, so it stopped instead of risking wrong figures.</p>
            {problems.length > 0 && <ul className="flex flex-col gap-[4px]">{problems.map((problem) => <li key={problem} className="rounded-lg border border-[#e6e1ee] bg-white px-[12px] py-[8px] text-[13px] text-[#1f1a2e]">{problem}</li>)}</ul>}
            <p>Ask the POS owner about their latest migration (they agreed to give notice before changing granted columns). Try again once it is fixed.</p>
          </>
        )}
        {kind === "pos-unreachable" && <p className="text-[12px]">Last attempt: {attemptLabel(at)}</p>}
      </div>
    </DialogBody>
  );
}
