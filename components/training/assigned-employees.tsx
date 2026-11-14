"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { NEEDS_PRINTED } from "@/components/training/assign-dialog";
import { removeAssignedEmployee } from "@/app/(hrms)/training/actions";
import type { AssignedEmployee, AssignmentStatus } from "@/lib/training-terms";

const BADGE: Record<AssignmentStatus, "secondary" | "success" | "warning"> = {
  Assigned: "secondary", Completed: "success", "Did not attend": "warning", Cancelled: "secondary",
};
const HEAD = "py-[6px] text-left text-xs font-medium text-muted-foreground";

/** The Assigned employees table, with a confirm dialog before anyone is removed. */
export function AssignedEmployees({ trainingId, title, date, people }: { trainingId: number; title: string; date: string; people: AssignedEmployee[] }) {
  const [removing, setRemoving] = useState<AssignedEmployee>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function confirm() {
    if (!removing) return;
    setPending(true);
    const result = await removeAssignedEmployee(trainingId, removing.employeeId);
    setPending(false);
    if (result.error) setError(result.error);
    setRemoving(undefined);
  }

  if (people.length === 0) {
    return <p className="rounded-lg bg-muted px-[14px] py-[18px] text-center text-[13px] font-medium text-zinc-500">No one is assigned yet. Use Assign employees to add people by name or by department.</p>;
  }
  return (
    <>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[#efebf4]">
              <th className={HEAD}>Employee</th><th className={HEAD}>Email</th><th className={HEAD}>Result</th><th className={HEAD}><span className="sr-only">Remove</span></th>
            </tr>
          </thead>
          <tbody>
            {people.map((person) => (
              <tr key={person.employeeId} className="border-b border-[#efebf4] align-middle">
                <td className="py-[10px] pr-[12px]"><div className="flex flex-col"><span className="font-medium text-foreground">{person.name}</span><span className="text-xs text-muted-foreground">{person.position} · {person.branch}</span></div></td>
                <td className="py-[10px] pr-[12px]">{person.email ?? <span className={NEEDS_PRINTED}>Needs printed schedule</span>}</td>
                <td className="py-[10px] pr-[12px]"><Badge variant={BADGE[person.status]}>{person.status}</Badge></td>
                <td className="py-[10px] text-right">
                  <button type="button" onClick={() => { setError(undefined); setRemoving(person); }} aria-label={`Remove ${person.name}`} className="rounded-md p-[6px] text-zinc-500 hover:bg-zinc-100 hover:text-destructive"><X className="size-4" aria-hidden /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(undefined); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}?</AlertDialogTitle>
            <AlertDialogDescription>{title} · {date}. They won’t get reminders for this training. Their past notices stay in the notification log.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); void confirm(); }}>{pending ? "Removing…" : "Remove employee"}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
