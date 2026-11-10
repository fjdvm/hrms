"use client";

import { useActionState, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { MANUAL_SOURCES } from "@/lib/application-sources";
import type { ApplicationJobPostingOption } from "@/lib/applications";
import { addApplicant, type AddApplicantState } from "@/app/(hrms)/applicants/actions";
import { cn } from "@/lib/utils";

const BOX = "flex items-center gap-sm rounded-lg border bg-white px-[12px] py-[9px] text-sm text-zinc-900 focus-within:border-[#8b5cf6]";
const INPUT = "min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400";

function Labelled({ label, htmlFor, required, error, hint, children }: { label: string; htmlFor: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-[6px]">
      <label htmlFor={htmlFor} className="flex gap-[3px] text-[13px] font-medium text-zinc-800">
        {label}{required && <span className="text-red-600">*</span>}
      </label>
      {children}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : hint && <p className="text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

/** The Add applicant button in the page header and the form it opens. Saving refreshes the list, where the new Application sits at New. */
export function AddApplicant({ jobs }: { jobs: ApplicationJobPostingOption[] }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [state, submit, pending] = useActionState(async (previous: AddApplicantState, data: FormData) => {
    const next = await addApplicant(previous, data);
    if (next.added) { setOpen(false); setSource(""); }
    return next;
  }, {} as AddApplicantState);
  const errors = state.fieldErrors ?? {};
  const box = (name: keyof typeof errors) => cn(BOX, errors[name] ? "border-destructive" : "border-zinc-200");
  const value = (name: string) => state.values?.[name];
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-auto rounded-lg px-[14px] py-[9px] shadow-none">Add applicant</Button>
      </DialogTrigger>
      <DialogContent
        showClose={false}
        overlayClassName="bg-[rgba(18,13,26,0.45)]"
        className="max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-[580px] gap-0 overflow-y-auto rounded-2xl border-0 !p-0 shadow-[0_20px_24px_rgba(0,0,0,0.2)] sm:max-w-[580px] sm:rounded-2xl sm:!p-0 md:max-w-[580px] lg:max-w-[580px]"
      >
        <form action={submit} noValidate>
          <div className="flex items-start gap-[12px] border-b border-[#ebebeb] pb-[16px] pl-[24px] pr-[18px] pt-[20px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
              <DialogTitle className="text-[17px] font-semibold leading-[normal] tracking-normal text-foreground">Add applicant</DialogTitle>
              <DialogDescription className="text-[13px] leading-[normal] text-zinc-500">For applicants HR enters by hand.</DialogDescription>
            </div>
            <DialogClose aria-label="Close" className="cursor-pointer text-zinc-500 hover:text-foreground"><X className="size-[18px]" /></DialogClose>
          </div>
          <div className="flex flex-col gap-md px-[24px] py-[20px]">
            <Labelled label="Full name" htmlFor="applicant-name" required error={errors.fullName}>
              <div className={box("fullName")}><input id="applicant-name" name="fullName" defaultValue={value("fullName")} placeholder="e.g. Mylene Santos" className={INPUT} /></div>
            </Labelled>
            <div className="flex flex-col gap-md sm:flex-row sm:gap-[12px]">
              <div className="min-w-0 flex-1">
                <Labelled label="Email" htmlFor="applicant-email" required error={errors.email}>
                  <div className={box("email")}><input id="applicant-email" name="email" type="email" defaultValue={value("email")} placeholder="name@example.com" className={INPUT} /></div>
                </Labelled>
              </div>
              <div className="min-w-0 flex-1">
                <Labelled label="Mobile" htmlFor="applicant-mobile" required error={errors.mobile}>
                  <div className={box("mobile")}><input id="applicant-mobile" name="mobile" type="tel" defaultValue={value("mobile")} placeholder="09XX XXX XXXX" className={INPUT} /></div>
                </Labelled>
              </div>
            </div>
            <Labelled label="Address" htmlFor="applicant-address" required error={errors.address}>
              <div className={box("address")}><input id="applicant-address" name="address" defaultValue={value("address")} placeholder="Street, city, province" className={INPUT} /></div>
            </Labelled>
            <Labelled label="Job Posting" htmlFor="applicant-job" required error={errors.jobPostingId} hint="Only Open Job Postings can be chosen.">
              <div className={box("jobPostingId")}>
                {/* React does not restore a select's default after the form reset, so each attempt remounts it. */}
                <select key={state.attempt} id="applicant-job" name="jobPostingId" defaultValue={value("jobPostingId") ?? ""} className={cn(INPUT, "appearance-none")}>
                  <option value="" disabled>Choose a Job Posting</option>
                  {jobs.map((job) => <option key={job.id} value={job.id}>{job.title}</option>)}
                </select>
                <ChevronDown className="size-4 shrink-0 text-zinc-500" />
              </div>
            </Labelled>
            <Labelled label="Source" htmlFor="applicant-source" required error={errors.source}>
              <div className={box("source")}>
                <select key={state.attempt} id="applicant-source" name="source" defaultValue={value("source") ?? ""} onChange={(event) => setSource(event.target.value)} className={cn(INPUT, "appearance-none")}>
                  <option value="" disabled>Choose a source</option>
                  {MANUAL_SOURCES.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <ChevronDown className="size-4 shrink-0 text-zinc-500" />
              </div>
            </Labelled>
            {source === "Referral" && (
              <Labelled label="Referred by" htmlFor="applicant-referred-by" required error={errors.referredBy}>
                <div className={box("referredBy")}><input id="applicant-referred-by" name="referredBy" defaultValue={value("referredBy")} placeholder="Who referred them" className={INPUT} /></div>
              </Labelled>
            )}
            <div className="flex flex-col gap-md sm:flex-row sm:gap-[12px]">
              <div className="min-w-0 flex-1">
                <Labelled label="Expected salary" htmlFor="applicant-salary" required error={errors.expectedSalary}>
                  <div className={box("expectedSalary")}>
                    <span className="text-zinc-500">₱</span>
                    <input id="applicant-salary" name="expectedSalary" type="number" inputMode="decimal" min={0} step="any" defaultValue={value("expectedSalary")} placeholder="15,500" className={INPUT} />
                  </div>
                </Labelled>
              </div>
              <div className="min-w-0 flex-1">
                <Labelled label="Available from" htmlFor="applicant-available" required error={errors.availableFrom}>
                  <div className={box("availableFrom")}><input id="applicant-available" name="availableFrom" type="date" defaultValue={value("availableFrom")} className={INPUT} /></div>
                </Labelled>
              </div>
            </div>
            {state.error && <p role="alert" className="text-xs text-destructive">{state.error}</p>}
          </div>
          <div className="flex items-center gap-sm border-t border-[#ebebeb] bg-zinc-50 px-[24px] py-[14px]">
            <p className="flex-1 text-xs text-zinc-500">Applied today, starting at New.</p>
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-auto rounded-lg border-zinc-200 px-[16px] py-[9px] text-sm font-medium shadow-none">Cancel</Button>
            </DialogClose>
            <Button type="submit" disabled={pending} className="h-auto rounded-lg px-[16px] py-[9px] text-sm font-medium shadow-none">{pending ? "Adding…" : "Add applicant"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
