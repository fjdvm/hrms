"use client";

import { useMemo, useState, useTransition } from "react";
import { AlertTriangle, Search, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { assignEmployees, loadAssignable } from "@/app/(hrms)/training/actions";
import { noEmailWarning, type AssignableEmployee } from "@/lib/training-terms";
import { cn } from "@/lib/utils";

const TAB = "rounded-lg px-[14px] py-[8px] text-sm font-medium";
const PILL = "rounded-full bg-amber-100 px-[10px] py-[3px] text-xs font-medium text-amber-800";

/** Assign employees by person or by whole department. Employee records only; no-email Employees are flagged. */
export function AssignDialog({ trainingId, title, subtitle, disabled }: { trainingId: number; title: string; subtitle: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<AssignableEmployee[]>();
  const [error, setError] = useState<string>();
  const [tab, setTab] = useState<"person" | "department">("person");
  const [query, setQuery] = useState("");
  const [branch, setBranch] = useState("");
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [department, setDepartment] = useState("");
  const [pending, start] = useTransition();

  function reset(next: boolean) {
    setOpen(next);
    if (!next) return;
    setPeople(undefined); setError(undefined); setTab("person"); setQuery(""); setBranch(""); setPicked(new Set()); setDepartment("");
    void loadAssignable(trainingId).then((result) => (result.people ? setPeople(result.people) : setError(result.error ?? "Employees could not be loaded.")));
  }

  const branches = useMemo(() => [...new Set((people ?? []).map((person) => person.branch))].sort(), [people]);
  const departments = useMemo(() => {
    const counts = new Map<string, { total: number; fresh: number }>();
    for (const person of people ?? []) {
      if (!person.department) continue;
      const entry = counts.get(person.department) ?? { total: 0, fresh: 0 };
      entry.total += 1;
      if (!person.alreadyAssigned) entry.fresh += 1;
      counts.set(person.department, entry);
    }
    return [...counts].sort(([a], [b]) => a.localeCompare(b));
  }, [people]);
  const shown = (people ?? []).filter((person) =>
    (!branch || person.branch === branch) && `${person.name} ${person.position}`.toLowerCase().includes(query.trim().toLowerCase()));
  const chosen = tab === "person"
    ? (people ?? []).filter((person) => picked.has(person.employeeId))
    : (people ?? []).filter((person) => person.department === department && !person.alreadyAssigned);
  const warning = noEmailWarning(chosen);
  const missing = chosen.filter((person) => !person.email).length;

  function toggle(id: number) {
    setPicked((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  }
  function submit() {
    setError(undefined);
    start(async () => {
      const result = await assignEmployees(trainingId, tab === "person" ? { employeeIds: [...picked] } : { department });
      if (result.error) setError(result.error); else setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={reset}>
      <DialogTrigger asChild>
        <Button disabled={disabled} className="h-auto gap-[6px] rounded-lg px-[14px] py-[9px] font-medium shadow-none"><UserPlus className="size-4" aria-hidden />Assign employees</Button>
      </DialogTrigger>
      <DialogContent showClose={false} overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="w-[calc(100vw-32px)] max-w-[580px] gap-0 rounded-2xl border-0 p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:p-0 md:max-w-[580px] lg:max-w-[580px]">
        <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Assign employees</DialogTitle>
            <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">{title} · {subtitle}</DialogDescription>
          </div>
          <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
        </div>
        <div className="flex flex-col gap-[16px] px-[24px] py-[20px]">
          <div role="tablist" aria-label="Assign by" className="flex gap-xs">
            {([["person", "By employee"], ["department", "Whole department"]] as const).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)}
                className={cn(TAB, tab === value ? "bg-accent text-primary" : "text-muted-foreground hover:text-foreground")}>{label}</button>
            ))}
          </div>
          {people === undefined && !error && <p role="status" className="py-lg text-center text-sm text-muted-foreground">Loading employees…</p>}
          {people && tab === "person" && (
            <>
              <div className="flex gap-[8px]">
                <label className="flex flex-1 items-center gap-[8px] rounded-lg border border-zinc-200 bg-white px-[12px] py-[9px] focus-within:border-[#8b5cf6]">
                  <Search className="size-4 text-zinc-500" aria-hidden />
                  <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search employees" aria-label="Search employees" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-zinc-400" />
                </label>
                <select value={branch} onChange={(event) => setBranch(event.target.value)} aria-label="Branch" className="rounded-lg border border-zinc-200 bg-white px-[12px] py-[9px] text-sm">
                  <option value="">Branches</option>
                  {branches.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </div>
              {shown.length === 0 ? <p className="py-md text-center text-sm text-muted-foreground">No employees match.</p> : (
                <ul className="max-h-[330px] divide-y divide-[#ebebeb] overflow-y-auto rounded-lg border border-[#e6e1ee]">
                  {shown.map((person) => (
                    <li key={person.employeeId}>
                      <label className={cn("flex items-center gap-[12px] px-[14px] py-[9px]", person.alreadyAssigned ? "bg-muted text-zinc-400" : "cursor-pointer")}>
                        <input type="checkbox" checked={person.alreadyAssigned || picked.has(person.employeeId)} disabled={person.alreadyAssigned} onChange={() => toggle(person.employeeId)} className="size-4 accent-[#5b2a86]" aria-label={person.name} />
                        <span className="flex min-w-0 flex-1 flex-col"><span className="text-sm font-medium">{person.name}</span><span className="truncate text-xs text-zinc-500">{person.position} · {person.branch}</span></span>
                        {person.alreadyAssigned ? <span className="text-xs">Already assigned</span> : person.email ? <span className="text-xs text-zinc-500">{person.email}</span> : <span className={PILL}>Needs printed schedule</span>}
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          {people && tab === "department" && (
            departments.length === 0 ? <p className="py-md text-center text-sm text-muted-foreground">No employee has a department yet.</p> : (
              <fieldset className="flex max-h-[330px] flex-col gap-[8px] overflow-y-auto">
                <legend className="sr-only">Department</legend>
                {departments.map(([name, { total, fresh }]) => (
                  <label key={name} className={cn("flex cursor-pointer items-center gap-[12px] rounded-lg border px-[14px] py-[10px]", department === name ? "border-[#8b5cf6] bg-[#f5f0ff]" : "border-zinc-200 bg-white")}>
                    <input type="radio" name="department" value={name} checked={department === name} onChange={() => setDepartment(name)} className="size-4 accent-[#5b2a86]" />
                    <span className="flex-1 text-sm font-medium">{name}</span>
                    <span className="text-xs text-zinc-500">{total} {total === 1 ? "employee" : "employees"}{fresh < total ? ` · ${fresh} not yet assigned` : ""}</span>
                  </label>
                ))}
              </fieldset>
            )
          )}
          {warning && (
            <p className="flex items-start gap-[8px] rounded-lg bg-amber-50 px-[14px] py-[12px] text-[13px] text-amber-900"><AlertTriangle className="mt-[2px] size-4 shrink-0" aria-hidden />{warning}</p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <div className="flex items-center gap-sm border-t border-[#ebebeb] px-[24px] py-[14px]">
          <p className="flex-1 text-xs text-zinc-500">{chosen.length} selected{missing > 0 ? ` · ${missing} needs a printed schedule` : ""}</p>
          <DialogClose asChild><Button variant="outline" className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] text-sm font-medium shadow-none">Cancel</Button></DialogClose>
          <Button disabled={pending || chosen.length === 0} onClick={submit} className="h-auto rounded-lg px-[16px] py-[9px] text-sm font-medium shadow-none">
            {pending ? "Assigning…" : `Assign ${chosen.length || ""} ${chosen.length === 1 ? "employee" : "employees"}`.replace(/\s+/g, " ")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export const NEEDS_PRINTED = PILL;
