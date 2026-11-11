"use client";

import Link from "next/link";
import { useActionState, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { deleteOffer, saveOffer, type SaveOfferState } from "@/app/(hrms)/offers/actions";
import { EMPLOYMENT_TYPES, PROBATION_PERIODS } from "@/lib/offer-view";
import type { OfferTerms } from "@/lib/offers";
import { cn } from "@/lib/utils";

const BOX = "flex items-center gap-sm rounded-lg border bg-white px-[12px] py-[9px] text-sm text-zinc-900 focus-within:border-[#8b5cf6]";
const INPUT = "min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400";

function Labelled({ label, htmlFor, error, hint, children }: { label: string; htmlFor: string; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <label htmlFor={htmlFor} className="flex gap-[3px] text-[13px] font-medium text-zinc-800">
        {label}<span className="text-red-600">*</span>
      </label>
      {children}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

type Props = {
  /** The Draft being edited, or the Application a new Draft is for. */
  target: { offerId: number } | { applicationId: number };
  applicant: { name: string; email: string; role: string; branch: string };
  staff: string[];
  initial?: OfferTerms;
  today: string;
};

/** The Draft form: terms only, in the same visual language as the other HRMS forms. Saving returns to the list. */
export function OfferForm({ target, applicant, staff, initial, today }: Props) {
  const [state, submit, pending] = useActionState(saveOffer, {} as SaveOfferState);
  const errors = state.fieldErrors ?? {};
  const value = (name: keyof OfferTerms, fallback: string) => state.values?.[name] ?? fallback;
  const box = (name: keyof OfferTerms) => cn(BOX, errors[name] ? "border-destructive" : "border-zinc-200");
  // The current Staff pick stays available even if the Portal no longer lists them.
  const reportsTo = value("reportsTo", initial?.reportsTo ?? "");
  const people = reportsTo && !staff.includes(reportsTo) ? [reportsTo, ...staff] : staff;
  return (
    <Card className="flex max-w-[720px] flex-col gap-0 rounded-xl p-0 shadow-none">
      <form action={submit} noValidate>
        {"offerId" in target ? <input type="hidden" name="offerId" value={target.offerId} /> : <input type="hidden" name="applicationId" value={target.applicationId} />}
        <div className="flex flex-col gap-[3px] border-b border-[#ebebeb] px-[24px] py-[18px]">
          <h2 className="text-[17px] font-semibold text-foreground">{applicant.name}</h2>
          <p className="text-[13px] text-zinc-500">{applicant.email} · {applicant.role} · {applicant.branch}</p>
        </div>
        <div className="flex flex-col gap-md px-[24px] py-[20px]">
          <div className="flex flex-col gap-md sm:flex-row sm:gap-[12px]">
            <div className="min-w-0 flex-1">
              <Labelled label="Monthly salary" htmlFor="offer-salary" error={errors.monthlySalary} hint="In whole pesos.">
                <div className={box("monthlySalary")}>
                  <span className="text-zinc-500">₱</span>
                  <input id="offer-salary" name="monthlySalary" inputMode="numeric" defaultValue={value("monthlySalary", initial ? String(initial.monthlySalary) : "")} placeholder="19000" className={INPUT} />
                </div>
              </Labelled>
            </div>
            <div className="min-w-0 flex-1">
              <Labelled label="Start date" htmlFor="offer-start" error={errors.startDate}>
                <div className={box("startDate")}><input id="offer-start" name="startDate" type="date" min={today} defaultValue={value("startDate", initial?.startDate ?? "")} className={INPUT} /></div>
              </Labelled>
            </div>
          </div>
          <div className="flex flex-col gap-md sm:flex-row sm:gap-[12px]">
            <div className="min-w-0 flex-1">
              <Labelled label="Employment type" htmlFor="offer-type" error={errors.employmentType}>
                <div className={box("employmentType")}>
                  <select key={state.attempt} id="offer-type" name="employmentType" defaultValue={value("employmentType", initial?.employmentType ?? "")} className={cn(INPUT, "appearance-none")}>
                    <option value="" disabled>Choose a type</option>
                    {EMPLOYMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
                  </select>
                </div>
              </Labelled>
            </div>
            <div className="min-w-0 flex-1">
              <Labelled label="Probation" htmlFor="offer-probation" error={errors.probation}>
                <div className={box("probation")}>
                  <select key={state.attempt} id="offer-probation" name="probation" defaultValue={value("probation", initial?.probation ?? "")} className={cn(INPUT, "appearance-none")}>
                    <option value="" disabled>Choose a period</option>
                    {PROBATION_PERIODS.map((period) => <option key={period} value={period}>{period}</option>)}
                  </select>
                </div>
              </Labelled>
            </div>
          </div>
          <Labelled label="Schedule" htmlFor="offer-schedule" error={errors.schedule}>
            <div className={box("schedule")}><input id="offer-schedule" name="schedule" defaultValue={value("schedule", initial?.schedule ?? "")} placeholder="e.g. Mon–Sat, 6:00 AM – 2:00 PM" className={INPUT} /></div>
          </Labelled>
          <Labelled label="Reports to" htmlFor="offer-reports" error={errors.reportsTo}>
            <div className={box("reportsTo")}>
              <select key={state.attempt} id="offer-reports" name="reportsTo" defaultValue={reportsTo} className={cn(INPUT, "appearance-none")}>
                <option value="" disabled>Choose a Staff member</option>
                {people.map((name) => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
          </Labelled>
          {state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
        </div>
        <div className="flex items-center gap-sm border-t border-[#ebebeb] px-[24px] py-[14px]">
          {"offerId" in target && <DeleteDraft offerId={target.offerId} />}
          <div className="ml-auto flex items-center gap-sm">
            <Button variant="outline" asChild className="h-auto rounded-lg px-[14px] py-[9px] shadow-none"><Link href="/offers">Cancel</Link></Button>
            <Button type="submit" disabled={pending} className="h-auto rounded-lg px-[14px] py-[9px] shadow-none">{pending ? "Saving…" : "Save draft"}</Button>
          </div>
        </div>
      </form>
    </Card>
  );
}

function DeleteDraft({ offerId }: { offerId: number }) {
  const [error, setError] = useState<string>();
  const [pending, start] = useTransition();
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" className="h-auto rounded-lg px-[14px] py-[9px] text-destructive shadow-none">Delete draft</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this draft?</AlertDialogTitle>
          <AlertDialogDescription>The applicant goes back to the New offer list, where you can start again.</AlertDialogDescription>
        </AlertDialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel>Keep draft</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              start(async () => setError((await deleteOffer(offerId))?.error));
            }}
          >
            {pending ? "Deleting…" : "Delete draft"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
