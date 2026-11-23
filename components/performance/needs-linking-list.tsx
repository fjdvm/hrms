import { Button } from "@/components/ui/button";
import type { UnlinkedPosAccount } from "@/lib/performance-links";
import { accountName, accountSource, ordersLine } from "@/lib/performance-pos-links-terms";
import { pesos } from "@/lib/performance-top-sales-view";

/** The Needs linking tab: each POS account that has sales but no employee, by Portal name, with branch, net sales, orders and a Link button. */
export function NeedsLinkingList({ accounts, onLink }: { accounts: UnlinkedPosAccount[]; onLink: (account: UnlinkedPosAccount) => void }) {
  if (accounts.length === 0) return <p className="py-[28px] text-center text-sm text-[#6e6680]">Every POS account with sales is linked to an employee.</p>;
  return (
    <ul className="flex max-h-[calc(100vh-300px)] flex-col overflow-y-auto">
      {accounts.map((account) => (
        <li key={account.portalUserId} className="flex items-center gap-[12px] border-b border-[#efebf4] py-[10px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <p className="truncate text-sm font-semibold text-[#1f1a2e]">{accountName(account)}</p>
            <p className="text-xs text-[#6e6680]">{accountSource(account)}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-[2px]">
            <p className="text-sm font-semibold text-[#1f1a2e]">{pesos(account.netSales)}</p>
            <p className="text-xs text-[#6e6680]">{ordersLine(account)}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => onLink(account)} aria-label={`Link ${accountName(account)}`} className="h-auto rounded-lg border-[#e4e4e7] px-[12px] py-[6px] shadow-none">Link</Button>
        </li>
      ))}
    </ul>
  );
}
