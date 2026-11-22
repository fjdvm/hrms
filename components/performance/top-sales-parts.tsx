import type { TopSales, TopSalesRow } from "@/lib/performance-top-sales";
import { initialsOf, perPresentDay, pesos, presentDaysText, soldAtText } from "@/lib/performance-top-sales-view";
import { cn } from "@/lib/utils";

const TOP_PER_BRANCH = 2;
const TH = "text-xs font-medium text-[#6e6680]";

/** The overall top seller: name and number, net sales, and the three figures under it. */
export function TopSellerPanel({ data }: { data: TopSales }) {
  const seller = data.overall[0];
  const tied = data.overall.length - 1;
  const day = perPresentDay(seller);
  return (
    <section aria-label="Top seller" className="flex w-[300px] max-w-full shrink-0 flex-col gap-[14px] self-stretch rounded-xl bg-[#efe6f8] p-[18px]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.66px] text-[#5b2a86]">Top seller · all branches</p>
      <div className="flex items-center gap-[12px]">
        <span aria-hidden className="flex size-[44px] shrink-0 items-center justify-center rounded-full bg-[#5b2a86] text-sm font-semibold text-white">{initialsOf(seller.name)}</span>
        <div className="flex min-w-0 flex-col gap-[2px]">
          <p className="truncate text-lg font-semibold text-[#1f1a2e]">{seller.name}</p>
          <p className="text-xs text-[#6e6680]">{seller.employeeNumber}</p>
        </div>
      </div>
      <p className="flex items-end gap-[8px]">
        <span className="text-[28px] font-bold leading-none text-[#1f1a2e]">{pesos(seller.netSales)}</span>
        <span className="text-[13px] font-medium text-[#6e6680]">net sales</span>
      </p>
      <p className="text-xs font-medium text-[#6e6680]">{soldAtText(data, seller)}{tied > 0 && ` · tied with ${tied} other${tied === 1 ? "" : "s"}`}</p>
      <div className="h-px bg-[#e6e1ee]" />
      <dl className="flex gap-lg">
        <Stat value={String(seller.orders)} label="orders" />
        <Stat value={String(seller.presentDays)} label="present days" />
        <Stat value={day === null ? "—" : pesos(day)} label="per present day" />
      </dl>
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return <div className="flex flex-col gap-[2px]"><dd className="order-1 text-base font-semibold text-[#1f1a2e]">{value}</dd><dt className="order-2 text-xs text-[#6e6680]">{label}</dt></div>;
}

function Rank({ rank }: { rank: number }) {
  return (
    <span className={cn("flex size-[22px] shrink-0 items-center justify-center rounded-full text-xs font-semibold", rank === 1 ? "bg-[#5b2a86] text-white" : "bg-[#efe6f8] text-[#5b2a86]")}>{rank}</span>
  );
}

function CashierRow({ row, branch, count, first }: { row: TopSalesRow; branch: string; count: number; first: boolean }) {
  return (
    <tr className="border-b border-[#efebf4] align-middle">
      <td className="w-[150px] py-[11px] pr-2">
        {first && <><p className="text-sm font-medium text-[#1f1a2e]">{branch}</p><p className="text-xs text-[#6e6680]">{count} {count === 1 ? "cashier" : "cashiers"}</p></>}
      </td>
      <td className="w-[250px] py-[11px] pr-2">
        <div className="flex items-center gap-[10px]">
          <Rank rank={row.rank} />
          <div className="flex flex-col"><span className="text-sm font-medium text-primary">{row.name}</span><span className="text-xs text-[#6e6680]">{row.employeeNumber}</span></div>
        </div>
      </td>
      <td className="w-[130px] py-[11px] pr-2 text-sm font-medium text-[#1f1a2e]">{pesos(row.netSales)}</td>
      <td className="w-[80px] py-[11px] pr-2 text-sm font-medium text-[#1f1a2e]">{row.orders}</td>
      <td className={cn("py-[11px] text-sm", row.presentDays === 0 ? "text-[#6e6680]" : "text-[#1f1a2e]")}>{presentDaysText(row.presentDays)}</td>
    </tr>
  );
}

/** The top two cashiers of every branch. Rows keep the rank the read model gave them, so a tie shows the same rank twice. */
export function TopByBranchTable({ data }: { data: TopSales }) {
  return (
    <section aria-label="Top by branch" className="flex min-w-0 flex-1 flex-col gap-[10px] overflow-x-auto">
      <p className="text-[13px] font-medium text-[#6e6680]">Top by branch · top {TOP_PER_BRANCH} cashiers</p>
      <table className="w-full min-w-[640px] table-fixed text-left">
        <thead>
          <tr className="border-b border-[#efebf4]">
            <th scope="col" className={`${TH} w-[150px] py-[6px] text-left`}>Branch</th>
            <th scope="col" className={`${TH} w-[250px] py-[6px] text-left`}>Cashier</th>
            <th scope="col" className={`${TH} w-[130px] py-[6px] text-left`}>Net sales</th>
            <th scope="col" className={`${TH} w-[80px] py-[6px] text-left`}>Orders</th>
            <th scope="col" className={`${TH} py-[6px] text-left`}>Present days</th>
          </tr>
        </thead>
        <tbody>
          {data.branches.flatMap((branch) =>
            branch.ranking.slice(0, TOP_PER_BRANCH).map((row, index) => (
              <CashierRow key={`${branch.branch}|${row.employeeId}`} row={row} branch={branch.branch} count={branch.ranking.length} first={index === 0} />
            )),
          )}
        </tbody>
      </table>
    </section>
  );
}

/** The body of a month that has sales: the top seller panel, a divider and the by-branch table. */
export function TopSalesBody({ data }: { data: TopSales }) {
  return (
    <div className="flex flex-wrap items-start gap-lg md:flex-nowrap">
      <TopSellerPanel data={data} />
      <div className="hidden w-px self-stretch bg-[#e6e1ee] md:block" />
      <TopByBranchTable data={data} />
    </div>
  );
}
