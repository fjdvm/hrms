import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

const COLUMNS: [string, string][] = [["Branch", "w-[150px]"], ["Cashier", "w-[250px]"], ["Net sales", "w-[130px]"], ["Orders", "w-[80px]"], ["Present days", "flex-1"]];

export const TOP_SALES_SUBTITLE = "Net sales (sales minus refunds) per cashier. Recognition only, not part of Evaluations.";

/** The card's header: its title, the recognition-only line and a place for the month selector. */
export function TopSalesHeader({ title, children }: { title: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-sm">
      <div className="flex min-w-0 flex-1 flex-col gap-[4px]">
        <p className="text-base font-semibold text-[#1f1a2e]">{title}</p>
        <p className="text-xs text-[#6e6680]">{TOP_SALES_SUBTITLE}</p>
      </div>
      {children}
    </div>
  );
}

/** The Top sales card while its data loads, as in the Figma Loading frame: the Suspense fallback and what loading.tsx shows. */
export function TopSalesSkeleton() {
  return (
    <Card className="flex flex-col gap-[16px] overflow-hidden rounded-xl p-[20px] shadow-none" aria-busy="true" aria-label="Loading top sales">
      <TopSalesHeader title="Top sales"><Skeleton className="h-[38px] w-[150px] rounded-lg" /></TopSalesHeader>
      <div className="flex items-start gap-lg">
        <div className="flex w-[300px] max-w-full shrink-0 flex-col gap-[14px] self-stretch rounded-xl border border-[#e6e1ee] p-[18px]">
          <Skeleton className="h-[10px] w-[150px]" />
          <div className="flex items-center gap-[12px]">
            <Skeleton className="size-[44px] rounded-full" />
            <div className="flex flex-col gap-[6px]"><Skeleton className="h-[14px] w-[140px]" /><Skeleton className="h-[10px] w-[100px]" /></div>
          </div>
          <Skeleton className="h-[28px] w-[210px]" />
          <Skeleton className="h-[10px] w-[120px]" />
          <div className="h-px bg-[#efebf4]" />
          <div className="flex gap-lg">
            {[36, 36, 60].map((width, i) => <div key={i} className="flex flex-col gap-[6px]"><Skeleton className="h-[16px]" style={{ width }} /><Skeleton className="h-[10px] w-[56px]" /></div>)}
          </div>
        </div>
        <div className="hidden w-px self-stretch bg-[#e6e1ee] md:block" />
        <div className="flex min-w-0 flex-1 flex-col gap-[10px]">
          <Skeleton className="h-[12px] w-[190px]" />
          <div className="flex gap-md border-b border-border-subtle pb-[6px] text-xs font-medium text-muted-foreground" aria-hidden>
            {COLUMNS.map(([name, width]) => <span key={name} className={width}>{name}</span>)}
          </div>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-md py-[6px]">
              <div className="flex w-[150px] flex-col gap-[6px]"><Skeleton className="h-[12px] w-[100px]" /><Skeleton className="h-[10px] w-[60px]" /></div>
              <div className="flex w-[250px] items-center gap-[10px]">
                <Skeleton className="size-[22px] rounded-full" />
                <div className="flex flex-col gap-[6px]"><Skeleton className="h-[12px] w-[130px]" /><Skeleton className="h-[10px] w-[80px]" /></div>
              </div>
              <Skeleton className="h-[12px] w-[90px]" />
              <Skeleton className="h-[12px] w-[40px]" />
              <Skeleton className="h-[12px] w-[70px]" />
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}
