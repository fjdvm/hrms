"use client";

import { useState, useTransition } from "react";
import { Calendar, Check, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { saveResults } from "@/app/(hrms)/training/actions";
import { FeedbackDialog } from "@/components/training/feedback-dialog";
import { formatShortDate, type AssignedEmployee, type ResultMark, type ResultStatus, type TrainingFeedback } from "@/lib/training-terms";
import { cn } from "@/lib/utils";

type Row = { status: ResultStatus; completedOn: string };
const HEAD = "py-[6px] text-left text-xs font-medium text-[#6e6680]";
const DATE_BOX = "flex items-center gap-[8px] rounded-lg border border-zinc-200 bg-white px-[10px] py-[6px] text-[13px] text-zinc-900 focus-within:border-[#8b5cf6]";
const DATE_INPUT = "w-[118px] bg-transparent text-[13px] outline-none";

const initialsOf = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]!.toUpperCase()).join("");

/**
 * "Training · Mark results": set each Assigned employee's result from the paper sign-in sheet, one by one or in bulk, then save.
 * Cancelled employees were set automatically and are left out. The wording is "results", never "attendance".
 */
export function MarkResults({ trainingId, trainingTitle, trainingDate, today, people }: { trainingId: number; trainingTitle: string; trainingDate: string; today: string; people: AssignedEmployee[] }) {
  const markable = people.filter((person) => person.status !== "Cancelled");
  const start = (): Record<number, Row> => Object.fromEntries(markable.map((person) => [person.employeeId, { status: person.status as ResultStatus, completedOn: person.completedOn ?? "" }]));
  const [saved, setSaved] = useState(start);
  // Feedback typed from the paper form; only an employee whose Completed result is saved can have it.
  const [feedback, setFeedback] = useState<Record<number, TrainingFeedback | null>>(() => Object.fromEntries(markable.map((person) => [person.employeeId, person.feedback])));
  const [rows, setRows] = useState(start);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDate, setBulkDate] = useState(trainingDate <= today ? trainingDate : today);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  const [pending, start_] = useTransition();

  const count = (status: ResultStatus) => markable.filter((person) => rows[person.employeeId].status === status).length;
  const completed = count("Completed"), absent = count("Did not attend"), still = count("Assigned");
  const marked = completed + absent;
  const dirty = markable.filter((person) => rows[person.employeeId].status !== saved[person.employeeId].status || rows[person.employeeId].completedOn !== saved[person.employeeId].completedOn);
  const allSelected = markable.length > 0 && selected.size === markable.length;

  const change = (id: number, row: Partial<Row>) => { setDone(undefined); setRows((current) => ({ ...current, [id]: { ...current[id], ...row } })); };
  const choose = (id: number, status: ResultStatus) => {
    const now = rows[id];
    // Pressing the chosen option again puts the employee back to Assigned.
    if (now.status === status) return change(id, { status: "Assigned", completedOn: "" });
    change(id, { status, completedOn: status === "Completed" ? now.completedOn || (trainingDate <= today ? trainingDate : today) : "" });
  };
  const toggle = (id: number) => setSelected((current) => { const next = new Set(current); if (!next.delete(id)) next.add(id); return next; });
  const bulk = (status: ResultStatus) => {
    for (const id of selected) change(id, { status, completedOn: status === "Completed" ? bulkDate : "" });
    setSelected(new Set());
  };

  function save() {
    setError(undefined);
    const marks: ResultMark[] = dirty.map((person) => ({ employeeId: person.employeeId, status: rows[person.employeeId].status, completedOn: rows[person.employeeId].status === "Completed" ? rows[person.employeeId].completedOn : null }));
    start_(async () => {
      const result = await saveResults(trainingId, marks);
      if (result.error) { setError(result.error); return; }
      setSaved(rows);
      setFeedback((current) => Object.fromEntries(Object.entries(current).map(([id, value]) => [id, rows[Number(id)]?.status === "Completed" ? value : null])));
      setDone(`Results saved for ${marks.length} ${marks.length === 1 ? "employee" : "employees"}.`);
    });
  }

  const dateInput = (value: string, onChange: (next: string) => void, label: string) => (
    <div className={DATE_BOX}>
      <input type="date" aria-label={label} min={trainingDate} max={today} value={value} onChange={(event) => onChange(event.target.value)} className={DATE_INPUT} />
      <Calendar className="size-[14px] text-zinc-500" aria-hidden />
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-sm">
        <div className="min-w-0 flex-1" />
        {done && <p role="status" className="text-sm text-[#1e6b3a]">{done}</p>}
        {dirty.length > 0 && !done && <p className="text-sm text-[#8a5a00]">{dirty.length} unsaved {dirty.length === 1 ? "change" : "changes"}</p>}
        <Button disabled={pending || dirty.length === 0} onClick={save} className="h-auto gap-[6px] rounded-lg px-[14px] py-[9px] font-medium shadow-none">{pending ? "Saving…" : "Save results"}</Button>
      </div>
      {error && <p role="alert" className="rounded-lg bg-[#fbe6e0] px-[14px] py-[10px] text-sm text-[#9a3412]">{error}</p>}
      <Card className="flex flex-wrap items-center gap-[28px] rounded-xl px-[20px] py-[16px] shadow-none">
        <div className="flex w-[260px] max-w-full flex-col gap-[6px]">
          <div className="flex items-end gap-[8px]"><span className="text-2xl font-bold text-zinc-900">{marked} of {markable.length}</span><span className="text-[13px] font-medium text-[#6e6680]">marked</span></div>
          <div className="h-[6px] rounded-[4px] bg-[#f1edf6]" role="progressbar" aria-label="Results marked" aria-valuemin={0} aria-valuemax={markable.length} aria-valuenow={marked}>
            <div className="h-[6px] rounded-[4px] bg-[#5b2a86]" style={{ width: `${markable.length ? (marked / markable.length) * 100 : 0}%` }} />
          </div>
        </div>
        <div className="flex flex-col gap-[2px]"><span className="text-xs font-medium text-zinc-500">Completed</span><span className="text-xl font-semibold text-[#1e6b3a]">{completed}</span></div>
        <div className="flex flex-col gap-[2px]"><span className="text-xs font-medium text-zinc-500">Did not attend</span><span className="text-xl font-semibold text-[#9a3412]">{absent}</span></div>
        <div className="flex flex-col gap-[2px]"><span className="text-xs font-medium text-zinc-500">Still Assigned</span><span className="text-xl font-semibold text-[#6e6680]">{still}</span></div>
      </Card>
      <div className="flex flex-wrap items-center gap-[10px] rounded-[10px] bg-[#efe6f8] px-[14px] py-[10px]">
        <input type="checkbox" aria-label="Select all employees" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(markable.map((person) => person.employeeId)))} className="size-4 accent-[#5b2a86]" />
        <p className="min-w-0 flex-1 text-sm font-semibold text-primary">{selected.size > 0 ? `${selected.size} selected` : "Select employees to mark them together"}</p>
        <span className="text-[13px] font-medium text-zinc-800">Completion date</span>
        {dateInput(bulkDate, setBulkDate, "Completion date for selected employees")}
        <Button disabled={selected.size === 0 || !bulkDate} onClick={() => bulk("Completed")} className="h-auto gap-[6px] rounded-lg px-[12px] py-[6px] text-[13px] font-medium shadow-none"><Check className="size-[14px]" aria-hidden />Mark Completed</Button>
        <Button variant="outline" disabled={selected.size === 0} onClick={() => bulk("Did not attend")} className="h-auto rounded-lg border-[#e6e1ee] bg-white px-[12px] py-[6px] text-[13px] font-medium text-[#1f1a2e] shadow-none">Mark Did not attend</Button>
      </div>
      <Card className="flex flex-col gap-[14px] rounded-xl p-[20px] shadow-none">
        {markable.length === 0 ? <p className="py-lg text-center text-sm text-muted-foreground">No one is assigned to mark. Assign employees from the training page.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-[#efebf4]"><th className={cn(HEAD, "w-[36px]")}><span className="sr-only">Select</span></th><th className={cn(HEAD, "w-[260px]")}>Employee</th><th className={cn(HEAD, "w-[330px]")}>Result</th><th className={cn(HEAD, "w-[170px]")}>Completion date</th><th className={HEAD}>Feedback</th></tr>
              </thead>
              <tbody>
                {markable.map((person) => {
                  const row = rows[person.employeeId];
                  return (
                    <tr key={person.employeeId} className="border-b border-[#efebf4] align-middle">
                      <td className="py-[10px]"><input type="checkbox" aria-label={`Select ${person.name}`} checked={selected.has(person.employeeId)} onChange={() => toggle(person.employeeId)} className="size-4 accent-[#5b2a86]" /></td>
                      <td className="py-[10px] pr-[12px]">
                        <div className="flex items-center gap-[8px]">
                          <span aria-hidden className="flex size-[30px] shrink-0 items-center justify-center rounded-full bg-[#efe6f8] text-[11px] font-semibold text-primary">{initialsOf(person.name)}</span>
                          <div className="flex min-w-0 flex-col gap-[2px]"><span className="font-medium text-[#1f1a2e]">{person.name}</span><span className="truncate text-xs text-[#6e6680]">{person.position} · {person.branch}</span></div>
                        </div>
                      </td>
                      <td className="py-[10px] pr-[12px]">
                        <div className="flex items-center gap-[8px]">
                          <div role="group" aria-label={`Result for ${person.name}`} className="flex gap-[2px] rounded-lg bg-[#f4f4f5] p-[3px]">
                            <button type="button" aria-pressed={row.status === "Completed"} onClick={() => choose(person.employeeId, "Completed")}
                              className={cn("flex items-center gap-[4px] rounded-md px-[10px] py-[5px] text-[13px] font-medium", row.status === "Completed" ? "bg-white text-[#1e6b3a] shadow-[0_1px_1px_rgba(0,0,0,0.1)]" : "text-[#6e6680]")}>
                              {row.status === "Completed" && <Check className="size-3" aria-hidden />}Completed
                            </button>
                            <button type="button" aria-pressed={row.status === "Did not attend"} onClick={() => choose(person.employeeId, "Did not attend")}
                              className={cn("flex items-center gap-[4px] rounded-md px-[10px] py-[5px] text-[13px] font-medium", row.status === "Did not attend" ? "bg-white text-[#9a3412] shadow-[0_1px_1px_rgba(0,0,0,0.1)]" : "text-[#6e6680]")}>
                              {row.status === "Did not attend" && <X className="size-3" aria-hidden />}Did not attend
                            </button>
                          </div>
                          {row.status === "Assigned" && <Badge variant="secondary">Assigned</Badge>}
                        </div>
                      </td>
                      <td className="py-[10px]">{row.status === "Completed" ? dateInput(row.completedOn, (next) => change(person.employeeId, { completedOn: next }), `Completion date for ${person.name}`) : <span className="text-sm text-zinc-400">—</span>}</td>
                      <td className="py-[10px]">
                        {saved[person.employeeId].status === "Completed" && row.status === "Completed"
                          ? <FeedbackDialog trainingId={trainingId} employeeId={person.employeeId} employeeName={person.name} trainingTitle={trainingTitle} trainingDate={formatShortDate(trainingDate)}
                              feedback={feedback[person.employeeId]} onSaved={(next) => setFeedback((current) => ({ ...current, [person.employeeId]: next }))} />
                          : <span className="text-sm text-zinc-400">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <p className="rounded-lg bg-[#f7f5fa] px-[12px] py-[10px] text-xs text-[#6e6680]">
          Mark results from the paper sign-in sheet. Cancelled is set automatically when a training is cancelled. Once any result is saved, the training date is locked.
        </p>
      </Card>
    </>
  );
}
