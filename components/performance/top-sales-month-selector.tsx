import Link from "next/link";
import { CalendarDays, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { salesMonthHref, type SalesMonth } from "@/lib/performance-top-sales-view";

/**
 * The Top sales card's own month selector, separate from the page's period button. Each month is a link that reloads the page on that month
 * (a user action, never a timer), so only the card's data changes meaning.
 */
export function TopSalesMonthSelector({ choices, selected, period }: { choices: SalesMonth[]; selected: string; period?: string | null }) {
  const current = choices.find((choice) => choice.value === selected) ?? choices[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" aria-label="Top sales month" className="h-auto gap-[6px] rounded-lg border-[#e6e1ee] px-[14px] py-[9px] shadow-none">
          <CalendarDays aria-hidden className="size-4" />{current.label}<ChevronDown aria-hidden className="size-4 text-zinc-500" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {choices.map((choice) => (
          <DropdownMenuItem key={choice.value} asChild>
            <Link href={salesMonthHref(choice.value, period)} aria-current={choice.value === selected ? "true" : undefined} className="flex items-center gap-[8px]">
              <span className="flex-1 font-medium">{choice.label}</span>
              {choice.value === selected && <Check aria-hidden className="size-4 text-primary" />}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
