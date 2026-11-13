"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { markNoAccountNeeded, undoNoAccountNeeded } from "@/app/(hrms)/employee-onboarding/actions";
import type { OnboardingRow } from "@/lib/employees";
import { formatOfferDate } from "@/lib/offer-view";

const BUTTON = "h-auto rounded-lg px-[12px] py-[6px] text-[13px]";
type Person = Pick<OnboardingRow, "id" | "name" | "startDate">;

/** "No account needed" beside "Request user account": asks first, then marks the person; the list re-reads so the row moves tabs. */
export function NoAccountNeededButton({ employee }: { employee: Person }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const confirm = (event: React.MouseEvent) => {
    event.preventDefault(); // keep the dialog open until the server answers
    setError(undefined);
    start(async () => {
      const result = await markNoAccountNeeded(employee.id);
      if (!result.ok) { setError(result.error); router.refresh(); return; }
      toast.success(`${employee.name} marked as needing no account`);
      setOpen(false);
      router.refresh();
    });
  };
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!pending) { setOpen(next); setError(undefined); } }}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className={BUTTON}>No account needed</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mark {employee.name} as needing no account?</AlertDialogTitle>
          <AlertDialogDescription>
            No Portal account will be requested. They become Active on their start date, {formatOfferDate(employee.startDate)}, or the next morning if it has passed. You can undo this until they are Active.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={confirm}>{pending ? "Saving…" : "Mark as no account needed"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Undo, offered until the person is Active (an Active person is no longer on this list). */
export function UndoNoAccountNeededButton({ employee }: { employee: Person }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const undo = () => start(async () => {
    const result = await undoNoAccountNeeded(employee.id);
    if (result.ok) toast.success(`${employee.name} is back to Not requested`);
    else toast.error(result.error);
    router.refresh();
  });
  return (
    <Button type="button" variant="outline" size="sm" className={BUTTON} disabled={pending} onClick={undo}>
      <Check aria-hidden />Undo
    </Button>
  );
}
