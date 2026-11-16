"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, CalendarDays, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { periodHref } from "@/lib/performance-list";
import { rangeLabel } from "@/lib/performance-period-form";
import { SetUpPeriodDialog, type SetUpPeriodData } from "./set-up-period-dialog";

/**
 * The period selector in the Performance header: the periods, latest first, each a link that opens the list for it (a user action,
 * never a timer), and a way to set up a new period with the period dialog.
 */
export function PeriodSelector({ selectedId, setup }: { selectedId: number | null; setup: SetUpPeriodData }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const selected = setup.periods.find((period) => period.id === selectedId);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" aria-label="Evaluation period" className="h-auto gap-[6px] rounded-lg border-[#e6e1ee] px-[14px] py-[9px] shadow-none">
            <CalendarDays aria-hidden className="size-4" />{selected?.name ?? "No period yet"}<ChevronDown aria-hidden className="size-4 text-zinc-500" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[240px]">
          {setup.periods.map((period) => (
            <DropdownMenuItem key={period.id} asChild>
              <Link href={periodHref(period.id)} aria-current={period.id === selectedId ? "true" : undefined} className="flex items-center gap-[8px]">
                <span className="flex flex-1 flex-col"><span className="font-medium">{period.name}</span><span className="text-xs text-muted-foreground">{rangeLabel(period)}</span></span>
                {period.id === selectedId && <Check aria-hidden className="size-4 text-primary" />}
              </Link>
            </DropdownMenuItem>
          ))}
          {setup.periods.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onSelect={() => setDialogOpen(true)}><Plus aria-hidden className="size-4" />Set up new period</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <SetUpPeriodDialog {...setup} trigger="none" open={dialogOpen} onOpenChange={setDialogOpen} />
    </>
  );
}
