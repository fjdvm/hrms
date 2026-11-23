import { Button } from "@/components/ui/button";
import type { PosAccountNeedingLink } from "@/lib/performance";
import { pesos } from "@/lib/performance-pos-import-terms";
import { accountMeta, accountTitle } from "./link-cashier-dialog";

/** The Needs linking list: each POS account with sales and no employee, by the Portal's name (or staff number and branch alone), with its net sales and orders and a Link button. */
export function PosNeedsLinkingList({ accounts, onLink }: { accounts: PosAccountNeedingLink[]; onLink: (account: PosAccountNeedingLink) => void }) {
  if (accounts.length === 0) return <p className="py-[24px] text-center text-sm text-zinc-500">Every POS account with sales is linked to an employee.</p>;
  return (
    <ul className="flex max-h-[calc(100vh-300px)] flex-col overflow-y-auto">
      {accounts.map((account) => (
        <li key={account.portalUserId} className="flex items-center gap-[12px] border-b border-[#efebf4] py-[11px] last:border-0">
          <div className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="truncate text-sm font-medium text-foreground">{accountTitle(account)}</span>
            <span className="truncate text-xs text-zinc-500">{accountMeta(account) || "No branch yet"}</span>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-px">
            <span className="text-sm font-medium text-foreground">{pesos(account.netSales)}</span>
            <span className="text-xs text-zinc-500">{account.orders.toLocaleString("en-PH")} {account.orders === 1 ? "order" : "orders"}</span>
          </div>
          <Button type="button" variant="outline" aria-label={`Link ${accountTitle(account)}`} onClick={() => onLink(account)} className="h-auto rounded-lg border-zinc-200 px-[14px] py-[8px] shadow-none">Link</Button>
        </li>
      ))}
    </ul>
  );
}
