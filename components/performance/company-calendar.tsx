"use client";

import { useState, useTransition } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CELL, HEAD, InfoNote } from "@/components/hiring/parts";
import { removeNonWorkingDate } from "@/app/(hrms)/performance/actions";
import { dateLabel, periodsHolding } from "@/lib/performance-period-form";
import type { CalendarEntry, Period } from "@/lib/performance-periods";
import { cn } from "@/lib/utils";
import { NonWorkingDateDialog } from "./non-working-date-dialog";

const TABS = ["All", "Holidays", "Closures"] as const;
type Tab = (typeof TABS)[number];
const SUMMARY_TEXT = "A date applies to every Evaluation period it falls in. Holidays and closures are not counted as scheduled days, so nobody is marked absent. Excused days are entered per Employee.";
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The dates a tab shows: Holidays and Closures are those types; All is everything, Other dates included. */
export const inTab = (entry: Pick<CalendarEntry, "type">, tab: Tab) => tab === "All" || (tab === "Holidays" ? entry.type === "Holiday" : entry.type === "Closure");

/** The dates a search finds, by name, notes, type or the date as written ("Mon 30 Nov 2026"), ignoring case. */
export function matchesSearch(entry: Pick<CalendarEntry, "date" | "name" | "type" | "notes">, search: string) {
  const needle = search.trim().toLowerCase();
  return needle === "" || [entry.name, entry.notes ?? "", entry.type, dateLabel(entry.date), entry.date].some((text) => text.toLowerCase().includes(needle));
}

const addedText = (entry: CalendarEntry) => `Added ${Number(entry.addedOn.slice(8, 10))} ${MONTHS[Number(entry.addedOn.slice(5, 7)) - 1]} by ${entry.addedByName}`;

/**
 * The company calendar: every non-working date with tabs All, Holidays and Closures and a search, each date editable or removable.
 * A date applies to every Evaluation period it falls in; a submitted evaluation keeps the days it was submitted with.
 */
export function CompanyCalendar({ entries, periods, today }: { entries: CalendarEntry[]; periods: Period[]; today: string }) {
  const [tab, setTab] = useState<Tab>("All");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<CalendarEntry | null>(null);
  const [removing, setRemoving] = useState<CalendarEntry | null>(null);
  const [pending, start] = useTransition();
  const year = today.slice(0, 4);
  const thisYear = entries.filter((entry) => entry.date.startsWith(year)).length;
  const counts: Record<Tab, number> = { All: entries.length, Holidays: entries.filter((e) => e.type === "Holiday").length, Closures: entries.filter((e) => e.type === "Closure").length };
  const shown = entries.filter((entry) => inTab(entry, tab) && matchesSearch(entry, search));

  const confirmRemove = () => {
    const entry = removing;
    if (!entry) return;
    start(async () => {
      const result = await removeNonWorkingDate(entry.id);
      if (result.ok) toast.success(`${entry.name} removed`);
      else toast.error(result.error);
      setRemoving(null);
    });
  };

  return (
    <>
      <Card className="flex flex-wrap items-center gap-lg rounded-xl p-[20px] shadow-none">
        <div className="flex w-[300px] max-w-full flex-col gap-[6px]">
          <p className="text-sm text-muted-foreground">Non-working dates · {year}</p>
          <p className="flex items-baseline gap-[8px]">
            <span className="text-[28px] font-bold leading-none text-foreground" data-testid="year-count">{thisYear}</span>
            <span className="text-sm text-muted-foreground">{thisYear === 1 ? "date this year" : "dates this year"}</span>
          </p>
        </div>
        <p className="min-w-[240px] flex-1 text-xs text-muted-foreground">{SUMMARY_TEXT}</p>
      </Card>

      <div className="flex flex-wrap items-center gap-[12px]">
        <div role="group" aria-label="Type" className="flex flex-1 flex-wrap gap-xs">
          {TABS.map((name) => (
            <button key={name} type="button" aria-pressed={name === tab} onClick={() => setTab(name)}
              className={cn("rounded-lg px-[14px] py-[8px] text-sm font-medium text-muted-foreground hover:text-foreground", name === tab && "bg-accent text-primary hover:text-primary")}>
              {name} {counts[name]}
            </button>
          ))}
        </div>
        <label className="relative w-[240px] max-w-full">
          <span className="sr-only">Search dates</span>
          <Search aria-hidden className="absolute left-[12px] top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search dates" className="h-[38px] rounded-lg border-[#e6e1ee] pl-[36px] shadow-none" />
        </label>
      </div>

      <Card className="flex flex-col gap-[14px] overflow-auto rounded-xl p-[20px] shadow-none">
        {shown.length === 0 ? (
          <p className="p-xl text-center text-muted-foreground">
            {search.trim() ? "No dates match your search." : entries.length === 0 ? "No non-working dates yet. Add a holiday or closure." : `No ${tab.toLowerCase()} yet.`}
          </p>
        ) : (
          <Table className="min-w-[900px] table-fixed">
            <TableHeader>
              <TableRow className="border-border-subtle hover:bg-transparent">
                <TableHead className={`${HEAD} w-[230px]`}>Date</TableHead>
                <TableHead className={`${HEAD} w-[200px]`}>Name</TableHead>
                <TableHead className={`${HEAD} w-[90px]`}>Type</TableHead>
                <TableHead className={`${HEAD} w-[100px]`}>Applies to</TableHead>
                <TableHead className={`${HEAD} w-[150px]`}>Periods</TableHead>
                <TableHead className={`${HEAD} w-[110px]`}>Status</TableHead>
                <TableHead className={HEAD}><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((entry) => {
                const holding = periodsHolding(entry.date, periods);
                const upcoming = entry.date >= today;
                return (
                  <TableRow key={entry.id} className="border-border-subtle">
                    <TableCell className={CELL}>
                      <div className="flex flex-col gap-[2px]">
                        <span className="text-sm font-medium text-primary">{dateLabel(entry.date)}</span>
                        <span className="text-xs text-muted-foreground">{addedText(entry)}</span>
                      </div>
                    </TableCell>
                    <TableCell className={CELL}>
                      <div className="flex flex-col gap-[2px]">
                        <span>{entry.name}</span>
                        {entry.notes && <span className="text-xs text-muted-foreground">{entry.notes}</span>}
                      </div>
                    </TableCell>
                    <TableCell className={CELL}>{entry.type}</TableCell>
                    <TableCell className={CELL}>Everyone</TableCell>
                    <TableCell className={CELL}>{holding.length ? holding.map((period) => period.name).join(", ") : "No period yet"}</TableCell>
                    <TableCell className={CELL}><Badge variant={upcoming ? "success" : "secondary"}>{upcoming ? "Upcoming" : "Past"}</Badge></TableCell>
                    <TableCell className={CELL}>
                      <div className="flex justify-end gap-[4px]">
                        <Button type="button" variant="ghost" size="sm" aria-label={`Edit ${entry.name}`} onClick={() => setEditing(entry)} className="h-auto px-[8px] py-[4px] text-primary">Edit</Button>
                        <Button type="button" variant="ghost" size="sm" aria-label={`Remove ${entry.name}`} onClick={() => setRemoving(entry)} className="h-auto px-[8px] py-[4px] text-[#9a3412]">Remove</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
        <InfoNote>A date that falls in a submitted evaluation doesn’t change that evaluation. Dates can be edited or removed until then.</InfoNote>
      </Card>

      {editing && <NonWorkingDateDialog key={editing.id} entry={editing} entries={entries} periods={periods} open onOpenChange={(open) => { if (!open) setEditing(null); }} />}

      <AlertDialog open={removing !== null} onOpenChange={(open) => { if (!open && !pending) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing ? `${dateLabel(removing.date)} will be counted as a scheduled day again for Employees who work that day. Evaluations already submitted keep the days they were submitted with.` : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Keep date</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); confirmRemove(); }}>Remove date</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
