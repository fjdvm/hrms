import { Button } from "@/components/ui/button";
import type { LinkedAccount, LinkedEmployee } from "@/lib/performance-links";
import { accountName, employeeLine, linkedLine } from "@/lib/performance-pos-links-terms";
import { cn } from "@/lib/utils";

/** One account line: name, branch and who linked it when, the Current or Earlier tag, and its own Unlink button. */
function AccountRow({ account, person, onUnlink }: { account: LinkedAccount; person: LinkedEmployee; onUnlink: () => void }) {
  return (
    <li className="flex items-center gap-[12px] py-[7px] pl-[16px]">
      <p className="w-[214px] shrink-0 truncate text-sm text-[#1f1a2e]">{accountName(account)}</p>
      <div className="flex w-[200px] shrink-0 flex-col gap-px">
        <p className="text-sm text-[#1f1a2e]">{account.branch ?? "No sales yet"}</p>
        <p className="text-xs text-[#6e6680]">{linkedLine(account)}</p>
      </div>
      <span className="w-[110px] shrink-0">
        <span className={cn("inline-flex rounded-full px-[8px] py-[3px] text-[11px] font-semibold", account.current ? "bg-[#e3f4e8] text-[#226b3f]" : "bg-[#efebf4] text-[#6e6680]")}>{account.current ? "Current" : "Earlier"}</span>
      </span>
      <div className="flex flex-1 justify-end">
        <Button type="button" variant="outline" onClick={onUnlink} aria-label={`Unlink ${accountName(account)} from ${person.name}`} className="h-auto rounded-lg border-[#e4e4e7] px-[12px] py-[6px] shadow-none">Unlink</Button>
      </div>
    </li>
  );
}

/** The Linked list: every linked Employee with all their POS accounts, and an Add account link per Employee (disabled until its own dialog ticket gives it something to open). */
export function PosLinksList({ employees, onUnlink, onAddAccount }: { employees: LinkedEmployee[]; onUnlink: (target: { person: LinkedEmployee; account: LinkedAccount }) => void; onAddAccount?: (person: LinkedEmployee) => void }) {
  if (employees.length === 0) return <p className="py-[28px] text-center text-sm text-[#6e6680]">No POS accounts are linked to an employee yet.</p>;
  return (
    <div className="flex max-h-[calc(100vh-300px)] flex-col overflow-y-auto">
      {employees.map((person) => (
        <section key={person.employeeId} aria-label={person.name} className="flex flex-col border-b border-[#efebf4] py-[10px]">
          <div className="flex items-center gap-[10px]">
            <h3 className="text-sm font-semibold text-[#5b2a86]">{person.name}</h3>
            <p className="text-xs text-[#6e6680]">{employeeLine(person)}</p>
            <span className="flex-1" />
            <button type="button" disabled={!onAddAccount} onClick={() => onAddAccount?.(person)} aria-label={`Add account for ${person.name}`}
              title={onAddAccount ? undefined : "Adding an account comes with the Add account dialog"} className="text-[13px] font-semibold text-[#5b2a86] hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:no-underline">+ Add account</button>
          </div>
          <ul>{person.accounts.map((account) => <AccountRow key={account.linkId} account={account} person={person} onUnlink={() => onUnlink({ person, account })} />)}</ul>
        </section>
      ))}
    </div>
  );
}
