"use client";

import { useState, useTransition } from "react";
import { Check, Lock, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { markAsHired } from "@/app/(hrms)/offers/actions";
import { CardTitle } from "@/components/hiring/parts";
import { cn } from "@/lib/utils";

type Props = {
  offerId: number;
  firstName: string;
  accepted: boolean;
  submitted: number;
  total: number;
  /** The Application withdrew: nothing can be done. */
  withdrawn: boolean;
  /** Already marked as hired. */
  hired: boolean;
};

function Condition({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <li className={cn("flex items-center gap-[10px] text-sm", met ? "text-zinc-900" : "text-zinc-500")}>
      <span aria-hidden className={cn("flex size-[20px] shrink-0 items-center justify-center rounded-full", met ? "bg-badge-success-foreground text-white" : "border-[1.5px] border-zinc-300")}>
        {met && <Check className="size-3" strokeWidth={3} />}
      </span>
      {children}
    </li>
  );
}

/** The Hire card: locked until the Offer is Accepted and all documents are Submitted, and says what is missing. */
export function HireCard({ offerId, firstName, accepted, submitted, total, withdrawn, hired }: Props) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  const ready = accepted && submitted >= total && !withdrawn && !hired;
  const hire = () => {
    setError(undefined);
    start(async () => {
      const result = await markAsHired(offerId);
      if (result.error) setError(result.error);
    });
  };
  return (
    <Card className="flex flex-col gap-[14px] rounded-xl px-[20px] py-[18px] shadow-none lg:w-[380px] lg:shrink-0">
      <CardTitle>Hire</CardTitle>
      <ul aria-label="Hire checklist" className="flex flex-col gap-[12px]">
        <Condition met={accepted}>Offer accepted</Condition>
        <Condition met={submitted >= total}>All {total} documents submitted ({submitted}/{total})</Condition>
      </ul>
      {hired ? (
        <p className="text-sm font-medium text-badge-success-foreground">Hired. {firstName}&apos;s employee record is in the Hired list.</p>
      ) : (
        <>
          <Button type="button" disabled={!ready || pending} onClick={hire}
            className="h-auto w-full gap-[8px] rounded-lg px-[14px] py-[9px] text-sm font-medium shadow-none disabled:bg-zinc-100 disabled:text-zinc-500 disabled:opacity-100">
            {ready ? <UserCheck className="size-4" /> : <Lock className="size-4" />}
            {pending ? "Marking as hired…" : "Mark as hired"}
          </Button>
          <p className="text-xs text-zinc-500">
            {withdrawn
              ? "The applicant withdrew, so they can't be hired."
              : ready
                ? `Moves ${firstName} to Hired and creates their employee record with these documents. They get a welcome email.`
                : "Available once the offer is accepted and all documents are in."}
          </p>
        </>
      )}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </Card>
  );
}
